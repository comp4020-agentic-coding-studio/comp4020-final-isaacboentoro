
# Process overview

Keyrace is a multiplayer typing game where players go head to head in typing quotes,
maintaining high words per minute and accuracy. I defined 'good' as everything 
being functional, having multiplayer netcode be robust and performant,
and the UI experience being cohesive and similar to other typing test websites
like Monkeytype.

## Stack and workflow — why this, over the alternatives

- **One Node process, no framework, SQLite via `node:sqlite`.** 
  I am not expecting the website to get more than 100k hits per day (as per the 
  SQLite documentation), so I figured just using SQLite and skipping all the 
  headache that comes with Postgres and/or ORMs would be more than enough 
  for this project. 

- **WebSockets over SSE/polling.** 
  The server must directly own the game state and shouldn't run client side 
  as with every multiplayer game. Client-claimed progress could potentially
  result in cheating, and the `progress()` function also clamps speed
  within reasonable human limits. Figma also has a interesting [writeup](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/) on WebSockets 
  with server authority. While this specific usecase might not *need* 
  WebSockets, I use them for the sake of rigorousness.


- **Directing the agent with examples, not instructions** 
  [`2d8d790`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-isaacboentoro/commit/2d8d790)
  is the word-boundary-box commit itself.
  [`061ac88`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-isaacboentoro/commit/061ac88)
  is the sprint mode + same input fix, same week.

  I tasked the agent to implement multiple color themse, which I supplied the Github 
  links for, instead of telling them to scrape the color themes themselves. I also 
  used the subagent feature to stress-test the multiplayer and concurrency netcode
  by tasking subagents to play against each other for an hour. When one agent sees
  an error, it reports it back to the main agent to fix the code, thus avoiding concurrent editing problems.

## How I knew a result was right, not just that it ran


- **The grace-window bug: first fix was wrong, and a new spec caught it.**
  [`d7c9c75`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-isaacboentoro/commit/d7c9c75)

  Added a 5 second reconnect grace period so a dropped racer's race wasn't instantly forfeited.
  If another racer finished while the first was mid drop, race still ended early. I had to edit
  the spec:

  [`331d18c`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-isaacboentoro/commit/331d18c)

  Replace the check with one called `settle()`

- **The identity leak: hashing wasn't enough, so the scheme was replaced.**
  [`cfb9471`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-isaacboentoro/commit/cfb9471)

  Found that player cookie ids were published in every entry. Anyone could copy that id
  and effectively become that player. However, hashing doesn't unleak the cookies, so

  [`5d745fe`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-isaacboentoro/commit/5d745fe)

  Replace cookies with server minted secrets, rotating every session.
  
- **`pnpm shoot` only counts once it's caught its own bug.**
  [`949dd7f`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-isaacboentoro/commit/949dd7f)

  Here I explicitly tell the agent that a check isnt trusted until I specifically plant
  the bug meant to be catched and fixed. Here are 2 commits that get caught by this:

  [`27c5850`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-isaacboentoro/commit/27c5850)

  [`c83464b`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-isaacboentoro/commit/c83464b)

  Here is pnpm shoot in action; the agent can now spin up a Chromium window and then autonomously *visually*
  check the layout of the website. This helps catch edge cases that wouldn't show up in pure HTML/CSS code that the agent usually sees.

## Netcode, themes, and the UI rebuild — pick what serves the argument

- Netcode trim:
  [`12f489e`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-isaacboentoro/commit/12f489e)
  measured 1802→452 B per message (the passage was being resent every
  tick) and turned that measurement into a budget `pnpm shoot` now enforces
  and can only tighten.
- Themes went from 14 hand-picked
  ([`96c3414`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-isaacboentoro/commit/96c3414))
  ([`387e495`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-isaacboentoro/commit/387e495),
  [`f79ade3`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-isaacboentoro/commit/f79ade3)),
  each nudged to hold WCAG contrast and kept apart via a separate rule I
  added after noticing some themes made typed and untyped text visually
  identical

- The UI rebuild, after Monkeytype's minimal look
  ([`7631981`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-isaacboentoro/commit/7631981),
  [`3b8e0a4`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-isaacboentoro/commit/3b8e0a4),
  [`b132602`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-isaacboentoro/commit/b132602)).
  The passage is the thing being raced, so the chrome around it went: one
  monospace face, a plain text toolbar, and your own numbers leading the
  results. Since Monkeytype is GPL-3.0, the layout was re-created from the
  idea and only palette data was vendored, with no code, CSS or markup. I
  skipped a web font because a swap mid-countdown would move every letter out
  from under the caret. Each commit was checked with screenshots at both
  marking viewports and `pnpm shoot` before I accepted it.


## Commit trail

Other commits the account above rests on.

- [`bb49141`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-isaacboentoro/commit/bb49141)
  Phases and the clock run on the server from the first version, with
  progress clamped to 25 chars/s.
- [`8b8c01e`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-isaacboentoro/commit/8b8c01e)
  A bug only the deployed spec caught: behind Fly's proxy the close event
  trailed by over five seconds, so a racer who had left kept a finished race
  running.
- [`03cec85`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-isaacboentoro/commit/03cec85)
  Tape mode rebuilt the passage on every broadcast. Fixed, then measured in
  headless Chromium: the caret stays within a pixel of centre.
- [`d205088`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-isaacboentoro/commit/d205088)
  Arcade scores come from progress the server already accepted, and the spec
  checks that a forged score does nothing.
- [`a3a3d90`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-isaacboentoro/commit/a3a3d90)
  A fuzzing pass found that a bare JSON `null` or an oversized frame killed
  the whole process, every room included.
- [`78c1e74`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-isaacboentoro/commit/78c1e74)
  Room.add broadcast before counting the newcomer, so nobody saw arrivals.
  Found by a spec that failed on the old code.
- [`ea4da8e`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-isaacboentoro/commit/ea4da8e)
  Two browser profiles, one per marking viewport, through a cut connection on
  a TCP proxy: 71 of 71 offline keystrokes now count.
- [`11179b8`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-isaacboentoro/commit/11179b8)
  `/readme/` only reached the race through the logo, and its ADR link 404'd.
- [`5c8f51a`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-isaacboentoro/commit/5c8f51a)
  `spec/claims.test.ts` gives each enforceable README sentence a test named
  as the claim.
- [`1694009`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-isaacboentoro/commit/1694009)
  That check caught three quotes that weren't from public-domain books, so
  they were cut rather than the claim reworded.
- [`a497381`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-isaacboentoro/commit/a497381)
  CLAUDE.md written, with each rule citing the bug or decision behind it.
- [`b02ff26`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-isaacboentoro/commit/b02ff26)
  Contrast checks widened to all 189 themes at both viewports.
- [`d13ff5b`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-isaacboentoro/commit/d13ff5b)
  Found by eye in a screenshot: 36 themes had typed and untyped text under
  1.1:1 apart, and no check compared colours with each other. Adds that check.
- [`db25d5f`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-isaacboentoro/commit/db25d5f)
  Typed letters also get an underline, so the difference never rests on
  colour alone (WCAG 2.2 SC 1.4.1).
