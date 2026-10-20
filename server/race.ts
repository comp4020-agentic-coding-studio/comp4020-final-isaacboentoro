import type { WebSocket } from "ws";
import { history, leaderboard, publicId, saveRace, type Player } from "./db.ts";
import { advance, ARCADE_MS, fresh, miss as missed, multiplier, type Score } from "./arcade.ts";
import { isMode, randomPassage, SPRINT_MS, type Mode } from "./passages.ts";
import type { Quote } from "./quotes.ts";

// How long each phase lasts. The countdown starts when the first racer joins,
// so anyone else in the room has that long to hop in. Once everyone on the
// line says they're ready it drops to READY_MS, so nobody sits out the rest.
export const COUNTDOWN_MS = 10_000;
export const READY_MS = 3_000;
export const RACE_LIMIT_MS = 120_000;
// How long a race waits for a racer whose connection dropped before calling
// it: a wifi hiccup, a laptop lid or a phone switching apps shouldn't end it.
export const GRACE_MS = 5_000;
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
  ready: boolean;
  // for the post-race summary: progress over time, and every wrong keystroke
  samples: Array<[ms: number, progress: number]>;
  misses: Miss[];
  score: Score; // arcade only; kept for every mode so it's never missing
}

interface Miss {
  i: number; // where in the passage
  got: string; // what was typed instead
  t: number; // ms since the start
}

const MAX_MISSES = 500;

export class Room {
  readonly id: string;
  readonly conns = new Set<Conn>();
  private phase: Phase = "lobby";
  private phaseEndsAt = 0;
  private startedAt = 0;
  private mode: Mode = "quotes";
  private quote: Quote = randomPassage("quotes");
  private entrants = new Map<string, Entrant>();
  // who asked in while the last race's results were up; they start the next
  private queued = new Set<string>();
  private summary: object | null = null;
  private timer: NodeJS.Timeout | undefined;
  private grace: NodeJS.Timeout | undefined;
  private dirty = false;
  // The passage only changes between races, but state goes out ten times a
  // second mid-race; it rides along only when it's new to the room, or to a
  // connection that hasn't had it. A sprint's passage is ~1.5 KB of a ~1.8 KB
  // message, so this is most of the traffic.
  private sentQuote: Quote | null = null;
  private ticker: NodeJS.Timeout;

  constructor(id: string) {
    this.id = id;
    // Progress arrives on every keystroke; the room rebroadcasts at most ten
    // times a second, which is fast enough to read as live.
    // It also drops sockets that have started closing: behind Fly's proxy the
    // `close` event can trail the close frame by many seconds, and nobody
    // should be kept waiting on a tab that's gone.
    this.ticker = setInterval(() => {
      for (const c of this.conns) if (c.ws.readyState !== c.ws.OPEN) this.remove(c);
      if (this.dirty) this.broadcast();
    }, 100);
  }

  get idle(): boolean {
    return this.conns.size === 0 && this.phase === "lobby";
  }

  dispose(): void {
    clearInterval(this.ticker);
    clearTimeout(this.timer);
    clearTimeout(this.grace);
  }

  add(conn: Conn): void {
    this.send(conn, { t: "board", ...boardFor(conn.player.id) });
    if (this.summary) this.send(conn, { t: "summary", race: this.summary });
    // the newcomer gets the passage in full; everyone else just the change
    this.broadcast();
    this.conns.add(conn);
    this.send(conn, { t: "state", room: this.snapshot(true) });
  }

  remove(conn: Conn, dropped = false): void {
    if (!this.conns.delete(conn)) return;
    // Leaving before the start gives the spot back; leaving mid-race is a DNF.
    const stillHere = [...this.conns].some((c) => c.player.id === conn.player.id);
    if (!stillHere) this.queued.delete(conn.player.id);
    if (!stillHere && (this.phase === "lobby" || this.phase === "countdown")) {
      this.entrants.delete(conn.player.id);
      if (this.entrants.size === 0) this.toLobby();
      else this.maybeStartEarly();
    }
    // Nobody left to wait for: end the race rather than run out the clock.
    // A closed tab means it at once; a dropped connection gets a moment,
    // since the page reconnects within a second or two and picks up where it
    // was, and a blip shouldn't cost anyone their race.
    if (this.phase === "racing" && !this.racerPresent()) {
      if (!dropped) return this.finish();
      this.grace ??= setTimeout(() => {
        this.grace = undefined;
        if (this.phase === "racing" && !this.racerPresent()) this.finish();
      }, GRACE_MS);
    }
    this.broadcast();
  }

