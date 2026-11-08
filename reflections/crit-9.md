# Crit 9 — All at once

**What was the breakthrough that moved the work forward?**

The room was already real-time — sockets, server-owned phases, a broadcast
loop — from week one, so "make it sync" wasn't this week's problem. The real
work was picking a stance on the concurrent question the crit asks for: when
does a race start for everyone at once, and what do you see of people who
aren't you. I'd shipped a flat 10-second countdown with no visibility into
anyone else's state — a genuine multi-user decision, just an unexamined one.

I directed the agent with concrete examples rather than open-ended asks.
When "more obvious" produced a banner that was easy to miss, I named the
exact states that needed a pulsing cue rather than re-describing "obvious".
When the typing box let you run arbitrarily far past a mistake, I said it
should behave like a real typing test, word by word, and let the agent work
out the mechanism. I also had it run the thing for real — a headless browser
on both sides of a race — rather than take the diff on faith, which is how a
real word-commit bug got caught before it shipped.

The breakthrough wasn't technical: "the sockets work" and "the concurrency
is designed" are different claims, and only the second is what this crit
marks. Ready-up
([`061ac88`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-isaacboentoro/commit/061ac88))
and live carets
([`db46b65`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-isaacboentoro/commit/db46b65))
are the answer: the room starts the instant everyone agrees, and every racer
sees exactly where everyone else is mid-keystroke.

**What did this work change about who I want to be as a developer?**

I want to stay the one who gives the example, not just the instruction, and
to keep verifying behaviour by running it rather than reading the diff.
