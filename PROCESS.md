<!--
TEMPLATE: this is a scaffold, not a submission. Every commit cited below is
real and resolves in this repo — I checked each one with `git cat-file -e`
before listing it. The topic sentences and bracketed prompts are not your
account; replace them with your own words, in your own order, keeping only
the commits and claims that actually matter to the argument you want to make.
Delete this comment block (and any heading you don't use) before shipping.
`pnpm check:evidence` will fail the build if "TEMPLATE:" is still in the file.

Target: 900-1100 words, rewritten (not appended) to describe the CURRENT
project, with commits cited as GitHub links:
https://github.com/comp4020-agentic-coding-studio/comp4020-final-isaacboentoro/commit/<hash>
-->

# Process overview

Keyrace is a multiplayer typing game where players go head to head in typing quotes,
maintaining high words per minute and accuracy. I defined 'good' as everything 
being functional, having multiplayer netcode be robust and performant,
and the UI experience being cohesive and similar to other typing test websites
like Monkeytype.

## Stack and workflow — why this, over the alternatives

[The brief wants: how you got from brief to harness/workflow, why this stack
and this agent workflow, trade-offs WITH CITATIONS. Candidate material:]

- **One Node process, no framework, SQLite via `node:sqlite`.** Already
  argued in the old draft, but uncited — this is where the sources help:
  SQLite's own "Appropriate Uses For SQLite" (sqlite.org/whentouse.html —
  "any site that gets fewer than 100K hits/day should work fine"), Ben
  Johnson on Fly.io running SQLite server-side, Ben Hoyt "The small web is
  beautiful" ("start with a monolith"). Full citations with verified quotes
  are in `../keyrace-sources.md` (section D).
- **WebSockets over SSE/polling.** You have real sources for both sides of
  this: Gambetta and Fiedler on why the server must own game state (never
  trust client-claimed progress — directly ties to how `progress()` clamps
  speed), Figma's own writeup choosing WS + server authority over OT/CRDT.
  Against it: the SSE arguments (Lovell, germano.dev) are real counter-cases
  worth naming and rebutting (keyrace's traffic runs both ways: keystrokes
  up, carets down, ~10/s — the usual rebuttal to "you might not need
  WebSockets"). Section C of the sources file.
- **Directing the agent with examples, not instructions** — the old draft's
  two anecdotes (the banner, the word-boundary box) are fine evidence, keep
  them, but add citations:
  [`2d8d790`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-isaacboentoro/commit/2d8d790)
  is the word-boundary-box commit itself.
  [`061ac88`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-isaacboentoro/commit/061ac88)
  is the sprint mode + same input fix, same week.
- **Running multiple agents in parallel against a rubric, late in the
  project** — this session's own method (sources research, a rubric gap
  audit, marker-simulation testing, README-claims-as-tests, all running
  concurrently against separate local servers) is itself a workflow decision
  worth describing and justifying: why split the work this way, what each
  agent was scoped to touch, how conflicts between concurrent edits were
  avoided (separate ports/data dirs, file ownership by task).
- Anthropic's "Effective harnesses for long-running agents" and Simon
  Willison's "Vibe engineering" both back the test-first / harness-level
  direction approach generally. Section E of the sources file.

## How I knew a result was right, not just that it ran

