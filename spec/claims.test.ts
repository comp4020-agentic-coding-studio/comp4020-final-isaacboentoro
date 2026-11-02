import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { expect, inject, it } from "vitest";
import WebSocket from "ws";
import { ARCADE_MS } from "../server/arcade.ts";
import { snippets, SPRINT_MS, WORD_COUNT } from "../server/passages.ts";
import { quotes } from "../server/quotes.ts";
import { page, racer, visitor, type RoomState } from "./racer.ts";

// server/race.ts opens the database when it's imported, so its timings are
// read from its source instead, which keeps these waits in step with it.
const raceTs = readFileSync("server/race.ts", "utf8");
const serverConst = (name: string) => Number(raceTs.match(new RegExp(`const ${name} = ([\\d_]+);`))![1].replace(/_/g, ""));
const COUNTDOWN_MS = serverConst("COUNTDOWN_MS");
const READY_MS = serverConst("READY_MS");
const MAX_CPS = serverConst("MAX_CPS");

// README.md, claim by claim. Each test is named for a sentence the README
// (or the brief it answers) makes, and the comment above it quotes that
// sentence, so the argument and the check line up. Claims only a browser can
// see are left to `pnpm shoot`; claims only a person can judge are left to the
// crit. Every test plays in its own room, so they run side by side.
const baseUrl = inject("baseUrl");
const freshRoom = () => `spec-${Math.random().toString(36).slice(2, 10)}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const secretOf = (cookie: string) => cookie.split("=")[1];

// Both on the line and both ready, so the race is running within READY_MS.
async function racingPair(mode: string) {
  const room = freshRoom();
  const [ca, cb] = [await visitor(), await visitor()];
  const a = racer(ca, room);
  const b = racer(cb, room);
  await Promise.all([a.opened, b.opened]);
  a.send({ t: "mode", mode });
  await a.until((s) => s.mode === mode, 1000);
  a.send({ t: "join" });
  b.send({ t: "join" });
  await a.until((s) => s.entrants.length === 2, 1000);
  a.send({ t: "ready" });
  b.send({ t: "ready" });
  const started = await a.until((s) => s.phase === "racing", READY_MS + 1500);
  return { a, b, ca, cb, text: started.quote.text, at: Date.now() };
}

// Finishing speeds here stay well under the other specs' (~230 wpm), so a
// long-lived local database's top ten never fills up with these and pushes
// race.test.ts's leaderboard entry off it.
const PACE_CPS = 15;

// --- "Sprint ... the race is won on WPM (accuracy breaking a tie) at the buzzer."

it.concurrent(
  "sprint: nobody can finish it, it ends at the buzzer, and accuracy breaks a WPM tie",
  async () => {
    // B is on the line first, so on a tie B would win unless accuracy decides it.
    const room = freshRoom();
    const a = racer(await visitor(), room);
    const b = racer(await visitor(), room);
    await Promise.all([a.opened, b.opened]);
    a.send({ t: "mode", mode: "sprint" });
    await a.until((s) => s.mode === "sprint", 1000);
    b.send({ t: "join" });
    await a.until((s) => s.entrants.length === 1, 1000);
    a.send({ t: "join" });
    await a.until((s) => s.entrants.length === 2, 1000);
    a.send({ t: "ready" });
    b.send({ t: "ready" });
    const started = await a.until((s) => s.phase === "racing", READY_MS + 1500);
    const t0 = Date.now();
    const [idb, ida] = started.entrants.map((e) => e.id); // in the order they joined

    // "nobody finishes it": not even at the server's own typing-speed cap.
    expect(started.quote.text.length).toBeGreaterThan(MAX_CPS * (SPRINT_MS / 1000));

    // Same characters, same clock, so the same WPM; B made four mistakes.
    await sleep(2000);
    a.send({ t: "progress", n: 40, errors: 0 });
    b.send({ t: "progress", n: 40, errors: 4 });

    const done = await a.until((s) => s.phase === "results", SPRINT_MS + 2000);
    // "at the buzzer": not before the clock runs out, with both still racing
    expect(Date.now() - t0).toBeGreaterThan(SPRINT_MS - 1000);
    expect(done.entrants.every((e) => e.progress < started.quote.text.length)).toBe(true);

    await sleep(300);
    const [first, second] = a.summary!.entrants.slice().sort((x, y) => x.place! - y.place!);
    expect(first.wpm).toBe(second.wpm);
    expect(first.accuracy!).toBeGreaterThan(second.accuracy!);
    expect([first.id, second.id]).toEqual([ida, idb]);
    a.ws.close();
    b.ws.close();
  },
  SPRINT_MS + 15_000,
);

// --- "Joining is a keystroke, not a form. Typing into the box is how you get
// --- on the line; there's no separate 'ready' screen standing between you
// --- and the race."
// The keystroke itself is the page's (shoot plays it); what it sends is one
// `join`, and this checks that one message is all it takes.

it.concurrent(
  "joining is one message, with no name or ready needed, and the race starts on its own",
  async () => {
    const room = freshRoom();
    const a = racer(await visitor(), room);
    const b = racer(await visitor(), room);
    await Promise.all([a.opened, b.opened]);

    // A has never filled anything in: the server already gave them a name.
    a.send({ t: "join" });
    const counting = await b.until((s) => s.phase === "countdown", 1000);
    expect(counting.entrants).toHaveLength(1);
    expect(counting.entrants[0].name.length).toBeGreaterThan(0);

    // B hops onto the same countdown with the same single message.
    b.send({ t: "join" });
    const both = await a.until((s) => s.entrants.length === 2, 1000);
    expect(both.phase).toBe("countdown");
    expect(Math.abs(both.endsAt - counting.endsAt)).toBeLessThan(50);

    // Nobody says they're ready, and the race starts anyway when the clock
    // runs out: one AFK racer can't hold the room.
    const racing = await a.until((s) => s.phase === "racing", COUNTDOWN_MS + 1500);
    expect(racing.entrants).toHaveLength(2);
    a.ws.close();
    b.ws.close();
  },
  COUNTDOWN_MS + 10_000,
);

// --- "Arcade ... lifts your multiplier (x2 at 5 clean words, x3 at 15, x4 at
// --- 30), and one mistake drops it back to x1. The server keeps the score
// --- from your keystrokes."

it.concurrent(
  "arcade: x2 at 5 clean words, x3 at 15, x4 at 30, and one mistake drops it to x1",
  async () => {
    const room = freshRoom();
    const a = racer(await visitor(), room);
    await a.opened;
    a.send({ t: "mode", mode: "arcade" });
    await a.until((s) => s.mode === "arcade", 1000);
    a.send({ t: "join" });
    await a.until((s) => s.phase === "countdown", 1000);
    a.send({ t: "ready" });
    const started = await a.until((s) => s.phase === "racing", READY_MS + 1500);
    const t0 = Date.now();
    const text = started.quote.text;
    // An arcade stream outlasts its clock too, so nobody ends it early.
    expect(text.length).toBeGreaterThan(MAX_CPS * (ARCADE_MS / 1000));
    const ends = [...text.matchAll(/ /g)].map((m) => m.index! + 1); // just past each word

    const expected = (clean: number) => (clean >= 30 ? 4 : clean >= 15 ? 3 : clean >= 5 ? 2 : 1);
    for (let w = 0; w < 31; w++) {
      // a word at a time, under the typing-speed cap so none of it is clamped
      await sleep(Math.max(0, (ends[w] / PACE_CPS) * 1000 - (Date.now() - t0)));
      a.send({ t: "progress", n: ends[w], errors: 0 });
      const me = (await a.until((s) => s.entrants[0].progress === ends[w], 1000)).entrants[0];
      expect(me.x, `after ${w + 1} clean words`).toBe(expected(w + 1));
      // "every correct letter scores and builds your combo"
      expect(me.combo).toBe(ends[w]);
    }

    // One wrong key, and the multiplier and combo are both gone.
    const before = a.state.entrants[0].points!;
    a.send({ t: "progress", n: ends[30], errors: 1, miss: { i: ends[30], got: "#" } });
    const broken = (await a.until((s) => s.entrants[0].x === 1, 1000)).entrants[0];
    expect(broken.combo).toBe(0);
    expect(broken.points).toBe(before); // a mistake costs the multiplier, not points already won
    a.ws.close();
  },
  30_000,
);

// --- "the server, not the client, decides who finished and when."

it.concurrent(
  "the server, not the client, decides who finished, in what place, and how fast",
  async () => {
    const { a, b, ca, cb, text, at } = await racingPair("code");
    const length = text.length;

    // B's page claims it's done, first, at 999 wpm, before typing anything.
    b.send({ t: "progress", n: length, errors: 0, finished: true, place: 1, wpm: 999 });
    await sleep(300);
    const forged = b.state.entrants.find((e) => e.progress > 0)!;
    expect(forged.finished).toBe(false);
    expect(forged.place).toBeNull();
    expect(forged.progress).toBeLessThan(length);

    // A really types it out, and is first because the server saw it first.
    await sleep(Math.max(0, (length / PACE_CPS) * 1000 - (Date.now() - at)));
    a.send({ t: "progress", n: length, errors: 0 });
    await a.until((s) => s.entrants.some((e) => e.place === 1), 1000);
    b.send({ t: "progress", n: length, errors: 0, place: 1 });
    const done = await a.until((s) => s.phase === "results", 2000);
    expect(done.entrants.map((e) => e.place).sort()).toEqual([1, 2]);

    await sleep(300);
    const sum = a.summary!;
    // the pace on the board is the server's clock, never past its cap
    for (const e of sum.entrants) expect(e.wpm).toBeLessThanOrEqual(MAX_CPS * 12);
    a.ws.close();
    b.ws.close();
    // and the placings the server gave are what each racer's history keeps
    expect(await page(ca)).toMatch(/1st of 2/);
    expect(await page(cb)).toMatch(/2nd of 2/);
  },
  30_000,
);

// --- "A race starts as soon as the people in it are actually ready."
// (All ready starting early is in modes.test.ts; this is the case where the
// one holding things up walks away instead.)

it.concurrent(
  "a race starts as soon as everyone still on the line is ready, even if someone unready leaves",
  async () => {
    const room = freshRoom();
    const a = racer(await visitor(), room);
    const b = racer(await visitor(), room);
    await Promise.all([a.opened, b.opened]);
    a.send({ t: "join" });
    b.send({ t: "join" });
    await a.until((s) => s.entrants.length === 2, 1000);
    a.send({ t: "ready" });
    await a.until((s) => s.entrants.some((e) => e.ready), 1000);

    // B never readies and closes the tab: A shouldn't sit out the full ten.
    const gone = Date.now();
    b.ws.close();
    await a.until((s) => s.entrants.length === 1, 1000);
    await a.until((s) => s.phase === "racing", READY_MS + 1500);
    expect(Date.now() - gone).toBeLessThan(COUNTDOWN_MS - 3000);
    a.ws.close();
  },
  15_000,
);

// --- "You should be able to see the other people in the room while it's
// --- happening." / brief: real-time, another session sees a change within
// --- about a second, with no reload.

it.concurrent(
  "everything one racer does reaches everyone else in the room within a second, without a reload",
  async () => {
    const room = freshRoom();
    const a = racer(await visitor(), room);
    const b = racer(await visitor(), room);
    await Promise.all([a.opened, b.opened]);
    const name = `cy${Math.random().toString(36).slice(2, 7)}`;
    // Times each change from the moment it's sent to the moment the other
    // socket has it; until() alone would only fail at the deadline.
    const lag: Record<string, number> = {};
    const timed = async (what: string, act: () => void, seen: (s: RoomState) => boolean, by = b) => {
      const t = Date.now();
      act();
      await by.until(seen, 1000);
      lag[what] = Date.now() - t;
    };

    await timed("mode", () => a.send({ t: "mode", mode: "words" }), (s) => s.mode === "words");
    await timed("join", () => a.send({ t: "join" }), (s) => s.entrants.length === 1);
    await timed("rename", () => a.send({ t: "name", name }), (s) => s.entrants[0]?.name === name);
    b.send({ t: "join" });
    await a.until((s) => s.entrants.length === 2, 1000);
    await timed("ready", () => a.send({ t: "ready" }), (s) => s.entrants.some((e) => e.ready));
    b.send({ t: "ready" });
    await b.until((s) => s.phase === "racing", READY_MS + 1500);

    // Mid-race, B sees exactly which character A is on, not just a bar.
    await timed(
      "keystroke",
      () => a.send({ t: "progress", n: 7, errors: 0 }),
      (s) => s.entrants.find((e) => e.name === name)?.progress === 7,
    );

    // Keystrokes stream in faster than ten a second; the room passes them on
    // at most ten times a second (the ADR's coalescing), and the last one lands.
    let frames = 0;
    const count = () => frames++;
    const burst = Date.now();
    b.ws.on("message", count);
    for (let n = 8; n <= 27; n++) {
      a.send({ t: "progress", n, errors: 0 });
      await sleep(50);
    }
    await b.until((s) => s.entrants.find((e) => e.name === name)?.progress === 27, 1000);
    b.ws.off("message", count);
    expect(frames).toBeLessThanOrEqual(Math.ceil((Date.now() - burst) / 100) + 1);

    // Leaving shows up too: A is told B is gone.
    await timed("leave", () => b.ws.close(), (s) => s.watching === 1, a);

    for (const [what, ms] of Object.entries(lag)) expect(ms, `${what} took ${ms}ms`).toBeLessThan(1000);
    a.ws.close();
  },
  20_000,
);

// The page's status line says how many are here ("3 here"), racing or not.
// Room.add once broadcast before counting the newcomer in, so everyone
// already there was told the old count and saw nobody arrive.
it("someone opening the room shows up for everyone already in it within a second", async () => {
  const room = freshRoom();
  const a = racer(await visitor(), room);
  await a.opened;
  await a.until((s) => s.watching === 1, 1000);
  const b = racer(await visitor(), room);
  await b.opened;
  await a.until((s) => s.watching === 2, 1000);
  a.ws.close();
  b.ws.close();
});

// --- brief: multi-user. "A person is a browser": separate cookies are
// --- separate people, and nobody can be anyone else.

it.concurrent("separate browsers are separate people, and none can see or take another's identity", async () => {
  const room = freshRoom();
  const [ca, cb] = [await visitor(), await visitor()];
  expect(secretOf(ca)).not.toBe(secretOf(cb));
  const a = racer(ca, room);
  const b = racer(cb, room);
  const heard: string[] = [];
  b.ws.on("message", (d) => heard.push(String(d)));
  await Promise.all([a.opened, b.opened]);
  a.send({ t: "join" });
  await b.until((s) => s.entrants.length === 1, 1000);
  b.send({ t: "join" });
  const both = await b.until((s) => s.entrants.length === 2, 1000);

  // Two entrants, two different public ids, and the page knows which is you.
  const [ida, idb] = both.entrants.map((e) => e.id);
  expect(ida).not.toBe(idb);
  expect(await page(ca)).toContain(`"id":"${ida}"`);
  expect(await page(cb)).toContain(`"id":"${idb}"`);

  // Nothing B is sent, over the socket or the page or the board, holds A's secret.
  const seenByB = [...heard, await page(cb), await (await fetch(new URL("/api/board", baseUrl), { headers: { cookie: cb } })).text()];
  for (const msg of seenByB) expect(msg).not.toContain(secretOf(ca));
  for (const id of [ida, idb]) expect([secretOf(ca), secretOf(cb)]).not.toContain(id);
  a.ws.close();
  b.ws.close();

  // A browser can't name its own identity: a made-up cookie gets a fresh one
  // from the server over HTTP, and no socket at all.
  const forged = `racer=${"A".repeat(43)}`;
  const res = await fetch(baseUrl, { headers: { cookie: forged } });
  const issued = res.headers.get("set-cookie")?.split(";")[0];
  expect(issued).toBeTruthy();
  expect(issued).not.toBe(forged);
  const url = new URL(`/ws?room=${room}`, baseUrl);
  url.protocol = url.protocol.replace("http", "ws");
  const refused = await new Promise<boolean>((resolve) => {
    const ws = new WebSocket(url, { headers: { cookie: forged } });
    ws.once("open", () => (ws.close(), resolve(false)));
    ws.once("error", () => resolve(true));
  });
  expect(refused, "a socket with a made-up cookie was let in").toBe(true);
});

// --- brief: persists. A name, set from the race page, survives a new session.

it.concurrent("a name changed mid-session is still yours on your next visit", async () => {
  const cookie = await visitor();
  const name = `di${Math.random().toString(36).slice(2, 7)}`;
  const a = racer(cookie, freshRoom());
  await a.opened;
  a.send({ t: "name", name });
  await sleep(300);
  a.ws.close();
  expect(await page(cookie)).toContain(`value="${name}"`);
  // and someone else's visit never wears it
  expect(await page(await visitor())).not.toContain(`value="${name}"`);
});

// --- "Words — 30 random lowercase words, no punctuation."

it.concurrent("words: every passage is exactly 30 lowercase words with no punctuation", async () => {
  const a = racer(await visitor(), freshRoom());
  await a.opened;
  expect(WORD_COUNT).toBe(30);
  for (let k = 0; k < 5; k++) {
    a.send({ t: "mode", mode: "words" });
    const s = await a.until((s) => s.mode === "words", 1000);
    expect(s.quote.text).toMatch(/^[a-z]+( [a-z]+)*$/);
    expect(s.quote.text.split(" ")).toHaveLength(30);
    a.send({ t: "mode", mode: "quotes" }); // switching back deals a fresh set
    await a.until((s) => s.mode === "quotes", 1000);
  }
  a.ws.close();
});

// --- "Code — a short snippet in JS, TS, Python, Rust, SQL, C or Haskell;
// --- indentation is typed for you after each newline."
// The typing-for-you is the page's; the server's half is that every snippet
// is indented with spaces only and has no trailing space to trip over.

it.concurrent("code: snippets come in exactly JS, TS, Python, Rust, SQL, C and Haskell, indented with spaces only", async () => {
  const langs = new Set(snippets.map((s) => s.source));
  expect([...langs].sort()).toEqual(["C", "Haskell", "JavaScript", "Python", "Rust", "SQL", "TypeScript"]);
  for (const s of snippets) {
    expect(s.text, s.source).not.toMatch(/\t| \n| $/);
    expect(s.text.split("\n").length, s.source).toBeLessThanOrEqual(8); // "short"
  }
  // and the running app deals one of them, with its language named
  const a = racer(await visitor(), freshRoom());
  await a.opened;
  a.send({ t: "mode", mode: "code" });
  const s = await a.until((s) => s.mode === "code", 1000);
  expect(langs).toContain(s.quote.source);
  a.ws.close();
});

// --- "Quotes — a line from a public-domain book."
// KNOWN FAILING (reported, not fixed here): server/quotes.ts has three
// passages whose source is "Original", i.e. not from any book. Either they
// go, or the README's sentence changes to admit them.

it("quotes: every passage is a line from a book, credited to its author", () => {
  const unsourced = quotes.filter((q) => !/^[^,]+, .+/.test(q.source));
  expect(unsourced.map((q) => `${q.source}: ${q.text.slice(0, 40)}…`)).toEqual([]);
});

// --- "The picker in the header switches the whole page between keyrace's own
// --- light and dark, Gruvbox, Adwaita, Catppuccin, Nord, Dracula, Solarized,
// --- Tokyo Night and Rosé Pine — or, left alone, follows the system's light or dark."
// That a pick is worn and remembered per browser is the page's: shoot checks both.

it.concurrent("the theme picker offers every theme the README names, and following the system", async () => {
  const doc = new JSDOM(await page(await visitor())).window.document;
  const options = [...doc.querySelectorAll("#theme option")].map((o) => ({
    value: (o as HTMLOptionElement).value,
    label: o.textContent!.toLowerCase(),
  }));
  expect(options.find((o) => o.value === "")?.label).toMatch(/system/);
  for (const name of ["keyrace light", "keyrace dark", "gruvbox", "adwaita", "catppuccin", "nord", "dracula", "solarized", "tokyo night", "rosé pine"]) {
    expect(options.some((o) => o.label.includes(name)), `no "${name}" theme`).toBe(true);
  }
});

// --- "How each multi-user decision was weighed against this is in
// --- docs/adr-0001-concurrency.md" — on /readme/, that link has to go somewhere.
// From /readme/ the README's relative link resolves to
// /readme/docs/adr-0001-concurrency.md; this caught it answering 404.

it("every link on /readme/ leads somewhere, including back to the race", async () => {
  const at = new URL("/readme/", baseUrl);
  const doc = new JSDOM(await (await fetch(at)).text()).window.document;
  const hrefs = [...doc.querySelectorAll("a[href]")].map((a) => a.getAttribute("href")!);
  expect(hrefs).toContain("/");
  const broken: string[] = [];
  for (const href of new Set(hrefs)) {
    const url = new URL(href, at);
    if (url.origin !== at.origin) continue;
    const res = await fetch(url);
    if (res.status !== 200) broken.push(`${href} → ${res.status}`);
  }
  expect(broken).toEqual([]);
});

// --- "It runs on one small, cheap machine. One Node process, one SQLite file,
// --- no framework — small enough to live on a 256 MB Fly machine that scales
// --- to zero between races."
// What the deploy is told to be, read from the files that tell it. Whether it
// truly fits is watched on Fly, not here.

it("is set up to run as one Node process with one SQLite file and no framework, on a 256 MB machine that scales to zero", () => {
  const fly = readFileSync("fly.toml", "utf8");
  expect(fly).toMatch(/^memory\s*=\s*"256mb"/m);
  expect(fly).toMatch(/^min_machines_running\s*=\s*0/m);
  expect(fly).toMatch(/^auto_stop_machines\s*=\s*"stop"/m);
  expect(fly.match(/^\[\[vm\]\]/gm)).toHaveLength(1);
  const docker = readFileSync("Dockerfile", "utf8");
  expect(docker).toMatch(/^CMD \["node", "server\/main\.ts"\]$/m);
  const deps = Object.keys(JSON.parse(readFileSync("package.json", "utf8")).dependencies).sort();
  expect(deps).toEqual(["marked", "ws"]); // a markdown renderer and a socket, nothing more
  const db = readFileSync("server/db.ts", "utf8");
  expect(db.match(/new DatabaseSync\(/g)).toHaveLength(1);
});
