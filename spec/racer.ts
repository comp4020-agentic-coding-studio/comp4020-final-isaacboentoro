import { expect, inject } from "vitest";
import WebSocket from "ws";

// Plays the page's side of the socket against the running app, for specs.
const baseUrl = inject("baseUrl");

export interface Entrant {
  id: string;
  name: string;
  progress: number;
  finished: boolean;
  place: number | null;
  ready: boolean;
}
export interface RoomState {
  phase: "lobby" | "countdown" | "racing" | "results";
  mode: "quotes" | "words" | "code" | "sprint";
  endsAt: number;
  now: number;
  quote: { text: string };
  entrants: Entrant[];
  queued: string[];
}

export interface Summary {
  mode: string;
  text: string;
  entrants: Array<{
    id: string;
    name: string;
    place: number | null;
    wpm: number;
    misses: Array<{ i: number; got: string; t: number }>;
    series: Array<[number, number]>;
  }>;
}

// A fresh visitor: whatever cookie the app hands a first-time browser.
export async function visitor(): Promise<string> {
  const res = await fetch(baseUrl);
  const cookie = res.headers.get("set-cookie")?.split(";")[0];
  expect(cookie, "the app gives a new visitor an identity cookie").toBeTruthy();
  return cookie!;
}

export async function page(cookie: string, path = "/"): Promise<string> {
  return (await fetch(new URL(path, baseUrl), { headers: { cookie } })).text();
}

export function racer(cookie: string, room: string) {
  const url = new URL(`/ws?room=${room}`, baseUrl);
  url.protocol = url.protocol.replace("http", "ws");
  const ws = new WebSocket(url, { headers: { cookie } });
  let latest: RoomState | undefined;
  let summary: Summary | undefined;
  let waiters: Array<() => void> = [];
  ws.on("message", (data) => {
    const msg = JSON.parse(String(data));
    if (msg.t === "summary") summary = msg.race;
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
    get summary() {
      return summary;
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
