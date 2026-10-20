import { expect, it } from "vitest";
import { SPRINT_MS } from "../server/passages.ts";
import { racer, visitor } from "./racer.ts";

const freshRoom = () => `spec-${Math.random().toString(36).slice(2, 10)}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

it("switches modes before a race starts, and not once it has", async () => {
  const a = racer(await visitor(), freshRoom());
  await a.opened;

  a.send({ t: "mode", mode: "words" });
  const words = await a.until((s) => s.mode === "words", 1000);
  expect(words.quote.text).toMatch(/^[a-z]+( [a-z]+)+$/);

  a.send({ t: "mode", mode: "code" });
  const code = await a.until((s) => s.mode === "code", 1000);
  expect(code.quote.text).toContain("\n");

  // On your own, saying you're ready starts it in a few seconds, not ten.
  a.send({ t: "join" });
  await a.until((s) => s.phase === "countdown", 1000);
  a.send({ t: "ready" });
  await a.until((s) => s.phase === "racing", 4500);

  a.send({ t: "mode", mode: "quotes" });
  await sleep(300);
  expect(a.state.mode).toBe("code");
  expect(a.state.quote.text).toBe(code.quote.text);
  a.ws.close();
}, 15_000);

it(
  "starts early once all are ready, sums up each racer's mistakes and pace, and lets a watcher queue for the next race",
  async () => {
    const room = freshRoom();
    const [a, b, c] = await Promise.all(
      [0, 1, 2].map(async () => racer(await visitor(), room)),
    );
    await Promise.all([a.opened, b.opened, c.opened]);
    a.send({ t: "mode", mode: "words" });
    await a.until((s) => s.mode === "words", 1000);

    a.send({ t: "join" });
    b.send({ t: "join" });
    await a.until((s) => s.entrants.length === 2, 1000);

    // One ready isn't enough; both is.
    a.send({ t: "ready" });
    const one = await b.until((s) => s.entrants.some((e) => e.ready), 1000);
    expect(one.endsAt - one.now).toBeGreaterThan(5000);
    b.send({ t: "ready" });
    const started = await a.until((s) => s.phase === "racing", 4500);
    const text = started.quote.text;

    // A fumbles the first letter once, then types it out; B gets a little way.
    a.send({ t: "progress", n: 0, errors: 1, miss: { i: 0, got: "#" } });
    b.send({ t: "progress", n: 2, errors: 0 });
    for (let n = 4; n < text.length + 4; n += 4) {
      await sleep(200);
      a.send({ t: "progress", n: Math.min(n, text.length), errors: 1 });
    }
    await a.until((s) => s.entrants.find((e) => e.finished) !== undefined, 2000);
    b.ws.close();
    await a.until((s) => s.phase === "results", 3000);

    // Everyone still in the room, racer or not, gets the summary.
    await sleep(300);
    const sum = c.summary!;
    expect(sum).toBeDefined();
    expect(sum.text).toBe(text);
    expect(sum.entrants).toHaveLength(2);
    const winner = sum.entrants.find((e) => e.place === 1)!;
    expect(winner.misses).toEqual([expect.objectContaining({ i: 0, got: "#" })]);
    expect(winner.series.length).toBeGreaterThan(3);
    expect(winner.series.at(-1)![1]).toBeCloseTo(winner.wpm, 0);
    const dnf = sum.entrants.find((e) => e.place === null)!;
    expect(dnf.misses).toEqual([]);

    // C, who only watched, asks in while the results are up and is on the
    // line for the next countdown when they clear.
    c.send({ t: "join" });
    await c.until((s) => s.queued.length === 1, 1000);
    const next = await c.until((s) => s.phase === "countdown", 10_000);
    expect(next.entrants).toHaveLength(1);
    expect(next.mode).toBe("words");
    a.ws.close();
    c.ws.close();
  },
  40_000,
);

it(
  "ends a sprint on the clock and ranks everyone by wpm instead of finish order",
  async () => {
    const room = freshRoom();
    const [a, b] = await Promise.all([0, 1].map(async () => racer(await visitor(), room)));
    await Promise.all([a.opened, b.opened]);
    a.send({ t: "mode", mode: "sprint" });
    const sprint = await a.until((s) => s.mode === "sprint", 1000);
    // A sprint's passage has to outlast the clock, not end like a normal race.
    expect(sprint.quote.text.length).toBeGreaterThan(500);

    a.send({ t: "join" });
    b.send({ t: "join" });
    await a.until((s) => s.entrants.length === 2, 1000);
    a.send({ t: "ready" });
    b.send({ t: "ready" });
    const started = await a.until((s) => s.phase === "racing", 4500);
    const text = started.quote.text;

    // A types faster than B, and neither comes close to the end of the text.
    for (let n = 4; n < 200; n += 4) {
      a.send({ t: "progress", n, errors: 0 });
      if (n % 8 === 0) b.send({ t: "progress", n: n / 2, errors: 0 });
      await sleep(200);
    }
    const results = await a.until((s) => s.phase === "results", SPRINT_MS);
    expect(results.entrants.every((e) => e.progress < text.length)).toBe(true);

    await sleep(300);
    const sum = a.summary!;
    const [first, second] = sum.entrants
      .slice()
      .sort((x, y) => (x.place ?? 99) - (y.place ?? 99));
    // Nobody finished the passage, but the faster typist still won outright.
    expect(first.place).toBe(1);
    expect(second.place).toBe(2);
    expect(first.wpm).toBeGreaterThan(second.wpm);
    a.ws.close();
    b.ws.close();
  },
  60_000,
);

it(
  "keeps a race going through a dropped connection, and ends it if the racer never comes back",
  async () => {
    const room = freshRoom();
    const cookie = await visitor();
    const a = racer(cookie, room);
    await a.opened;
    a.send({ t: "mode", mode: "sprint" });
    await a.until((s) => s.mode === "sprint", 1000);
    a.send({ t: "join" });
    await a.until((s) => s.phase === "countdown", 1000);
    a.send({ t: "ready" });
    await a.until((s) => s.phase === "racing", 4500);
    for (let n = 4; n <= 40; n += 4) {
      a.send({ t: "progress", n, errors: 0 });
      await sleep(200);
    }

    // The only racer's socket drops (a wifi blip) and the page reconnects:
    // the race is still on, and their progress is where they left it.
    a.ws.terminate();
    await sleep(1000);
    const back = racer(cookie, room);
    await back.opened;
    const resumed = await back.until((s) => s.entrants.length === 1, 1000);
    expect(resumed.phase).toBe("racing");
    expect(resumed.entrants[0].progress).toBe(40);

    // Dropping for good ends it soon after, rather than running out the clock.
    back.ws.terminate();
    const watcher = racer(await visitor(), room);
    await watcher.opened;
    const gone = Date.now();
    await watcher.until((s) => s.phase === "results", 8000);
    expect(Date.now() - gone).toBeLessThan(SPRINT_MS - 5000);
    watcher.ws.close();
  },
  30_000,
);

it(
  "scores arcade on the server: clean words build a multiplier, a miss resets it, and points decide the winner",
  async () => {
    const room = freshRoom();
    const [a, b] = await Promise.all([0, 1].map(async () => racer(await visitor(), room)));
    await Promise.all([a.opened, b.opened]);
    a.send({ t: "mode", mode: "arcade" });
    await a.until((s) => s.mode === "arcade", 1000);
    a.send({ t: "join" });
    b.send({ t: "join" });
    await a.until((s) => s.entrants.length === 2, 1000);
    a.send({ t: "ready" });
    b.send({ t: "ready" });
    const started = await a.until((s) => s.phase === "racing", 4500);
    const text = started.quote.text;
    const ends = [...text.matchAll(/ /g)].map((m) => m.index! + 1); // just past each word

    // A types six words clean, a word at a time; B types the same six but
    // fumbles every word, so never builds a streak.
    for (let w = 0; w < 6; w++) {
      if (w > 0) b.send({ t: "progress", n: ends[w - 1], errors: w, miss: { i: ends[w - 1], got: "#" } });
      a.send({ t: "progress", n: ends[w], errors: 0 });
      b.send({ t: "progress", n: ends[w], errors: w + 1 });
      await sleep(400);
    }
    const mid = await a.until((s) => s.entrants.every((e) => e.progress === ends[5]), 2000);
    const [hi, lo] = mid.entrants.slice().sort((p, q) => q.points! - p.points!);
    // same characters typed, but the clean typist is on x2 and well ahead
    expect(hi.x).toBe(2);
    expect(lo.x).toBe(1);
    expect(hi.points!).toBeGreaterThan(lo.points! * 1.5);

    // A's page claiming a huge score changes nothing: only progress counts
    a.send({ t: "progress", n: ends[5], errors: 0, points: 1_000_000 });
    await sleep(300);
    expect(Math.max(...a.state.entrants.map((e) => e.points!))).toBe(hi.points);

    a.ws.close();
    b.ws.close();
  },
  30_000,
);
