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

<!--
TEMPLATE: full commit list below, grouped by topic (not date), oldest first
within each group. Every hash verified with `git cat-file -e` against this
repo. For each: what the commit actually did (short), then what it's
EVIDENCE OF against the rubric, then a one-line prompt for what to write.
You will use maybe a third of these — the rest are here so you don't have
to re-read `git log` to find the right one. Delete this whole block once
you've picked what you want and written it into the sections above.

=== Foundation (week 9 / crit 8) ===

f6477c2 Initial commit
  Evidence of: nothing, just the starting point. Don't cite.

24436f4 Add SQLite store and passages for races
  node:sqlite on the /data volume; passages are public-domain openings
  plus a few originals (later removed, see 1694009).
  Evidence of: the stack decision (no extra DB dependency).
  Write about: if making the stack case — "why SQLite, why no ORM."

bb49141 Add server-owned race rooms
  Lobby/countdown/race/results phases run server-side; progress clamped
  to 25 chars/s; a race ends early once nobody connected is typing.
  Evidence of: the server-authoritative design decision, made on day one,
  not bolted on later. This is probably your single best "architectural
  commitment made early" citation.
  Write about: crit-8's breakthrough (also in reflections/crit-8.md —
  keep the two consistent, don't contradict the reflection here).

785a97d Serve the race page, socket and README from one Node process
  Anonymous cookie identity, rooms at /r/<name>, README at /readme/.
  Evidence of: deploying on day one rather than treating it as a later
  step (also cited in crit-8.md).
  Write about: the "one process" stack claim, if not covered already.

93a9242 Check a two-racer race end to end against the running app
  First spec: live join visible within a second, instant finish refused.
  Evidence of: testing against the real brief requirements (real-time,
  multi-user) from the very first spec, not just unit-level checks.
  Write about: your testing philosophy, if you want an early example
  alongside the later ones (949dd7f, a3a3d90).

8b8c01e Drop closing sockets from a room without waiting for close
  Deployed, the spec failed: Fly's proxy delays the close event by >5s
  behind its own close frame, so a left racer kept a "finished" race
  running. Fixed by polling socket state instead of trusting the event.
  Evidence of: a bug that ONLY SHOWS UP DEPLOYED, found by testing against
  the real deployed app rather than localhost. Strong "how did you know it
  was right" material — it wasn't right until it was checked for real.
  Write about: good candidate for the "how I knew a result was right"
  section if you want a second instance beside the grace-window one.

7a730ad Let typing in the lobby join the next race
  Minor UX fix, input disabled until Join clicked.
  Evidence of: nothing load-bearing. Skip unless you need a filler example.

=== Crit 9 (week 10) — modes, ready-up, carets ===

db46b65 Add code and words modes, ready-up, live carets and a race summary
  The big crit-9 feature commit: modes, ready-up, live carets, summary.
  Evidence of: the crit-9 multi-user decision (already covered above and
  in the ADR). Already cited in your existing "multi-user decision"
  section — don't re-cite unless adding detail.

2d8d790 Make joining and starting pulse for attention, and cap typing by word
  Pulsing banner/button; other racers' carets get a tinted background,
  not just a line; typing box capped by word boundary instead of a flat
  8-char overrun.
  Evidence of: the "more obvious" directed-example anecdote already in
  your old draft and in reflections/crit-9.md. Co-authored by Sonnet 5,
  not Opus — if your account discusses model choice/switching, this and
  061ac88 are your evidence for it.
  Write about: already covered by the existing anecdote; cite this hash
  explicitly if you're not already.