  // Is anyone still racing actually connected?
  private racerPresent(): boolean {
    const present = new Set([...this.conns].map((c) => c.player.id));
    return [...this.entrants.values()].some((e) => e.finishedAt === null && present.has(e.id));
  }

  rename(player: Player): void {
    const e = this.entrants.get(player.id);
    if (e) e.name = player.name;
    this.broadcast();
  }

  join(player: Player): void {
    if (this.phase === "results") {
      this.queued.add(player.id);
      return this.broadcast();
    }
    if (this.phase !== "lobby" && this.phase !== "countdown") return;
    this.enter(player);
    this.broadcast();
  }

  private enter(player: Player): void {
    if (!this.entrants.has(player.id)) {
      this.entrants.set(player.id, {
        id: player.id,
        name: player.name,
        progress: 0,
        errors: 0,
        finishedAt: null,
        place: null,
        ready: false,
        samples: [],
        misses: [],
        score: fresh(),
      });
    }
    if (this.phase === "lobby") this.setPhase("countdown", COUNTDOWN_MS, () => this.start());
  }

  leave(player: Player): void {
    if (this.queued.delete(player.id)) return this.broadcast();
    if (this.phase !== "countdown") return;
    this.entrants.delete(player.id);
    if (this.entrants.size === 0) this.toLobby();
    else this.maybeStartEarly();
    this.broadcast();
  }

  // Toggle; when everyone on the line is ready the countdown jumps to its end.
  ready(player: Player): void {
    const e = this.entrants.get(player.id);
    if (this.phase !== "countdown" || !e) return;
    e.ready = !e.ready;
    this.maybeStartEarly();
    this.broadcast();
  }

  private maybeStartEarly(): void {
    if (this.phase !== "countdown") return;
    const all = [...this.entrants.values()];
    if (all.length > 0 && all.every((e) => e.ready) && this.phaseEndsAt - Date.now() > READY_MS) {
      this.setPhase("countdown", READY_MS, () => this.start());
    }
  }

  // Anyone in the room can switch modes before the start. A new passage
  // un-readies everyone and leaves at least a few seconds to read it.
  setMode(mode: unknown): void {
    if (!isMode(mode) || mode === this.mode) return;
    if (this.phase !== "lobby" && this.phase !== "countdown") return;
    this.mode = mode;
    this.quote = randomPassage(mode);
    if (this.phase === "countdown") {
      for (const e of this.entrants.values()) e.ready = false;
      if (this.phaseEndsAt - Date.now() < 5_000) this.setPhase("countdown", 5_000, () => this.start());
    }
    this.broadcast();
  }

  progress(player: Player, typed: number, errors: number, miss?: unknown): void {
    const e = this.entrants.get(player.id);
    if (this.phase !== "racing" || !e || e.finishedAt !== null) return;
    if (!Number.isInteger(typed) || !Number.isInteger(errors)) return;

    const now = Date.now();
    const allowed = Math.floor(((now - this.startedAt) / 1000 + 0.5) * MAX_CPS);
    e.progress = Math.max(0, Math.min(typed, allowed, this.quote.text.length));
    const m = miss as Partial<Miss> | undefined;
    if (
      m &&
      Number.isInteger(m.i) &&
      m.i! >= 0 &&
      m.i! < this.quote.text.length &&
      typeof m.got === "string" &&
      m.got.length === 1 &&
      e.misses.length < MAX_MISSES
    ) {
      e.misses.push({ i: m.i!, got: m.got, t: now - this.startedAt });
      missed(e.score);
    }
    // arcade scores what the server accepted, never what the page claims
    if (this.mode === "arcade") advance(e.score, this.quote.text, e.progress);
    e.errors = Math.max(e.errors, e.misses.length, Math.min(errors, 10_000));
    const last = e.samples[e.samples.length - 1];
    if (!last || last[1] !== e.progress) e.samples.push([now - this.startedAt, e.progress]);

    if (e.progress === this.quote.text.length) {
      e.finishedAt = now;
      e.place = [...this.entrants.values()].filter((x) => x.finishedAt !== null).length;
      if (!this.racerPresent()) {
        this.finish();
        return;
      }
    }
    this.dirty = true;
  }

  private start(): void {
    this.startedAt = Date.now();
    const limit = this.mode === "sprint" ? SPRINT_MS : this.mode === "arcade" ? ARCADE_MS : RACE_LIMIT_MS;
    this.setPhase("racing", limit, () => this.finish());
    this.broadcast();
  }