[The HD band wants "how you knew the result was right before accepting it"
and "judgement in what was discarded." These are the strongest, most
specific instances in the history — pick 3-4, don't just list all of them:]

- **The grace-window bug: first fix was wrong, and a new spec caught it.**
  [`d7c9c75`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-isaacboentoro/commit/d7c9c75)
  added a 5-second reconnect grace so a dropped racer's race wasn't
  instantly forfeited. It was incomplete: if another racer finished while
  the first was mid-drop, the race still ended early. A new spec reproduced
  exactly that case, failed against the first fix, and
  [`331d18c`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-isaacboentoro/commit/331d18c)
  replaced the ad-hoc check with one `settle()` function both code paths
  call. This is the clearest "diagnosed and fixed at the harness level
  rather than retried" instance in the repo — worth describing in full,
  including *how* the gap was found (not guessed at — a test that modelled
  the real race condition).
- **The identity leak: hashing wasn't enough, so the scheme was replaced.**
  [`cfb9471`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-isaacboentoro/commit/cfb9471)
  found that player cookie-ids were published in every leaderboard entry —
  anyone could copy an id and become that player. The first instinct was to
  hash the published value. That doesn't un-leak ids already published, so
  [`5d745fe`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-isaacboentoro/commit/5d745fe)
  replaced cookies with server-minted secrets instead, rotating every
  existing session. Good example of "judgement in what was discarded" — the
  first fix was discarded, not patched.
- **`pnpm shoot` only counts once it's caught its own bug.**
  [`949dd7f`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-isaacboentoro/commit/949dd7f)
  is where the principle gets stated outright: a check isn't trusted until
  you've planted the bug it's meant to catch and watched it fail. Two later
  commits are the actual payoff of that discipline:
  [`27c5850`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-isaacboentoro/commit/27c5850)
  (shoot's first real run found genuine contrast failures and wrapped
  layout) and
  [`c83464b`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-isaacboentoro/commit/c83464b)
  (same tool, caught arcade score-pop animations failing contrast
  mid-fade). This is "how you knew the result was right" made concrete: not
  by reading the diff, by running an adversary against it and watching it
  fail first.
- **Fuzzing found two whole-process crash bugs.**
  [`a3a3d90`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-isaacboentoro/commit/a3a3d90) —
  a single malformed WebSocket frame, or one slightly oversized, crashed the
  entire server (every room, every connected racer), not just the
  connection that sent it. Found by deliberately attacking the local
  server's protocol, not by review. Worth naming because it's the
  "holds up under use it wasn't designed for" artefact criterion made
  concrete at the code level, not just the UI level.

## The multi-user decision — still worth keeping, trim and re-date

[The old crit-9 material (ready-up, live carets, ADR link) is still true and
still good evidence — keep it, but note in prose that it was the *original*
multi-user decision and that later weeks revisited part of it: the ADR's
"leaving mid-race is a DNF" consequence
(`docs/adr-0001-concurrency.md`) is now contradicted by the grace window
above. Either update the ADR's status, or add a short ADR 0002, and say so
here — an ADR that visibly disagrees with the shipped app reads as
process evidence NOT being corroborated, which is the thing to avoid.]

## Netcode, themes, and the UI rebuild — pick what serves the argument

[Don't narrate every commit — these are here so you can choose what's worth
a sentence or two, tied back to your definition of good:]

- Netcode trim:
  [`12f489e`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-isaacboentoro/commit/12f489e)
  — measured 1802→452 B per message (the passage was being resent every
  tick) and turned that measurement into a budget `pnpm shoot` now enforces
  and can only tighten.
- Themes went from 14 hand-picked
  ([`96c3414`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-isaacboentoro/commit/96c3414))
  to ~189 generated from Monkeytype's published palettes
  ([`387e495`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-isaacboentoro/commit/387e495),
  [`f79ade3`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-isaacboentoro/commit/f79ade3)),
  each nudged to hold WCAG contrast and kept apart via a separate rule you
  added after noticing some themes made typed and untyped text visually
  identical
  ([`d13ff5b`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-isaacboentoro/commit/d13ff5b)).
  **If you keep this**, you need to say in the README why ~189 themes serve
  your definition of good (e.g. "readable for everyone, in whatever palette
  you already use") — the rubric marks down features with no reason in the
  stated definition, and this is the single largest feature surface with no
  home there yet.
- The Monkeytype-style UI rebuild
  ([`7631981`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-isaacboentoro/commit/7631981),
  [`3b8e0a4`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-isaacboentoro/commit/3b8e0a4),
  [`b132602`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-isaacboentoro/commit/b132602))
  — worth a sentence on what you deliberately did NOT take from Monkeytype
  and why (it's GPL-3.0; no code/CSS copied, only colour values as data;
  kept the visible typing box and live carets where Monkeytype hides
  everything, because co-presence is the point of your app and Monkeytype's
  isn't).

## Commit trail

[Keep a short version of this — the old one, extended to the current tip,
rather than a wall of links. The full list is in `git log`; this section
should point at the handful of commits above, not restate every hash.]