061ac88 Add a timed sprint mode, and make the typing box hold one word at a time
  Sprint mode; the word-commit input logic. Also: "wiped the leaderboard:
  it was all spec-run traffic I'd pointed at the live app earlier."
  Evidence of: (a) the word-boundary-box anecdote (cite this, not just
  2d8d790 — this is where the mechanism actually landed); (b) the FIRST
  instance of the "don't test against the live site" lesson, which later
  became a CLAUDE.md rule (a497381) and happened AGAIN later in the
  session (see the b02ff26/387e495 testing-against-fly.dev note below —
  actually check: did it happen twice? If so this is a judgement-not-
  shown risk unless you say so explicitly: "I made this mistake once,
  wrote the rule down, and still have to watch for it.")
  Write about: definitely cite this for the leaderboard-wipe origin story
  mentioned in CLAUDE.md's "never test against the live site" rule.

74a2c25 Write PROCESS.md, the README, and an ADR for the concurrency decision
  The original PROCESS.md/README.md/ADR commit. This is the commit this
  very file replaces. Don't cite it as evidence of anything except
  "here is where the documentation habit started" if relevant.

e46330b Cap the passage's height and add a toggleable tape mode
03cec85 Centre and steady the tape, and clear the page while you race
  Tape mode added, then fixed: every broadcast (10/s) was rebuilding the
  passage, resetting tape's scroll to zero every time. Root cause
  diagnosed (rebuild vs restyle), fixed, verified in headless Chromium
  that the caret stays within 1px of centre.
  Evidence of: another clean "diagnosed the actual cause, verified with a
  measurement, not just eyeballed" instance.
  Write about: candidate for "how I knew it was right" if you want a UI-
  side example alongside the backend-side ones (grace window, identity).

=== Input mechanics, animation (mid-October) ===

7389713 Let backspace reopen the last word while there's a mistake to fix
  One wrong word made a race literally unfinishable (progress only counts
  the correct prefix). Backspace now reopens the committed word.
  Evidence of: a real correctness bug in the core interaction, found and
  fixed. Worth a sentence if you discuss the typing mechanics at all.

21508a8 Animate changes of state instead of jumping between them
8125f12 Make the step into a race read as motion, not a cut
  View-transition animations added, then refined (first attempt's easing
  front-loaded, chrome just vanished instead of animating, passage
  crossfaded small/large copies instead of scaling).
  Evidence of: an iterate-until-right pattern on UI polish — lower stakes
  than the security/crash fixes, but shows the same "first attempt wasn't
  right, and I could tell because I looked at it" habit if you want a
  low-stakes example to contrast with the high-stakes ones.

=== Security (the identity leak) ===

cfb9471 Stop publishing players' cookie ids; name them by a hash instead
5d745fe Retire every cookie that was ever an id; sign in by a hashed secret
  Already in your "how I knew a result was right" section above as the
  flagship "discarded, not patched" example. Don't duplicate — just make
  sure the prose makes clear cfb9471 was found to be INSUFFICIENT (not
  wrong, just incomplete) and that's why 5d745fe exists, rather than
  reading as two unrelated security commits.

=== Netcode ===

12f489e Trim the netcode: passage once, gzip and 304s, backoff, steady clock
  Already in your draft's "netcode" section. Measured 1802->452 B/msg.
  Also: reconnect backoff, gzip+ETag on static files, clock sync via
  lowest-latency ping. Four distinct fixes in one commit — if you want
  to cite just one number, the 452B one is already picked; the clock-
  sync-via-lowest-latency-ping detail is a second citable engineering
  decision in the same commit if you want more stack-case material.

=== pnpm shoot (the browser sensor) ===

949dd7f Add pnpm shoot: drive real Chromium through a race and fail loudly
  Already cited as the "a check doesn't count until it's caught its own
  bug" flagship example. This is the commit that STATES the principle;
  27c5850 and c83464b (below) are where it PAYS OFF.

27c5850 Fix what pnpm shoot found: faint secondary text, wrapped lane stats
  shoot's first real run found genuine bugs: dim colour held to 3.5-4:1
  when body text needs 4.5:1; lane stats wrapping on phone.
  Evidence of: the sensor working on its first real use, not just in
  theory. Already cited in your draft — good, keep it.

c83464b Play an arcade round in pnpm shoot, and say why axe failed
  shoot extended to arcade mode; caught score-pop animations failing
  contrast mid-fade. Also: axe failures made to report WHY (markup +
  reason), not just a selector — a harness-quality-of-life fix.
  Evidence of: same pattern, second instance, PLUS an example of
  improving the harness's own error messages (a modest but real
  "fixed at the harness level" instance if you need a filler one).

=== Reconnect / grace window (multiplayer robustness) ===

d7c9c75 Hold a race open for a racer whose connection drops
331d18c Don't end a race on a racer still inside their reconnect grace
  Already your flagship "first fix was wrong" example. d7c9c75 is the
  FIRST fix (incomplete); 331d18c is the correction found by a new spec.
  Make sure you cite BOTH hashes, not just 331d18c — the whole point of
  the anecdote is that there were two attempts.

=== Arcade mode ===

d205088 Add arcade mode: combos, clean-word streaks and a multiplier
  Server computes score from accepted progress, never from a client-sent
  number; spec checks a forged score does nothing.
  Evidence of: "never trust the client" applied to a NEW feature, not
  just the original race logic — shows the rule generalised, not a
  one-off. Good if your stack-case section discusses server authority
  as a standing principle rather than a single decision.

=== Crash bugs (fuzzing) ===

a3a3d90 Fix two one-frame crashes: a bare null, an oversized message
  Already your flagship fuzzing example (also in reflections/crit-10.md
  — keep consistent). A bare `null` JSON value and an oversized WS frame
  each crashed the ENTIRE process (every room), not just one connection.
  Found by deliberately attacking the local server's protocol.
  Write about: note it's co-authored by Sonnet 5 if that's relevant to
  a workflow/model-choice discussion.

