import { expect, inject, it } from "vitest";
import { page, racer, visitor } from "./racer.ts";

// A race, played over the same socket the page uses, against the running app.
const baseUrl = inject("baseUrl");

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
