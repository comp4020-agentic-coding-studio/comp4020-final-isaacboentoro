# ADR 0001: How a shared race starts, and what you see of everyone else

**Status:** Accepted (crit 9)

## Context

keyrace's whole point is a room of strangers typing the same passage at the
same time, so the brief's concurrency question isn't optional here — it's the
app. Before this crit, a race in a room worked like this: the first person to
type anything started a 10-second countdown; anyone else who typed in that
window joined; after 10 seconds, win or lose, the race started. During the
countdown and the race itself, you saw other entrants' names and a progress
bar that updated roughly ten times a second — but nothing that showed *where*
in the passage they actually were, character for character, while it was
happening.

That's a real answer to "what updates live versus what needs a reload" and
"is user presence visible" — it's just an answer nobody chose on purpose. It
was what came out of building the single-player loop first and bolting
multiplayer around it.

Two questions needed a real decision:

1. **When does a race actually start** once more than one person is on the
   line?
2. **What do you see of someone else** while a race is in progress?

## Decision

**1. Ready-up, with a timeout as the backstop, not the trigger.**
Each entrant can toggle "ready" during the countdown. The moment everyone on
the line is ready, the countdown collapses to a short fixed window (3s) and
the race starts — it no longer waits out the full 10 seconds if everyone
agreed at second 2. If someone never readies up, the original 10-second
countdown is still the ceiling, so one AFK racer can't hold the room hostage
indefinitely.

**2. Live per-character carets for every racer, not just a progress bar.**
Each entrant's position in the passage is broadcast with every keystroke (the
room coalesces this to at most 10 updates/second, same as before) and drawn
as a coloured, named caret directly in the passage text — not just a
percentage bar in a side list. You can watch someone else fumble a specific
word as it happens.

## Alternatives considered

| Option | Rejected because |
|---|---|
| **Keep the flat 10s countdown** | Matches "good" nowhere: it makes solo racers wait out a full countdown against nobody, and it's dead time for a room that's actually ready. Favours predictability over the feel of racing. |
| **Start the instant *anyone* is ready** | Defeats the purpose of a countdown entirely — one eager racer could start the race before a teammate has even loaded the passage. Technically simpler, but it isn't a multiplayer decision, it's the absence of one. |
| **Progress bar only (status quo)** | Cheaper to compute and simpler to render, but fails "feels like racing, not solo typing with a scoreboard bolted on" directly — a percentage doesn't tell you *where* someone is or that they just missed the word you're both on. |
| **Everyone's full keystroke history, replayed live** | Richer, but broadcasting every character (not just current position) multiplies the socket traffic for no benefit during the race itself — that level of detail is exactly what the post-race summary already gives you, after the fact, when it doesn't cost anything to compute. |

## Consequences

- A race in an empty-ish room (1–2 people) now typically starts in 3–6
  seconds instead of a fixed 10, which matters more than it sounds: the
  brief's "within about a second" responsiveness bar is about feel, and
  waiting out a countdown against nobody reads as broken, not patient.
- The room now tracks a `ready: boolean` per entrant and broadcasts it, and
  the client shows "ready ✓" / "joined" per lane — a small but real addition
  to the shared state every racer already sees.
- Live carets mean the passage view re-renders on every broadcast tick during
  a race (up to 10/sec) instead of only the lane list; at the room sizes this
  app is built for (a handful of racers in one room), that cost is invisible
  on the course's machine.
- This still doesn't answer what a *returning* user sees mid-race (they're
  shown as watching, not retroactively placed) — that's a deliberately
  separate decision, left as DNF-on-leave rather than rejoin, and not
  reopened here.

See [`061ac88`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-isaacboentoro/commit/061ac88)
(ready-up) and
[`db46b65`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-isaacboentoro/commit/db46b65)
(live carets).
