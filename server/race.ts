import type { WebSocket } from "ws";
import { history, leaderboard, saveRace, type Player } from "./db.ts";
import { randomQuote, type Quote } from "./quotes.ts";

// How long each phase lasts. The countdown starts when the first racer joins,
// so anyone else in the room has that long to hop in.
export const COUNTDOWN_MS = 10_000;
export const RACE_LIMIT_MS = 120_000;
export const RESULTS_MS = 8_000;

// Fastest anyone is allowed to go: 25 characters a second is 300 WPM, well
// past the human record for sustained typing. Progress claimed faster than
// this is clamped, so a pasted passage can't win.
export const MAX_CPS = 25;

type Phase = "lobby" | "countdown" | "racing" | "results";

export interface Conn {
  ws: WebSocket;
  player: Player;
}

interface Entrant {
  id: string;
  name: string;
  progress: number; // characters of the passage typed correctly, in order
  errors: number;
  finishedAt: number | null;
  place: number | null;
}

export class Room {
  readonly id: string;
  readonly conns = new Set<Conn>();
  private phase: Phase = "lobby";
  private phaseEndsAt = 0;
  private startedAt = 0;
  private quote: Quote = randomQuote();
  private entrants = new Map<string, Entrant>();
  private timer: NodeJS.Timeout | undefined;
  private dirty = false;
  private ticker: NodeJS.Timeout;

  constructor(id: string) {
    this.id = id;
    // Progress arrives on every keystroke; the room rebroadcasts at most ten
    // times a second, which is fast enough to read as live.
    this.ticker = setInterval(() => {
      if (this.dirty) this.broadcast();
    }, 100);
  }

  get idle(): boolean {
    return this.conns.size === 0 && this.phase === "lobby";
  }

  dispose(): void {
    clearInterval(this.ticker);
    clearTimeout(this.timer);
  }

  add(conn: Conn): void {
    this.conns.add(conn);
    this.send(conn, { t: "board", ...boardFor(conn.player.id) });
    this.broadcast();
  }

  remove(conn: Conn): void {
    this.conns.delete(conn);
    // Leaving before the start gives the spot back; leaving mid-race is a DNF.
    const stillHere = [...this.conns].some((c) => c.player.id === conn.player.id);
    if (!stillHere && (this.phase === "lobby" || this.phase === "countdown")) {
      this.entrants.delete(conn.player.id);
      if (this.entrants.size === 0) this.toLobby();
    }
    // Nobody left to wait for: end the race rather than run out the clock.
    if (this.phase === "racing") {
      const present = new Set([...this.conns].map((c) => c.player.id));
      const waiting = [...this.entrants.values()].some(
        (e) => e.finishedAt === null && present.has(e.id),
      );
      if (!waiting) return this.finish();
    }
    this.broadcast();
  }

  rename(player: Player): void {
    const e = this.entrants.get(player.id);
    if (e) e.name = player.name;
    this.broadcast();
  }

  join(player: Player): void {
    if (this.phase !== "lobby" && this.phase !== "countdown") return;
    if (!this.entrants.has(player.id)) {
      this.entrants.set(player.id, {
        id: player.id,
        name: player.name,
        progress: 0,
        errors: 0,
        finishedAt: null,
        place: null,
      });
    }
    if (this.phase === "lobby") this.setPhase("countdown", COUNTDOWN_MS, () => this.start());
    this.broadcast();
  }

  leave(player: Player): void {
    if (this.phase !== "countdown") return;
    this.entrants.delete(player.id);
    if (this.entrants.size === 0) this.toLobby();
    this.broadcast();
  }

