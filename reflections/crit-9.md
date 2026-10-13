# Crit 9 — All at once

**What was the breakthrough that moved the work forward?**

The room was already real-time — sockets, server-owned phases, a broadcast
loop — from the very first week of this project, so "make it sync" wasn't the
week's problem. The actual work was picking a stance on the concurrent
question the crit asks for: when does a race start for everyone at once, and
what do you see of people who aren't you. I'd shipped a flat 10-second
countdown with no visibility into anyone else's state, which is a genuine
multi-user design choice, just an unexamined one.

My process this week was directive rather than open-ended: I gave the agent a
concrete brief up front — new typing modes, a more obvious join/start flow,
live carets for other racers, a post-race summary with a WPM graph — and let
it propose the implementation, but I kept steering with specific examples
rather than approving the first pass. When "more obvious" produced a banner
that was easy to miss, I pointed at exactly what was missing (a pulsing cue,
not just text) and named the states that needed it: joining from the lobby,
readying up once on the line. When the typing box let you type arbitrarily
far past a mistake, I didn't describe the fix abstractly — I said it should
behave like a real typing test, one word at a time, and let the agent work
out that meant capping input at the current word's boundary and committing on
the space. That loop — brief, implementation, concrete correction grounded in
an example of the behaviour I wanted, re-check — repeated for each feature:
ready-up and live carets first, then the word-boundary input and a timed
sprint mode once I'd seen the first round working. Each round I also had the
agent run the thing for real (a headless browser driving both sides of a
race) rather than take the diff on faith, which is how the word-commit bug
(it was clearing the whole typed string instead of just the committed prefix)
got caught before it shipped.

The breakthrough wasn't technical — it was noticing that "the sockets work"
and "the concurrency is designed" are different claims, and only the second
one is what this crit is actually marking. Ready-up
([`061ac88`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-isaacboentoro/commit/061ac88))
and live carets
([`db46b65`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-isaacboentoro/commit/db46b65))
are the concrete answer to it: the room starts the moment everyone agrees
instead of everyone waiting out a clock, and every racer sees exactly where
everyone else is mid-keystroke rather than only at the end.

**What did this work change about who I want to be as a developer?**

I want to stay the one who gives the example, not just the instruction.
Telling an agent "make it more obvious" or "fix the input" underspecifies the
decision; showing it the concrete case I mean — this exact state should pulse,
this exact keystroke should be rejected — turned a vague iteration loop into
one that converged in a round or two instead of several. I also want to keep
verifying behaviour by running it, not by reading the diff: the one bug that
actually mattered this week was only visible by driving the browser and
watching the input box, never from the code alone.
