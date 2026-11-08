# Crit 10 — Fly by instruments

**What was the breakthrough that moved the work forward?**

This crit asks what happens when real strangers hit the app with no one
steering them, and the honest way to find that out was to attack it myself
first. I had the agent fuzz the WebSocket protocol — malformed messages,
oversized frames, forged scores — against a local server, never the live
one. It found that a single bare `null` frame, or one frame over the size
limit, crashed the entire process: every room, every connected racer, gone
([`a3a3d90`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-isaacboentoro/commit/a3a3d90)).
That's not a typing-race bug, it's a two-classmates-from-the-URL bug: one
person's broken connection taking down the other's race.

The same pass found that player identity was published in plain sight —
your login cookie was your database id, sent back out in every leaderboard
([`cfb9471`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-isaacboentoro/commit/cfb9471),
[`5d745fe`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-isaacboentoro/commit/5d745fe)).
The first fix hashed the published value; the second realised that didn't
un-leak what was already out there, and replaced the whole scheme with a
server-minted secret instead.

The real discipline was refusing to call a check real until it had caught
the bug it was written for
([`949dd7f`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-isaacboentoro/commit/949dd7f)):
plant the bug, watch the test fail, then fix it.

**What did this work change about who I want to be as a developer?**

I want to attack my own work before a stranger does. Reading the code for
bugs and running an adversary against it are different activities, and only
the second one found the crash that mattered.
