# Crit 9 — All at once

**What was the breakthrough that moved the work forward?**

The room was already real-time — sockets, server-owned phases, a broadcast
loop — from the very first week of this project, so "make it sync" wasn't the
week's problem. The actual work was picking a stance on the concurrent
question the crit asks for: when does a race start for everyone at once, and
what do you see of people who aren't you. I'd shipped a flat 10-second
countdown with no visibility into anyone else's state, which is a genuine
multi-user design choice, just an unexamined one. This week replaced it with
one I can defend: a ready-up that lets the room start the moment everyone
agrees instead of everyone waiting out the clock
([`061ac88`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-isaacboentoro/commit/061ac88)),
and live carets so each racer sees exactly where everyone else is mid-keystroke
rather than only at the end
([`db46b65`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-isaacboentoro/commit/db46b65)).
The breakthrough wasn't technical — it was noticing that "the sockets work"
and "the concurrency is designed" are different claims, and only the second
one is what this crit is actually marking.

**What did this work change about who I want to be as a developer?**

I want to stop treating "it syncs" as the finish line for multi-user work. A
shared session has real decisions buried in it — what's visible, who waits for
whom, what a straggler sees — and skipping past them to the transport layer is
the easier bug to miss, not the harder one.
