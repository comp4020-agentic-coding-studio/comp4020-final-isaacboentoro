import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

// /data is the Fly volume: the only storage that survives a redeploy.
const dir = process.env.DATA_DIR ?? "/data";
mkdirSync(dir, { recursive: true });
const db = new DatabaseSync(join(dir, "typerace.db"));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS players (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS races (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    room        TEXT NOT NULL,
    quote_id    INTEGER NOT NULL,
    started_at  INTEGER NOT NULL,
    finished_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS results (
    race_id   INTEGER NOT NULL REFERENCES races(id),
    player_id TEXT NOT NULL REFERENCES players(id),
    place     INTEGER,            -- null: did not finish
    wpm       REAL NOT NULL,
    accuracy  REAL NOT NULL,
    PRIMARY KEY (race_id, player_id)
  );
  CREATE INDEX IF NOT EXISTS results_player ON results(player_id);
`);

// A player row's `id` is internal and never leaves the server. Signing in is
// a separate random secret in the cookie, stored here only as its hash, so
// neither a leaked id nor a copy of this file is a way in.
const playerCols = db.prepare("PRAGMA table_info(players)").all() as { name: string }[];
if (!playerCols.some((c) => c.name === "secret_hash")) {
  db.exec("ALTER TABLE players ADD COLUMN secret_hash TEXT");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS players_secret ON players(secret_hash)");
}

// An arcade result also keeps its score; every other mode leaves it null.
const resultCols = db.prepare("PRAGMA table_info(results)").all() as { name: string }[];
if (!resultCols.some((c) => c.name === "points")) db.exec("ALTER TABLE results ADD COLUMN points INTEGER");

// Races from before modes existed were all quotes.
const raceCols = db.prepare("PRAGMA table_info(races)").all() as { name: string }[];
if (!raceCols.some((c) => c.name === "mode")) {
  db.exec("ALTER TABLE races ADD COLUMN mode TEXT NOT NULL DEFAULT 'quotes'");
}

export interface Player {
  id: string;
  name: string;
}

// A player's id is the secret in their cookie: whoever has it *is* them.
// Anything that leaves the server — room state, summaries, leaderboards —
// names a player by this one-way hash of it instead, which is enough to say
// "that's you" or tell two racers apart, and useless to sign in with.
export function publicId(id: string): string {
  return createHash("sha256").update(`keyrace:${id}`).digest("base64url").slice(0, 16);
}

const hashSecret = (secret: string) => createHash("sha256").update(secret).digest("base64url");

// Who a cookie's secret belongs to, if anyone. Players from before secrets
// existed have none, so their old cookies (which were their ids, and were
// published) match nothing and get a fresh identity.
export function playerBySecret(secret: string): Player | undefined {
  return db.prepare("SELECT id, name FROM players WHERE secret_hash = ?").get(hashSecret(secret)) as
    | Player
    | undefined;
}

// A new player, and the secret for their cookie. The server always mints
// both: a browser never gets to name its own identity.
export function createPlayer(name: string): { player: Player; secret: string } {
  const player = { id: randomUUID(), name };
  const secret = randomBytes(32).toString("base64url");
  db.prepare("INSERT INTO players (id, name, created_at, secret_hash) VALUES (?, ?, ?, ?)").run(
    player.id,
    name,
    Date.now(),
    hashSecret(secret),
  );
  return { player, secret };
}

export function renamePlayer(id: string, name: string): void {
  db.prepare("UPDATE players SET name = ? WHERE id = ?").run(name, id);
}

export interface Result {
  playerId: string;
  place: number | null;
  wpm: number;
  accuracy: number;
  points?: number;
}

export function saveRace(
  room: string,
  mode: string,
  quoteId: number,
  startedAt: number,
  results: Result[],
): number {
  db.exec("BEGIN");
  try {
    const { lastInsertRowid } = db
      .prepare(
        "INSERT INTO races (room, mode, quote_id, started_at, finished_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(room, mode, quoteId, startedAt, Date.now());
    const insert = db.prepare(
      "INSERT INTO results (race_id, player_id, place, wpm, accuracy, points) VALUES (?, ?, ?, ?, ?, ?)",
    );
    for (const r of results) {
      insert.run(lastInsertRowid, r.playerId, r.place, r.wpm, r.accuracy, r.points ?? null);
    }
    db.exec("COMMIT");
    return Number(lastInsertRowid);
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export interface Best {
  id: string;
  name: string;
  wpm: number;
  races: number;
}

// Best finished WPM per player, since `since` (ms epoch).
export function leaderboard(since = 0, limit = 10): Best[] {
  return db
    .prepare(
      `SELECT p.id, p.name, MAX(r.wpm) AS wpm, COUNT(*) AS races
         FROM results r
         JOIN races ra ON ra.id = r.race_id
         JOIN players p ON p.id = r.player_id
        WHERE r.place IS NOT NULL AND ra.finished_at >= ?
        GROUP BY p.id
        ORDER BY wpm DESC
        LIMIT ?`,
    )
    .all(since, limit)
    .map((r) => ({ ...r, id: publicId(r.id as string) })) as unknown as Best[];
}

export interface HistoryRow {
  raceId: number;
  mode: string;
  finishedAt: number;
  place: number | null;
  field: number;
  wpm: number;
  accuracy: number;
  points: number | null;
}

export function history(playerId: string, limit = 10): HistoryRow[] {
  return db
    .prepare(
      `SELECT ra.id AS raceId, ra.mode, ra.finished_at AS finishedAt, r.place, r.wpm, r.accuracy, r.points,
              (SELECT COUNT(*) FROM results x WHERE x.race_id = ra.id) AS field
         FROM results r JOIN races ra ON ra.id = r.race_id
        WHERE r.player_id = ?
        ORDER BY ra.finished_at DESC
        LIMIT ?`,
    )
    .all(playerId, limit) as unknown as HistoryRow[];
}