  progress(player: Player, typed: number, errors: number): void {
    const e = this.entrants.get(player.id);
    if (this.phase !== "racing" || !e || e.finishedAt !== null) return;
    if (!Number.isInteger(typed) || !Number.isInteger(errors)) return;

    const now = Date.now();
    const allowed = Math.floor(((now - this.startedAt) / 1000 + 0.5) * MAX_CPS);
    e.progress = Math.max(0, Math.min(typed, allowed, this.quote.text.length));
    e.errors = Math.max(e.errors, Math.min(errors, 10_000));

    if (e.progress === this.quote.text.length) {
      e.finishedAt = now;
      e.place = [...this.entrants.values()].filter((x) => x.finishedAt !== null).length;
      const present = new Set([...this.conns].map((c) => c.player.id));
      const waiting = [...this.entrants.values()].some(
        (x) => x.finishedAt === null && present.has(x.id),
      );
      if (!waiting) {
        this.finish();
        return;
      }
    }
    this.dirty = true;
  }

  private start(): void {
    this.startedAt = Date.now();
    this.setPhase("racing", RACE_LIMIT_MS, () => this.finish());
    this.broadcast();
  }

  private finish(): void {
    const results = [...this.entrants.values()].map((e) => ({
      playerId: e.id,
      place: e.place,
      wpm: wpm(e.progress, (e.finishedAt ?? Date.now()) - this.startedAt),
      accuracy: accuracy(e.progress, e.errors),
    }));
    saveRace(this.id, this.quote.id, this.startedAt, results);
    this.setPhase("results", RESULTS_MS, () => this.toLobby());
    this.broadcast();
    for (const c of this.conns) this.send(c, { t: "board", ...boardFor(c.player.id) });
  }

  private toLobby(): void {
    this.entrants.clear();
    this.quote = randomQuote(this.quote.id);
    this.setPhase("lobby", 0);
    this.broadcast();
  }

  private setPhase(phase: Phase, ms: number, then?: () => void): void {
    clearTimeout(this.timer);
    this.phase = phase;
    this.phaseEndsAt = ms ? Date.now() + ms : 0;
    if (then) this.timer = setTimeout(then, ms);
  }

  snapshot() {
    const now = Date.now();
    const racing = this.phase === "racing" || this.phase === "results";
    return {
      id: this.id,
      phase: this.phase,
      now,
      endsAt: this.phaseEndsAt,
      startedAt: racing ? this.startedAt : null,
      quote: { text: this.quote.text, source: this.quote.source },
      watching: new Set([...this.conns].map((c) => c.player.id)).size,
      entrants: [...this.entrants.values()].map((e) => ({
        id: e.id,
        name: e.name,
        progress: e.progress,
        place: e.place,
        finished: e.finishedAt !== null,
        wpm: racing ? wpm(e.progress, (e.finishedAt ?? now) - this.startedAt) : 0,
      })),
    };
  }

  broadcast(): void {
    this.dirty = false;
    const msg = JSON.stringify({ t: "state", room: this.snapshot() });
    for (const c of this.conns) if (c.ws.readyState === c.ws.OPEN) c.ws.send(msg);
  }

  private send(conn: Conn, msg: object): void {
    if (conn.ws.readyState === conn.ws.OPEN) conn.ws.send(JSON.stringify(msg));
  }
}

// Standard typing-test WPM: five characters count as one word.
export function wpm(chars: number, ms: number): number {
  if (ms <= 0) return 0;
  return Math.round((chars / 5 / (ms / 60_000)) * 10) / 10;
}

export function accuracy(correct: number, errors: number): number {
  if (correct + errors === 0) return 1;
  return Math.round((correct / (correct + errors)) * 1000) / 1000;
}

const DAY = 24 * 60 * 60 * 1000;

export function boardFor(playerId: string) {
  return {
    today: leaderboard(Date.now() - DAY),
    allTime: leaderboard(),
    history: history(playerId),
  };
}

const rooms = new Map<string, Room>();

export function room(id: string): Room {
  let r = rooms.get(id);
  if (!r) rooms.set(id, (r = new Room(id)));
  return r;
}

export function release(r: Room): void {
  if (r.idle && r.id !== "main") {
    r.dispose();
    rooms.delete(r.id);
  }
}
