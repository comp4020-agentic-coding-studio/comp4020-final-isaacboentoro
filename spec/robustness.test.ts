import { expect, inject, it } from "vitest";
import WebSocket from "ws";
import { page, racer, visitor } from "./racer.ts";

// A hostile or just broken client shouldn't take the room, let alone the
// whole process, down with it. Each test sends something no real page would
// send, then checks the server answered at all afterwards and that someone
// else in the same room was never affected.
const baseUrl = inject("baseUrl");
const freshRoom = () => `spec-${Math.random().toString(36).slice(2, 10)}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function rawSocket(room: string): Promise<WebSocket> {
  const cookie = await visitor();
  const url = new URL(`/ws?room=${room}`, baseUrl);
  url.protocol = url.protocol.replace("http", "ws");
  const ws = new WebSocket(url, { headers: { cookie } });
  await new Promise((resolve) => ws.once("open", resolve));
  return ws;
}

// Progress only counts once the race is actually running, so get a lone
// racer there the same way the "ready-up" path does: joining starts the
// countdown, readying collapses it to READY_MS instead of the full 10s.
async function racing(room: string) {
  const r = racer(await visitor(), room);
  await r.opened;
  r.send({ t: "join" });
  await r.until((s) => s.phase === "countdown", 1000);
  r.send({ t: "ready" });
  await r.until((s) => s.phase === "racing", 4500);
  return r;
}

it("stays up for everyone when a socket sends a bare JSON null", async () => {
  const room = freshRoom();
  const bystander = await racing(room);

  const attacker = await rawSocket(room);
  attacker.send("null"); // valid JSON; parses to a value with no `.t`
  await sleep(300);

  expect((await fetch(baseUrl)).status).toBe(200);
  bystander.send({ t: "progress", n: 1, errors: 0 });
  await bystander.until((s) => s.entrants[0]?.progress === 1, 1000);
  attacker.close();
  bystander.ws.close();
});

it("stays up for everyone when a frame is over the WebSocket's payload cap", async () => {
  const room = freshRoom();
  const bystander = await racing(room);

  const attacker = await rawSocket(room);
  const closed = new Promise((resolve) => attacker.once("close", resolve));
  attacker.send("x".repeat(5000)); // over maxPayload (4096)
  await closed; // the oversized frame should close just this socket

  expect((await fetch(baseUrl)).status).toBe(200);
  bystander.send({ t: "progress", n: 1, errors: 0 });
  await bystander.until((s) => s.entrants[0]?.progress === 1, 1000);
  bystander.ws.close();
});

it("doesn't crash on other junk a client could send", async () => {
  for (const payload of ['"just a string"', "42", "[1,2,3]", "{", ""]) {
    const ws = await rawSocket(freshRoom());
    ws.send(payload);
    await sleep(100);
    ws.close();
  }
  expect((await fetch(baseUrl)).status).toBe(200);
  // the room page itself should still render fine after all of that
  expect(await page(await visitor())).toContain("keyrace");
});
