import { readFileSync } from "node:fs";
import { marked } from "marked";
import { publicId, type Best, type HistoryRow, type Player } from "./db.ts";

export const esc = (s: string): string =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

function layout(title: string, body: string, extraHead = ""): string {
  return `<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="stylesheet" href="/static/style.css">
${extraHead}
</head>
<body>
<header class="top">
  <a class="brand" href="/">keyrace</a>
  <nav><a href="/readme/">about</a></nav>
</header>
${body}
</body>
</html>`;
}

function boardList(rows: Best[], me: string): string {
  if (rows.length === 0) return `<p class="empty">No finished races yet.</p>`;
  return `<ol class="board">${rows
    .map(
      (r) =>
        `<li${r.id === me ? ' class="me"' : ""}><span class="who">${esc(r.name)}</span><span class="num">${r.wpm.toFixed(0)} wpm</span></li>`,
    )
    .join("")}</ol>`;
}

function historyList(rows: HistoryRow[]): string {
  if (rows.length === 0) return `<p class="empty">Your races will show up here.</p>`;
  return `<ol class="history">${rows
    .map(
      (r) =>
        `<li><span class="who">${r.place ? `${ordinal(r.place)} of ${r.field}` : "DNF"}${r.mode === "quotes" ? "" : ` · ${esc(r.mode)}`}</span><span class="num">${r.wpm.toFixed(0)} wpm · ${Math.round(r.accuracy * 100)}%</span></li>`,
    )
    .join("")}</ol>`;
}

export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function roomPage(
  roomId: string,
  player: Player,
  board: { today: Best[]; allTime: Best[]; history: HistoryRow[] },
): string {
  const label = roomId === "main" ? "the main track" : `room ${roomId}`;
  return layout(
    `keyrace · ${roomId === "main" ? "race" : roomId}`,
    `<main class="race" data-room="${esc(roomId)}">
  <section class="track" aria-labelledby="track-h">
    <div class="status">
      <h1 id="track-h">Racing on ${esc(label)}</h1>
      <p id="phase" role="status" aria-live="polite">Connecting…</p>
    </div>
    <div class="modes" role="radiogroup" aria-label="Race mode">
      <button type="button" class="mode" role="radio" data-mode="quotes" aria-checked="true">Quotes</button>
      <button type="button" class="mode" role="radio" data-mode="words" aria-checked="false">Words</button>
      <button type="button" class="mode" role="radio" data-mode="code" aria-checked="false">Code</button>
      <button type="button" class="mode" role="radio" data-mode="sprint" aria-checked="false">Sprint (30s)</button>
      <span id="mode-note" class="mode-note"></span>
      <button type="button" id="tape-toggle" class="tape-toggle" aria-pressed="false">Tape mode</button>
    </div>
    <ul id="lanes" class="lanes" aria-label="Racers"></ul>
    <div id="banner" class="banner" aria-hidden="true"></div>
    <div id="passage" class="passage" aria-hidden="true"></div>
    <p id="source" class="source"></p>
    <label class="typing">
      <span class="visually-hidden">Type the passage here</span>
      <textarea id="input" rows="2" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" disabled></textarea>
    </label>
    <div class="actions">
      <button id="join" type="button" disabled>Join next race</button>
      <button id="ready" type="button" class="secondary" hidden>Ready</button>
      <span id="me-live" class="live"></span>
    </div>
    <section id="summary" class="summary" aria-labelledby="summary-h" hidden>
      <h2 id="summary-h">Last race</h2>
      <p id="summary-meta" class="source"></p>
      <figure class="chart">
        <figcaption>Average WPM over the race. Crosses mark mistakes.</figcaption>
        <div id="chart"></div>
        <ul id="legend" class="legend"></ul>
      </figure>
      <table class="results">
        <thead><tr><th scope="col">#</th><th scope="col">Racer</th><th scope="col">WPM</th><th scope="col">Accuracy</th><th scope="col">Mistakes</th></tr></thead>
        <tbody id="results"></tbody>
      </table>
      <div id="who-tabs" class="who-tabs" role="tablist" aria-label="Whose typing to show"></div>
      <div id="replay" class="passage replay" role="tabpanel"></div>
      <p id="replay-note" class="source"></p>
    </section>
  </section>

  <aside class="side">
    <section aria-labelledby="you-h">
      <h2 id="you-h">You</h2>
      <form id="name-form" class="name" action="/name" method="post">
        <label for="name">Racing as</label>
        <input id="name" name="name" maxlength="20" value="${esc(player.name)}" required>
        <button type="submit">Save</button>
      </form>
      <div id="history">${historyList(board.history)}</div>
    </section>
    <section aria-labelledby="today-h">
      <h2 id="today-h">Fastest today</h2>
      <div id="today">${boardList(board.today, publicId(player.id))}</div>
    </section>
    <section aria-labelledby="all-h">
      <h2 id="all-h">Fastest ever</h2>
      <div id="all-time">${boardList(board.allTime, publicId(player.id))}</div>
    </section>
    <section aria-labelledby="rooms-h">
      <h2 id="rooms-h">Race your friends</h2>
      <form class="room" action="/r" method="get">
        <label for="room-code">Room name</label>
        <input id="room-code" name="code" pattern="[a-z0-9-]{1,24}" placeholder="e.g. comp4020" required>
        <button type="submit">Go</button>
      </form>
    </section>
  </aside>
</main>
<script>window.ME = ${JSON.stringify({ id: publicId(player.id), name: player.name }).replace(/</g, "\\u003c")};</script>
<script type="module" src="/static/app.js"></script>`,
  );
}

export function readmePage(): string {
  const md = readFileSync("README.md", "utf8");
  return layout("keyrace · about", `<main class="readme">${marked.parse(md, { async: false })}</main>`);
}
