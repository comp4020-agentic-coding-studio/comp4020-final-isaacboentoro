# Process overview

keyrace is a typing race: pick a mode, race whoever's in the room, watch
everyone else's caret move through the passage live, see a WPM graph and a
mistake breakdown when it ends. The brief asked for something real-time with a
genuine multi-user design decision behind it, built and steered with an
agent rather than hand-written line by line.

## Stack

One Node process (`server/main.ts`) runs the HTTP server, the WebSocket
upgrade, and SQLite (`node:sqlite`, no extra dependency) — small enough that
the course's 256 MB machine runs it with nothing else, and simple enough that
there's no build step: Node runs the TypeScript in `server/` directly. The
client (`public/app.js`) is one plain script with no framework; the server
owns every race decision (phases, timing, placings) and the client only
renders what it's told and reports keystrokes back.

## How I worked with the agent

I didn't describe features in the abstract and accept the first result. For
each piece of work I gave a concrete brief — new typing modes, a more obvious
join/start flow, live carets for other racers, a post-race summary with a WPM
graph — then reviewed what came back against specific examples of the
behaviour I actually wanted, rather than general feedback like "make it
better."

Two cases from this week show the pattern:

- **"More obvious" wasn't obvious enough the first time.** The agent's first
  pass added a status line and a button, which read fine in isolation but
  didn't draw the eye. I pointed at the exact states that needed a visible
  cue — joining from the lobby, readying up once on the line — rather than
  re-describing "more obvious," and that's what got the pulsing banner and
  button instead of another static label.
- **"Fix the input box" became "type one word at a time, like a real typing
  test."** The box originally let you run eight characters past any mistake
  before locking, which is an arbitrary number with no reason behind it.
  Giving the agent that one concrete example — behave like a typing test,
  word by word — was enough for it to work out the actual mechanism: cap
  input at the current word's end, commit the word on its closing space, and
  clear the box for the next one.

The loop each time was: brief with an example → implementation → run it for
real → correct with another concrete example if it wasn't right → re-check.
"Run it for real" was not rhetorical — I had the agent drive a headless
browser against the running app on both sides of a race rather than trust the
diff, which is how a real bug surfaced: the word-commit logic was clearing
the whole typed string instead of just the already-committed prefix, visible
only by watching the input box empty at the wrong moment, not by reading the
code.

## The multi-user decision — crit 9

Before this week, a race started on a flat 10-second countdown with no
visibility into anyone else in the room: you typed blind until the result
screen. That's a real concurrency decision, just an unexamined one. This
crit's work replaced it with two deliberate choices, recorded as an ADR in
[`docs/adr-0001-concurrency.md`](docs/adr-0001-concurrency.md):

1. A **ready-up** that lets the room start the instant everyone agrees,
   instead of everyone waiting out the full countdown regardless.
2. **Live carets**, so every racer sees exactly where everyone else is
   mid-keystroke, not just at the end.

See commits
[`061ac88`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-isaacboentoro/commit/061ac88)
and
[`db46b65`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-isaacboentoro/commit/db46b65).

## Commit trail

The repo's history is the incremental record: sockets and server-owned race
rooms first
([`bb49141`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-isaacboentoro/commit/bb49141)),
then the page, socket and README served from one process
([`785a97d`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-isaacboentoro/commit/785a97d)),
verified end to end against the running app
([`93a9242`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-isaacboentoro/commit/93a9242)),
then this week's modes, ready-up, live carets and summary
([`db46b65`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-isaacboentoro/commit/db46b65)
through
[`061ac88`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-isaacboentoro/commit/061ac88)).