9682c54 Fix tape mode being unreachable for the whole countdown and race
  Found by a "multiplayer UI test pass" (your own phrase in the commit
  body) — tape toggle lived inside a container hidden during races.
  Evidence of: UI testing methodology, finding a real accessibility/
  usability bug (a feature literally unreachable for most of a session).
  Write about: if discussing testing methodology beyond pnpm shoot, this
  is evidence of a separate "drive the actual UI and look for what's
  unreachable" pass, distinct from shoot's automated checks.

=== UI/motion polish ===

fde0756 Square every corner and give the race sharper motion
  No-rounded-corners rule (now in CLAUDE.md), hard shadows, several small
  animations (button press, digit snap, results stagger), all gated on
  prefers-reduced-motion.
  Evidence of: a design-system-level rule that then became a CLAUDE.md
  entry — if you discuss how CLAUDE.md's rules originated, this is one
  concrete source.

=== Presence bug, robustness pass, README entry point ===

78c1e74 Let a room see someone arrive
  Room.add broadcast BEFORE counting the newcomer in, so arrivals were
  invisible to everyone already in the room until some unrelated later
  change. Found by a new spec (spec/claims.test.ts) built to check the
  README's own claim about seeing others arrive.
  Evidence of: (a) a REAL bug in the single most central claim of the
  whole app (co-presence) that every earlier check had missed, because
  no earlier check measured "does a new arrival show up"; (b) the method
  of building tests FROM the README's claims, which is itself a
  process/workflow decision worth describing. Strong candidate — this
  bug directly touches your core "feels like racing" claim.
  Write about: if your README's definition of good leads with co-
  presence, this bug and its fix are some of your best evidence that the
  definition is actually enforced, not just asserted — exactly what the
  rubric rewards ("does the app live up to it").