  private finish(): void {
    clearTimeout(this.grace);
    this.grace = undefined;
    const end = Date.now();
    // A sprint never resolves by finish order — its passage outlasts the
    // clock on purpose — so rank everyone by WPM (accuracy breaks a tie) the
    // instant time runs out, instead of leaving them all a DNF.
    // An arcade game is the same, ranked on points.
    if (this.mode === "sprint" || this.mode === "arcade") {
      const by = (e: Entrant) =>
        this.mode === "arcade" ? e.score.points : wpm(e.progress, end - this.startedAt);
      const ranked = [...this.entrants.values()].sort((a, b) => {
        const diff = by(b) - by(a);
        return diff !== 0 ? diff : accuracy(b.progress, b.errors) - accuracy(a.progress, a.errors);
      });
      ranked.forEach((e, k) => {
        e.place = k + 1;
        e.finishedAt ??= end;
      });
    }
    const results = [...this.entrants.values()].map((e) => ({
      playerId: e.id,
      place: e.place,
      wpm: wpm(e.progress, (e.finishedAt ?? end) - this.startedAt),
      accuracy: accuracy(e.progress, e.errors),
      ...(this.mode === "arcade" ? { points: e.score.points } : {}),
    }));
    saveRace(this.id, this.mode, this.quote.id, this.startedAt, results);
    this.summary = {
      mode: this.mode,
      text: this.quote.text,
      source: this.quote.source,
      seconds: Math.round((end - this.startedAt) / 100) / 10,
      entrants: [...this.entrants.values()].map((e, k) => ({
        id: publicId(e.id),
        name: e.name,
        place: e.place,
        progress: e.progress,
        wpm: results[k].wpm,
        accuracy: results[k].accuracy,
        misses: e.misses,
        series: series(e.samples, (e.finishedAt ?? end) - this.startedAt),
        ...(this.mode === "arcade" ? { points: e.score.points, bestCombo: e.score.best } : {}),
      })),
    };
    this.setPhase("results", RESULTS_MS, () => this.toLobby());
    this.broadcast();
    for (const c of this.conns) {
      this.send(c, { t: "summary", race: this.summary });
      this.send(c, { t: "board", ...boardFor(c.player.id) });
    }
  }

  private toLobby(): void {
    this.entrants.clear();
    this.quote = randomPassage(this.mode, this.quote.id);
    this.setPhase("lobby", 0);
    // Anyone who asked in during the results starts the next countdown.
    const present = new Map([...this.conns].map((c) => [c.player.id, c.player]));
    for (const id of this.queued) {
      const p = present.get(id);
      if (p) this.enter(p);
    }
    this.queued.clear();
    this.broadcast();
  }

  private setPhase(phase: Phase, ms: number, then?: () => void): void {
    clearTimeout(this.timer);
    this.phase = phase;
    this.phaseEndsAt = ms ? Date.now() + ms : 0;
    if (then) this.timer = setTimeout(then, ms);
  }

  snapshot(withQuote = false) {
    const now = Date.now();
    const racing = this.phase === "racing" || this.phase === "results";
    return {
      id: this.id,
      phase: this.phase,
      now,
      endsAt: this.phaseEndsAt,
      startedAt: racing ? this.startedAt : null,
      mode: this.mode,
      ...(withQuote ? { quote: { text: this.quote.text, source: this.quote.source } } : {}),
      watching: new Set([...this.conns].map((c) => c.player.id)).size,
      queued: [...this.queued].map(publicId),
      entrants: [...this.entrants.values()].map((e) => ({
        id: publicId(e.id),
        name: e.name,
        progress: e.progress,
        place: e.place,
        finished: e.finishedAt !== null,
        ready: e.ready,
        wpm: racing ? wpm(e.progress, (e.finishedAt ?? now) - this.startedAt) : 0,
        ...(this.mode === "arcade"
          ? { points: e.score.points, combo: e.score.combo, x: multiplier(e.score.streak) }
          : {}),
      })),
    };
  }

  broadcast(): void {
    this.dirty = false;
    const fresh = this.sentQuote !== this.quote;
    this.sentQuote = this.quote;
    const msg = JSON.stringify({ t: "state", room: this.snapshot(fresh) });
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

// Average WPM so far at each whole second of a racer's race, plus the moment
// they stopped: the line the summary graph draws.
export function series(samples: Array<[number, number]>, ms: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let k = 0;
  let progress = 0;
  const at = (t: number) => {
    while (k < samples.length && samples[k][0] <= t) progress = samples[k++][1];
    out.push([Math.round(t / 100) / 10, wpm(progress, t)]);
  };
  for (let t = 1000; t < ms; t += 1000) at(t);
  if (ms > 0) at(ms);
  return out;
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
