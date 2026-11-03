# keyrace: rules for the agent

keyrace is a typing race for whoever is in the room right now. The README is
the argument for what good means here; these are the rules that follow from
it. `spec/` checks the ones a machine can check. When a rule and a request
conflict, stop and say so rather than quietly picking one.

## What the app must never do

- **Never trust the page.** The server owns the clock, the placings, every
  finish and every arcade point. A number the client sends is a claim, checked
  against the typing-speed cap, never a fact. (`bb49141`, `d205088`)
- **Never publish a secret.** A player's cookie is their identity. Nothing that
  leaves the server names a player by anything but a public hash, and the
  database keeps only a hash of the cookie. (`cfb9471`, `5d745fe`)
- **Never let one connection take down the room.** A socket handler must not
  throw: malformed input is dropped, and a bad socket is closed on its own.
  (`a3a3d90`)
- **Never end someone's race because their connection blipped.** A dropped
  connection gets the grace window; only a deliberate close ends it at once.
  (`d7c9c75`, `331d18c`)

## What every page must uphold

- **Both marking viewports, 1920x1080 and 390x844**, with no sideways scroll,
  in every state: lobby, countdown, racing, results.
- **Readable in every theme**: text at 4.5:1, accent and mistakes at 3:1
  (WCAG 2.2 SC 1.4.3). A new theme or colour use goes through axe in all of
  them, not just the default. (`96c3414`, `27c5850`)
- **Playable by keyboard alone**, from `/readme/` to the next race.
- **Motion is decoration, never information**, and all of it is off under
  `prefers-reduced-motion`. Text is never readable only part-way through an
  animation. (`c83464b`)
- **No rounded corners**, anywhere. One global rule enforces it; don't add a
  radius to a component. (`fde0756`)

## What a change must not break

- **Never point `pnpm check` or `pnpm shoot` at the live site.** Every spec
  race lands on the real leaderboard, and this has wiped it twice. Run them
  against a local server; check a deploy with read-only requests. (`061ac88`)
- **A bug fix comes with a spec that fails on the old code first.** If the
  fix doesn't turn that spec green, it isn't the fix: `331d18c` replaced a
  first attempt that its new spec showed was incomplete.
- **A check doesn't count until it has caught the bug it guards against.**
  Plant the bug, watch the check fail, then remove it. (`949dd7f`)
- **Budgets are tightened, never loosened to pass**: first load under 40 kB
  gzipped, a state message under 700 B mid-race (`scripts/shoot.ts`).
  (`12f489e`)
- **Specs race at a human pace.** Results at the speed cap crowd the real
  leaderboard and break the specs that look for theirs. (`5c8f51a`)
- **Every README claim is a test in `spec/claims.test.ts`**, named as the
  claim, or the README says how it was judged instead. A claim that can be
  neither doesn't belong in the README.

## How to work here

- Read the code a change touches before changing it, and match its comment
  density and naming.
- Run it for real before calling it done: `pnpm check` and `pnpm shoot`
  against a local server, and look at the screenshots in `.screens/`.
- One concern per commit, and the commit body says what was wrong, how it was
  found, and how you know the fix is right.
