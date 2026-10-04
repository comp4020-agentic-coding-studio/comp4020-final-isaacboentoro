import { expect, inject, it } from "vitest";
import WebSocket from "ws";

// A race, played over the same socket the page uses, against the running app.
const baseUrl = inject("baseUrl");

interface Entrant {
  id: string;
  name: string;
  progress: number;
  finished: boolean;
  place: number | null;
}
interface RoomState {
  phase: "lobby" | "countdown" | "racing" | "results";
  quote: { text: string };
  entrants: Entrant[];
}

// A fresh visitor: whatever cookie the app hands a first-time browser.
async function visitor(): Promise<string> {
  const res = await fetch(baseUrl);
  const cookie = res.headers.get("set-cookie")?.split(";")[0];
  expect(cookie, "the app gives a new visitor an identity cookie").toBeTruthy();
  return cookie!;
}

async function page(cookie: string, path = "/"): Promise<string> {
  return (await fetch(new URL(path, baseUrl), { headers: { cookie } })).text();
}

function racer(cookie: string, room: string) {
  const url = new URL(`/ws?room=${room}`, baseUrl);
  url.protocol = url.protocol.replace("http", "ws");
  const ws = new WebSocket(url, { headers: { cookie } });
  let latest: RoomState | undefined;
  let waiters: Array<() => void> = [];
  ws.on("message", (data) => {
    const msg = JSON.parse(String(data));
    if (msg.t !== "state") return;
    latest = msg.room;
    for (const w of waiters) w();
  });
  const opened = new Promise((resolve) => ws.once("open", resolve));
  return {
    ws,
    opened,
    send: (msg: object) => ws.send(JSON.stringify(msg)),
    get state() {
      return latest!;
    },
    // resolves with the first state matching `pred`, within `ms`
    until(pred: (s: RoomState) => boolean, ms: number): Promise<RoomState> {
      return new Promise((resolve, reject) => {
        const check = () => {
          if (latest && pred(latest)) {
            waiters = waiters.filter((w) => w !== check);
            clearTimeout(timer);
            resolve(latest);
          }
        };
        const timer = setTimeout(() => {
          waiters = waiters.filter((w) => w !== check);
          reject(new Error(`no matching state within ${ms}ms; last: ${JSON.stringify(latest)}`));
        }, ms);
        waiters.push(check);
        check();
      });
    },
  };
}

it(
  "races two strangers live, refuses an instant finish, and remembers the result",
  async () => {
    const room = `spec-${Math.random().toString(36).slice(2, 10)}`;
    const [ca, cb] = [await visitor(), await visitor()];
    const name = `ada${Math.random().toString(36).slice(2, 7)}`;
    const a = racer(ca, room);
    const b = racer(cb, room);
    await Promise.all([a.opened, b.opened]);
    a.send({ t: "name", name });

    // A joins; B, just watching, sees it within a second.
    a.send({ t: "join" });
    await b.until((s) => s.entrants.some((e) => e.name === name), 1000);
    b.send({ t: "join" });
    const started = await a.until((s) => s.phase === "racing", 15_000);
    const length = started.quote.text.length;

    // Claiming the whole passage on the first keystroke doesn't finish it.
    a.send({ t: "progress", n: length, errors: 0 });
    const after = await b.until(
      (s) => s.entrants.find((e) => e.name === name)!.progress > 0,
      1000,
    );
    const claimed = after.entrants.find((e) => e.name === name)!;
    expect(claimed.finished).toBe(false);
    expect(claimed.progress).toBeLessThan(length);

    // Typed out at a plausible pace, A finishes; B wanders off mid-race.
    for (let n = 0; n <= length; n += 4) {
      a.send({ t: "progress", n: Math.min(n, length), errors: 1 });
      await new Promise((r) => setTimeout(r, 200));
    }
    a.send({ t: "progress", n: length, errors: 1 });
    await a.until((s) => s.entrants.find((e) => e.name === name)?.finished === true, 5000);
    b.ws.close();
    await a.until((s) => s.phase === "results", 5000);
    a.ws.close();

    // Coming back later, A's race is still there, and so is the leaderboard
    // entry a different visitor can see.
    expect(await page(ca)).toMatch(/1st of 2/);
    expect(await page(await visitor())).toContain(name);
  },
  60_000,
);

it("keeps a new visitor's name across visits", async () => {
  const cookie = await visitor();
  const name = `bo${Math.random().toString(36).slice(2, 7)}`;
  await fetch(new URL("/name", baseUrl), {
    method: "POST",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ name }),
    redirect: "manual",
  });
  expect(await page(cookie)).toContain(`value="${name}"`);
});
