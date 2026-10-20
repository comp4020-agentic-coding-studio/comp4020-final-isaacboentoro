# keyrace

A typing race, played live against whoever else is in the room. Pick a mode
(quotes, random words, code snippets, or a 30-second sprint), join the line,
and type the passage against everyone else — the server owns the clock, the
placings, and the leaderboard.

## What "good" means here

- **It feels like racing, not solo typing with a scoreboard bolted on.** You
  should be able to see the other people in the room while it's happening —
  not just learn who won after the fact.
- **Nobody waits on a slow machine or a quiet room.** A race starts as soon
  as the people in it are actually ready, and the server, not the client,
  decides who finished and when.
- **Joining is a keystroke, not a form.** Typing into the box is how you get
  on the line; there's no separate "ready" screen standing between you and
  the race.
- **It runs on one small, cheap machine.** One Node process, one SQLite file,
  no framework — small enough to live on a 256 MB Fly machine that scales to
  zero between races.

How each multi-user decision was weighed against this is in
[`docs/adr-0001-concurrency.md`](docs/adr-0001-concurrency.md).

## Modes

- **Quotes** — a line from a public-domain book.
- **Words** — 30 random lowercase words, no punctuation.
- **Code** — a short snippet in JS, TS, Python, Rust, SQL, C or Haskell;
  indentation is typed for you after each newline.
- **Sprint** — an open-ended stream of random words against a 30-second
  clock; nobody finishes it, so the race is won on WPM (accuracy breaking a
  tie) at the buzzer.

## Themes

The picker in the header switches the whole page between keyrace's own light
and dark, Gruvbox, Adwaita, Catppuccin, Nord, Dracula, Solarized, Tokyo Night
and Rosé Pine — or, left alone, follows the system's light or dark. Each uses
its palette's published colours, nudged only where a pairing fell short of
readable contrast. The choice is remembered per browser.

## Running it

```sh
pnpm install
pnpm dev        # http://localhost:8080, data in ./data
```

`pnpm check` runs the type checker and the spec, against a running copy of
the app (`APP_URL`, default `http://localhost:8080`).

`pnpm shoot` drives real Chromium through a two-racer race at 1920x1080 and
390x844 against the same running app (or a URL you pass it, like the
deployed site). It fails on console errors, any serious axe violation in any
of the themes, sideways scrolling, a race you can't play from the keyboard,
a countdown that jumps, lane stats that wrap, and a first load or mid-race
state message over budget. Screenshots of every state land in `.screens/`.