ea4da8e Hold up under a dropped line, a reload, a resize and a keyboard
  A large multi-bug fix from simulating marker conditions: two separate
  browser profiles, one per marking viewport, a throttled/cut connection
  via a custom TCP proxy (Chromium's own throttling skips WebSockets),
  keyboard-only play, simultaneous actions. Found and fixed: reconnect
  backoff outslept the server's grace window (71/71 offline keystrokes
  now counted on reconnect), "Lost the connection" message overwritten
  within a second, reload mid-race restarting progress at 0 and dragging
  other racers' views backward, empty summary when joining mid-results,
  Tab trapped in the typing box with no keyboard escape.
  Evidence of: testing methodology built directly from how the brief
  says markers actually test ("two separate Chrome profiles... one at
  each marking viewport... return the next day"). This is arguably your
  single strongest "artefact holds up under use it wasn't designed for"
  citation — it's not incidental robustness, it's robustness built by
  literally simulating the marking protocol.
  Write about: if your Response-to-the-brief argument discusses how you
  interpreted "the marker arrives with only the URL," this commit is
  the concrete evidence that you took that literally and tested against
  it, not just the happy path.

11179b8 Give /readme/ a way into the race, and render the docs it links
  /readme/ had NO link to the actual race except the logo. Markers start
  at /readme/ per the brief. Also fixed: the README's own link to the ADR
  404'd.
  Evidence of: a gap between what the README implies ("read this, then go
  try it") and what the app actually offered a marker arriving cold.
  Directly relevant to "markers look for the same idea in README, CLAUDE.md,
  spec/ and the app, in that order" — this was a place where the chain
  broke at the very last link.
  Write about: good one-sentence citation for the "response to the brief"
  self-assessment, if you discuss how you checked the README/app
  consistency the rubric asks about.

5c8f51a Check each README claim by name, and stop specs crowding the board
  spec/claims.test.ts: one test per enforceable README sentence, named as
  the claim. Also fixed a self-inflicted bug: the grace spec's near-cap
  (~295 wpm) results were crowding real results off the leaderboard
  checks after repeated local runs.
  Evidence of: the "separate enforced claims from judged ones" rubric
  point, operationalised directly — this commit IS that separation, in
  code. One of your most directly relevant citations for Response to the
  brief. The self-inflicted leaderboard-crowding bug is also a small
  "caught my own mistake before it mattered" instance.
  Write about: if your README has (or will have) a section distinguishing
  enforced vs. judged claims, this commit is where that distinction
  became real rather than just stated. Strongly recommend citing this.

1694009 Drop the three quotes credited "Original"
  spec/claims.test.ts's new quotes-test caught that 3 of the "quotes"
  passages weren't from public-domain books as the README claims. Fixed
  by removing the 3, not rewording the claim.
  Evidence of: choosing to fix the APP to match the claim rather than
  weaken the claim to match the app — a small but real instance of
  letting a check actually constrain a decision.

=== CLAUDE.md ===

a497381 Write CLAUDE.md: rules derived from this project's own incidents
  The harness file itself — every rule traces to a specific commit/
  incident in this history (cited inline in CLAUDE.md itself).
  Evidence of: CLAUDE.md "growing" over the project rather than staying
  template boilerplate — this IS the growth. Must be mentioned somewhere
  in PROCESS.md; the rubric explicitly reads CLAUDE.md as part of
  process evidence, and a PROCESS.md that never mentions it is a gap.
  Write about: a short paragraph on HOW CLAUDE.md's rules originated
  (from real incidents, not invented upfront) is probably worth more
  than listing the rules themselves — the rubric cares about the
  practice, not the document.

=== Monkeytype UI rebuild (early November) ===

7631981 Restyle the passage: one monospace face, a gliding caret, pace on top
3b8e0a4 Turn the top bar and mode strip into a quiet text toolbar
b132602 Lead the results with your numbers, and quiet the sidebar
  The three UI-rebuild commits, each with an explicit "What changed /
  Why / How verified" structure in the commit body — unusually complete
  commit messages, worth citing for THAT alone (shows deliberate
  documentation discipline, not just code).
  Evidence of: (a) re-creating a visual language from an idea rather than
  copying code (explicitly stated: "Re-created from the idea, not its
  code" in 3b8e0a4) — relevant if your Response argument discusses taking
  from Monkeytype without taking its (GPL-3.0) code; (b) each commit was
  verified with screenshots at both marking viewports AND pnpm shoot,
  before being called done.
  Write about: if you keep any Monkeytype-inspired framing in the README,
  these three commits are your evidence of HOW you kept it clean of
  actual Monkeytype code/CSS — worth a sentence on the GPL-3.0 boundary
  you held (palette DATA used, no code/CSS/markup copied — same
  boundary noted in 387e495 below).

=== Monkeytype theme import ===

387e495 Generate the themes from Monkeytype's palettes, contrast fixed at build
f79ade3 Offer Monkeytype's themes in the picker, colours fetched only when picked
b02ff26 Hold every theme to contrast in shoot and the spec, not just a sample
d13ff5b Keep typed letters apart from untyped, and the accent from the dim
db25d5f Underline what you've typed, so it never rests on colour alone
  Five commits: vendor ~187 Monkeytype palettes (data only, GPL-3.0,
  pinned to an upstream commit, header says so) -> generate theme tokens
  with contrast nudged at build time -> load lazily so first-load budget
  holds -> extend shoot/spec to check ALL 189 themes, not a sample ->
  THEN found (by eye, looking at a screenshot) that many themes made
  typed and untyped text nearly indistinguishable, because no existing
  check compared colours to EACH OTHER, only each colour to the
  background -> added a separation check, fixed the generator, added a
  non-colour (underline) cue per WCAG 1.4.1.
  Evidence of: this whole sequence is probably your best single
  "corroborated and skilled" narrative in the entire history, IF you
  write it as a sequence rather than five isolated commits:
    1. a real engineering problem (189 palettes can't be nudged by eye,
       unlike the original 14) solved with a build-time tool, not manual
       tuning;
    2. budget discipline carried through a 13x increase in theme count
       (26.0kB -> 28.6kB, still under the 40kB budget);
    3. the check coverage gap ITSELF found and closed (shoot/spec
       originally sampled, now covers all 189) — process improving its
       own harness;
    4. a bug (d13ff5b) found NOT by an automated check but by looking at
       a screenshot — worth being honest that this one wasn't caught by
       any existing check, which is exactly why the rubric asks what you
       discarded/improved, not just what passed;
    5. the fix add a check (separation) that didn't exist before, proven
       against a planted failure, same discipline as 949dd7f.
  Write about: this is a strong candidate for your single longest/most
  detailed paragraph if you have room — it has discovery, root-cause
  analysis, a build-time fix, a coverage gap closed, AND a new check
  proven against a planted bug, all in one connected story. But ALSO:
  be honest that ~189 themes is a large feature surface, and your
  README needs to say why it serves your definition of good (see your
  own earlier note about this in the "Netcode, themes, and the UI
  rebuild" section above) — don't let the engineering quality of this
  work substitute for that argument being absent.

=== Reflections / CLAUDE.md follow-up (this week) ===

1db98e5 Add crit-8 and crit-10 reflections, trim crit-9, add a template
  Not really commit-worthy evidence for PROCESS.md itself — it's
  process evidence about process evidence. Skip citing it directly;
  mention reflections/ as a whole if relevant.

-->

