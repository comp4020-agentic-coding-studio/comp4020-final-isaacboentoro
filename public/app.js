// The race page. The server owns the race (phases, timing, placings); this
// file renders what it's told and reports how far along the passage you are.

const $ = (id) => document.getElementById(id);
const roomId = document.querySelector("main").dataset.room;
const me = window.ME;

const el = {
  phase: $("phase"),
  modes: [...document.querySelectorAll(".mode")],
  modeNote: $("mode-note"),
  lanes: $("lanes"),
  banner: $("banner"),
  passage: $("passage"),
  tapeToggle: $("tape-toggle"),
  source: $("source"),
  input: $("input"),
  join: $("join"),
  ready: $("ready"),
  live: $("me-live"),
  nameForm: $("name-form"),
  name: $("name"),
  history: $("history"),
  today: $("today"),
  allTime: $("all-time"),
  summary: $("summary"),
  summaryMeta: $("summary-meta"),
  chart: $("chart"),
  legend: $("legend"),
  results: $("results"),
  whoTabs: $("who-tabs"),
  replay: $("replay"),
  replayNote: $("replay-note"),
};

let ws;
let state = null; // latest room snapshot
let skew = 0; // server clock minus ours
// `committed` is every word you've finished (typed its boundary space or
// newline, or the passage ended); `typed` is that plus whatever's still in
// the box for the word in progress. The box itself only ever holds the one
// word — it's cleared the instant a word commits, so there's never a
// backlog of the whole passage sitting in it. Backspacing out of an empty
// box hands the last word back to it, while there's a mistake to fix.
let committed = "";
let typed = "";
let errors = 0;
let summary = null; // the last race, as the server summed it up
let replayOf = me.id; // whose typing the summary shows

// Tape mode: one line, scrolled under a fixed caret, letter by letter. A
// per-browser preference — it changes nothing about the race itself.
let tape = false;
try {
  tape = localStorage.getItem("keyrace-tape") === "1";
} catch {
  // storage blocked (private window, locked-down browser): default stands
}
el.tapeToggle.setAttribute("aria-pressed", String(tape));

function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws?room=${encodeURIComponent(roomId)}`);
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.t === "state") onState(msg.room);
    if (msg.t === "board") onBoard(msg);
    if (msg.t === "summary") onSummary(msg.race);
  };
  ws.onclose = () => {
    el.phase.textContent = "Lost the connection. Reconnecting…";
    el.input.disabled = true;
    el.join.disabled = true;
    setTimeout(connect, 1000);
  };
}

const send = (msg) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(msg));

function onState(room) {
  skew = room.now - Date.now();
  // Typing is locked before the start, so that's when the last race's
  // keystrokes get cleared; results keep them on screen.
  if (room.phase === "lobby" || room.phase === "countdown") {
    committed = "";
    typed = "";
    errors = 0;
    el.input.value = "";
  }
  state = room;
  paint();
}

// Big changes of state — joining, the start, the finish, results, a new
// mode — redraw inside a view transition, so the layout glides from one
// arrangement to the next (style.css names the pieces that move) instead of
// jumping. Everything in between, like keystrokes and the ten-a-second
// progress updates, redraws in place.
const motion = () => !matchMedia("(prefers-reduced-motion: reduce)").matches;
let lastScene = "";
let transitioning = false;

function scene() {
  const e = mine();
  const go = state.phase === "racing" && e && !e.finished && Date.now() + skew - state.startedAt < 1500;
  return [state.phase, state.mode, tape, !!e, !!e?.finished, go, !!summary].join("|");
}

function paint(update = render) {
  if (!state) return;
  const next = scene();
  const changed = lastScene !== "" && next !== lastScene;
  lastScene = next;
  // One already running shows the live page, so a change that lands
  // mid-transition just draws into it rather than cutting it short.
  if (changed && !transitioning && motion() && document.startViewTransition && !document.hidden) {
    transitioning = true;
    const t = document.startViewTransition(update);
    t.ready.catch(() => {}); // skipped (tab hidden, say): the update still ran
    t.finished.finally(() => (transitioning = false));
  } else update();
}

function mine() {
  return state?.entrants.find((e) => e.id === me.id);
}

const queued = () => !!state?.queued.includes(me.id);
const secondsLeft = () => Math.max(0, Math.ceil((state.endsAt - (Date.now() + skew)) / 1000));

// One colour per racer, the same in the lanes, the carets and the summary:
// yours is the accent, everyone else takes the next slot in join order.
const SLOTS = 7;
function colours(entrants) {
  const map = new Map();
  let k = 0;
  for (const e of entrants) map.set(e.id, e.id === me.id ? "var(--accent)" : `var(--p${(k++ % SLOTS) + 1})`);
  return map;
}

// Newlines are drawn as a return arrow so you can see you owe a keystroke.
// Tape mode is forced one line (`white-space: pre`), where a literal "\n"
// would still break it, so there the arrow stands in for the newline rather
// than alongside it.
function charSpan(ch, oneLine = false) {
  const span = document.createElement("span");
  span.textContent = ch === "\n" ? (oneLine ? "↵" : "↵\n") : ch;
  if (ch === "\n") span.className = "nl";
  return span;
}

// The passage's character spans are built once per passage (and per layout:
// tape mode draws newlines differently) and then only restyled. Rebuilding
// them on every broadcast reset the tape's scroll to zero and slid it back
// to the caret ten times a second, which made it unreadable.
let built = { key: "", spans: [] };
function passageSpans(text) {
  const key = `${tape}:${text}`;
  if (built.key === key) return built.spans;
  const spans = [...text].map((ch) => charSpan(ch, tape));
  if (tape) {
    const track = document.createElement("span");
    track.className = "tape-track";
    track.append(...spans);
    el.passage.replaceChildren(track);
  } else {
    el.passage.replaceChildren(...spans);
    el.passage.scrollTop = 0;
  }
  built = { key, spans };
  return spans;
}

// Keeps the character you're on in view. Tape mode pins it to the middle of
// the line, so the text moves and your eyes don't; otherwise the passage
// scrolls a line at a time once the caret nears the bottom of its box.
function placeCaret(spans, at) {
  const caret = spans[Math.max(0, at)];
  if (!caret) return;
  if (tape) {
    const centre = caret.offsetLeft + caret.offsetWidth / 2;
    const shift = Math.round(el.passage.clientWidth / 2 - centre);
    caret.parentElement.style.transform = `translateX(${shift}px)`;
    return;
  }
  const lh = caret.offsetHeight;
  const top = caret.offsetTop;
  const box = el.passage;
  if (top < box.scrollTop || top + 2 * lh > box.scrollTop + box.clientHeight) {
    box.scrollTop = Math.max(0, top - lh);
  }
}

// Narrowing the window moves every character, so the caret goes with it.
addEventListener("resize", () => {
  if (state) placeCaret(built.spans, Math.min(typed.length, state.quote.text.length - 1));
});

function render() {
  if (!state) return;
  const entrant = mine();
  const text = state.quote.text;
  const racing = state.phase === "racing";
  const colour = colours(state.entrants);

  // Everyone else's caret, where they've typed up to.
  const others = new Map();
  if (racing || state.phase === "results") {
    for (const e of state.entrants) {
      if (e.id === me.id || e.finished) continue;
      others.set(e.progress, [...(others.get(e.progress) ?? []), e]);
    }
  }

  // Focus layout: once you're on the line for a race, everything but the
  // passage, the lanes and the clock gets out of the way. Set before the
  // passage is laid out, since the caret's position depends on it.
  const focus = !!entrant && (state.phase === "countdown" || racing);
  document.body.classList.toggle("focus", focus);

  // passage: what you've typed, coloured against what you should have
  el.passage.classList.toggle("code", state.mode === "code");
  el.passage.classList.toggle("tape", tape);
  const spans = passageSpans(text);
  const myCaretAt = racing && entrant && !entrant.finished ? typed.length : -1;
  for (let i = 0; i < text.length; i++) {
    const span = spans[i];
    let cls = text[i] === "\n" ? "nl" : "";
    if (i < typed.length) cls += typed[i] === text[i] ? " ok" : " bad";
    if (i === myCaretAt) cls += " caret";
    // Tape mode shows only your own position; other racers' carets would
    // mostly sit off the one visible line, so they're left to the lanes.
    const here = tape ? undefined : others.get(i);
    if (here) {
      cls += " ghost";
      span.style.setProperty("--c", colour.get(here[0].id));
      span.dataset.name = here.map((e) => e.name).join(", ");
    } else if (span.dataset.name !== undefined) {
      span.style.removeProperty("--c");
      delete span.dataset.name;
    }
    // Only touch what changed: rewriting every class restarts the caret's
    // blink, and the whole passage re-renders ten times a second mid-race.
    if (span.className !== cls) span.className = cls;
  }
  placeCaret(spans, Math.min(typed.length, text.length - 1));
  el.source.textContent = `— ${state.quote.source}`;

  // modes
  const canJoin = state.phase === "lobby" || state.phase === "countdown";
  for (const b of el.modes) {
    b.setAttribute("aria-checked", String(b.dataset.mode === state.mode));
    b.disabled = !canJoin;
  }
  el.modeNote.textContent = canJoin ? "Switches the passage for everyone here." : "";
  el.input.rows = state.mode === "code" ? 5 : 2;

  // lanes
  renderLanes(
    state.entrants
      .slice()
      .sort((a, b) => (a.place ?? 99) - (b.place ?? 99) || b.progress - a.progress),
    colour,
    racing,
  );

  // controls
  const results = state.phase === "results";
  el.join.disabled = !(canJoin || results);
  el.join.hidden = racing;
  el.join.textContent =
    (entrant && canJoin) || (results && queued()) ? "Leave" : "Join next race";
  el.join.classList.toggle("secondary", !!entrant && canJoin);
  el.join.classList.toggle("beckon", state.phase === "lobby" && !entrant);
  el.ready.hidden = !(entrant && state.phase === "countdown");
  el.ready.textContent = entrant?.ready ? "Not ready" : "I'm ready";
  el.ready.setAttribute("aria-pressed", String(!!entrant?.ready));

  const typing = racing && entrant && !entrant.finished;
  // Typing is how you join: the box is live before a race (and while the
  // last one's results are up), and the first keystroke puts you on the line.
  const canType = canJoin || results || typing;
  if (el.input.disabled === canType) {
    el.input.disabled = !canType;
    // a disabled box drops focus; take it back unless you've moved elsewhere
    if (canType && (document.activeElement === document.body || typing)) el.input.focus();
  }
  el.input.placeholder = typing
    ? state.mode === "code"
      ? "Go! Enter for newlines; indents are typed for you."
      : "Go!"
    : entrant && canJoin
      ? entrant.ready
        ? "Ready. Waiting on the others…"
        : "Press Enter when you're ready"
      : canJoin || (results && !queued())
        ? "Start typing to join the next race"
        : results
          ? "You're in the next race"
          : entrant
            ? "Done! Waiting for the others…"
            : "Race under way. Join the next one when it ends.";

  el.live.textContent = entrant && (racing || results)
    ? `${Math.round(entrant.wpm)} wpm · ${accuracyPct()}%`
    : "";

  el.summary.hidden = !summary || racing;
  tick();
}

// Each racer keeps the same lane element from render to render, so their
// bar grows smoothly instead of being redrawn, and an overtake slides the
// two lanes past each other rather than swapping them in a frame.
const laneEls = new Map(); // racer id → their <li>
const emptyLane = document.createElement("li");
emptyLane.className = "empty";
emptyLane.textContent = "Nobody on the line yet.";

function renderLanes(lanes, colour, racing) {
  const text = state.quote.text;
  const before = new Map([...laneEls].map(([id, li]) => [id, li.getBoundingClientRect().top]));
  const items = lanes.map((e) => {
    let li = laneEls.get(e.id);
    if (!li) {
      li = document.createElement("li");
      li.innerHTML = `<span class="who"></span><span class="bar"><span></span></span><span class="num"></span>`;
      laneEls.set(e.id, li);
    }
    li.className = e.id === me.id ? "me" : "";
    li.style.setProperty("--c", colour.get(e.id));
    const pct = Math.round((e.progress / text.length) * 100);
    li.querySelector(".bar span").style.width = `${pct}%`;
    li.querySelector(".who").textContent = e.name + (e.id === me.id ? " (you)" : "");
    const num = e.finished
      ? `${ordinal(e.place)} · ${Math.round(e.wpm)} wpm`
      : racing || state.phase === "results"
        ? `${Math.round(e.wpm)} wpm`
        : e.ready
          ? "ready ✓"
          : "joined";
    li.querySelector(".num").textContent = num;
    li.setAttribute("aria-label", `${e.name}: ${pct}% ${num}`);
    return li;
  });
  for (const id of laneEls.keys()) if (!lanes.some((e) => e.id === id)) laneEls.delete(id);
  if (items.length === 0) items.push(emptyLane);

  // Move only the lanes that are out of place: taking a node out of the
  // page cancels its bar's transition.
  items.forEach((li, i) => {
    if (el.lanes.children[i] !== li) el.lanes.insertBefore(li, el.lanes.children[i] ?? null);
  });
  while (el.lanes.children.length > items.length) el.lanes.lastChild.remove();

  // A view transition is already moving the lanes as a whole.
  if (!motion() || transitioning) return;
  for (const [id, li] of laneEls) {
    const was = before.get(id);
    if (was === undefined) {
      li.animate([{ opacity: 0, transform: "translateY(-0.5rem)" }, {}], { duration: 250, easing: "ease-out" });
    } else {
      const dy = was - li.getBoundingClientRect().top;
      if (dy) li.animate([{ transform: `translateY(${dy}px)` }, {}], { duration: 300, easing: EASE });
    }
  }
}

function accuracyPct() {
  const good = correctPrefix();
  return good + errors === 0 ? 100 : Math.round((good / (good + errors)) * 100);
}

// The phase line and the banner both count down, so they redraw every second.
function tick() {
  if (!state) return;
  const left = secondsLeft();
  const watching = state.watching === 1 ? "just you here" : `${state.watching} here`;
  const n = state.entrants.length;
  el.phase.textContent = {
    lobby: `Waiting for someone to start a race · ${watching}`,
    countdown: `Starts in ${left}s · ${n} on the line · ${watching}`,
    racing: `Racing · ${left}s left · ${watching}`,
    results: `Finished · next race in ${left}s`,
  }[state.phase];
  renderBanner(left);
}
// The phase line only re-announces when its text changes, so ticking every
// second is fine for screen readers during the countdown.
// (The "Go!" banner times out between updates, so check for that too.)
setInterval(() => (state && scene() !== lastScene ? paint() : tick()), 1000);

// The big "what happens next" strip above the passage.
el.banner.innerHTML = `<span class="big"></span><span class="line"></span>`;
const bannerBig = el.banner.querySelector(".big");
const bannerLine = el.banner.querySelector(".line");
const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";

function renderBanner(left) {
  const entrant = mine();
  const ready = state.entrants.filter((e) => e.ready).length;
  let big = "";
  let line = "";
  let tone = "";
  if (state.phase === "lobby") {
    big = "▶";
    line = "<b>Start typing to start a race.</b> Anyone else here gets 10 seconds to jump in.";
  } else if (state.phase === "countdown") {
    big = String(left);
    tone = left <= 3 ? "hot" : "";
    line = entrant
      ? entrant.ready
        ? `<b>You're ready.</b> ${ready} of ${state.entrants.length} ready — it starts early once everyone is.`
        : `<b>You're in.</b> Press <kbd>Enter</kbd> when you're ready to go.`
      : "<b>A race is about to start.</b> Start typing to join it.";
  } else if (state.phase === "racing") {
    const elapsed = Date.now() + skew - state.startedAt;
    if (entrant && !entrant.finished && elapsed < 1500) {
      big = "Go!";
      tone = "hot";
      line = "<b>Type the passage below.</b>";
    } else if (!entrant) {
      big = "👀";
      line = "<b>You're watching this one.</b> You can join the next race when it ends.";
    } else if (entrant.finished) {
      big = ordinal(entrant.place);
      line = `<b>Finished!</b> Waiting for the others…`;
    }
  } else if (state.phase === "results") {
    big = String(left);
    line = queued()
      ? "<b>You're in the next race.</b> It counts down as soon as these results clear."
      : "<b>Race over.</b> Start typing to get in the next one.";
  }
  // Draws the eye while there's a one-keystroke action waiting: joining a
  // race, or readying up once you're on the line.
  const beckon =
    (state.phase === "lobby" && !entrant) ||
    (state.phase === "countdown" && entrant && !entrant.ready);
  el.banner.hidden = !big;
  el.banner.className = `banner ${tone} ${beckon ? "beckon" : ""}`;
  // Only touch what changed, and give each change a beat: the countdown
  // digit drops into place, a new message fades up.
  if (bannerBig.textContent !== big) {
    bannerBig.textContent = big;
    if (big && motion()) {
      bannerBig.animate([{ opacity: 0, transform: "scale(1.6)" }, {}], { duration: 280, easing: EASE });
    }
  }
  if (bannerLine.dataset.html !== line) {
    bannerLine.dataset.html = line;
    bannerLine.innerHTML = line;
    if (line && motion()) {
      bannerLine.animate([{ opacity: 0, transform: "translateY(0.25rem)" }, {}], { duration: 220, easing: "ease-out" });
    }
  }
}

// The end of the word sitting at `from` in the passage, one past its closing
// space or newline (or the end of the passage), so a mistake never locks you
// out mid-word but also never lets you run past the one you're stuck on.
function wordLimit(text, from) {
  let i = from;
  while (i < text.length && text[i] !== " " && text[i] !== "\n") i++;
  return Math.min(text.length, i + 1);
}

// Commits whichever whole words `full` (the passage typed so far, in
// absolute passage positions) now reaches the end of, as many times as it
// overruns in one go — an auto-filled indent can close out several
// one-character "words" at once. Returns the new committed text and
// whatever's left over for the box, which only ever holds the remainder.
function commitWords(text, committed, full) {
  for (;;) {
    const limit = wordLimit(text, committed.length);
    if (full.length < limit || limit === committed.length) return [committed, full.slice(committed.length)];
    committed = full.slice(0, limit);
  }
}

// The start of the passage word that position `at` falls in: one past the
// space or newline before it.
function wordStart(text, at) {
  let i = at;
  while (i > 0 && text[i - 1] !== " " && text[i - 1] !== "\n") i--;
  return i;
}

// Backspace on an empty box: reopens the last committed word, minus the
// character the keystroke deletes (usually its closing space), so a word
// you got wrong can still be fixed. Only while something committed is
// wrong — the words before your first mistake stay locked. From the start
// of a line in code, the indent you were given goes with the newline.
// `whole` (Ctrl/Alt+Backspace) clears the reopened word outright.
function reopenWord(whole) {
  const text = state.quote.text;
  if (prefixLen(committed, text) === committed.length) return false;
  let back = committed.replace(/\n +$/, "\n").slice(0, -1);
  const start = wordStart(text, back.length);
  if (whole) back = back.slice(0, start);
  committed = back.slice(0, start);
  typed = back;
  el.input.value = back.slice(start);
  return true;
}

// How much of `s` matches the passage from its start, character for
// character — the portion that counts as correctly typed.
function prefixLen(s, text) {
  let i = 0;
  while (i < s.length && s[i] === text[i]) i++;
  return i;
}

function correctPrefix() {
  return prefixLen(typed, state.quote.text);
}

function joinOrQueue() {
  if (state.phase === "results") {
    if (!queued()) send({ t: "join" });
  } else if (!mine()) send({ t: "join" });
}

el.input.addEventListener("keydown", (e) => {
  if (!state) return;
  if (e.key === "Enter" && state.phase !== "racing") {
    // Before the start, Enter joins, then says you're ready.
    e.preventDefault();
    if (state.phase === "countdown" && mine()) send({ t: "ready" });
    else joinOrQueue();
  } else if (e.key === "Enter" && state.mode !== "code") {
    e.preventDefault();
  } else if (e.key === "Tab" && state.phase === "racing" && mine() && !mine().finished) {
    // indentation is typed for you; Tab would only throw you out of the box
    e.preventDefault();
  } else if (
    e.key === "Backspace" &&
    state.phase === "racing" &&
    mine() &&
    !mine().finished &&
    el.input.value === "" &&
    reopenWord(e.ctrlKey || e.altKey)
  ) {
    e.preventDefault();
    send({ t: "progress", n: correctPrefix(), errors });
    render();
  }
});

el.input.addEventListener("input", () => {
  if (!state) return;
  if (state.phase !== "racing") {
    // Before the start, keystrokes join you and are otherwise swallowed.
    el.input.value = "";
    joinOrQueue();
    return;
  }
  const text = state.quote.text;
  const prevTyped = typed;
  let full = committed + el.input.value;
  // The box can only ever hold the word you're on, so cap it at that word's
  // end; typing past a mistake runs you out, but no further.
  const limit = wordLimit(text, committed.length);
  if (full.length > limit) full = full.slice(0, limit);

  let miss;
  if (full.length > prevTyped.length && full[full.length - 1] !== text[full.length - 1]) {
    errors++;
    miss = { i: full.length - 1, got: full[full.length - 1] };
  }
  // After a correct newline the next line's indent comes for free — each
  // space it adds closes out its own one-character "word" below.
  const good = prefixLen(full, text);
  if (full.length > prevTyped.length && good === full.length && full.endsWith("\n")) {
    while (text[full.length] === " ") full += " ";
  }

  [committed, full] = commitWords(text, committed, full);
  typed = committed + full;
  if (el.input.value !== full) el.input.value = full;
  send({ t: "progress", n: correctPrefix(), errors, miss });
  render();
});

// Paste would make the anti-cheat clamp the only defence; just refuse it.
el.input.addEventListener("paste", (e) => e.preventDefault());
el.input.addEventListener("drop", (e) => e.preventDefault());

el.passage.addEventListener("click", () => el.input.disabled || el.input.focus());

el.join.addEventListener("click", () => {
  if (state.phase === "results") send({ t: queued() ? "leave" : "join" });
  else send({ t: mine() ? "leave" : "join" });
  el.input.focus();
});

el.ready.addEventListener("click", () => {
  send({ t: "ready" });
  el.input.focus();
});

for (const b of el.modes) b.addEventListener("click", () => send({ t: "mode", mode: b.dataset.mode }));

el.tapeToggle.addEventListener("click", () => {
  tape = !tape;
  el.tapeToggle.setAttribute("aria-pressed", String(tape));
  try {
    localStorage.setItem("keyrace-tape", tape ? "1" : "0");
  } catch {
    // no durable storage here: the toggle still works for this page view
  }
  paint();
});

el.nameForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const name = el.name.value.trim();
  if (!name) return;
  me.name = name;
  send({ t: "name", name });
  el.name.blur();
});

function onBoard({ today, allTime, history }) {
  el.today.replaceChildren(boardList(today));
  el.allTime.replaceChildren(boardList(allTime));
  el.history.replaceChildren(historyList(history));
}

// --- the post-race summary ---------------------------------------------------

function onSummary(race) {
  summary = race;
  if (!race.entrants.some((e) => e.id === replayOf)) replayOf = race.entrants[0]?.id;
  // render unhides the summary, so the chart can measure its width
  paint(() => {
    render();
    renderSummary();
  });
}

const byPlace = (a, b) => (a.place ?? 99) - (b.place ?? 99) || b.progress - a.progress;
const pct = (x) => `${Math.round(x * 100)}%`;
const visible = (ch) => (ch === " " ? "␣" : ch === "\n" ? "↵" : ch);

function renderSummary() {
  const race = summary;
  const colour = colours(race.entrants);
  el.summaryMeta.textContent = `${race.mode} · ${race.source} · ${race.seconds}s`;

  // results table
  el.results.replaceChildren(
    ...race.entrants
      .slice()
      .sort(byPlace)
      .map((e) => {
        const tr = document.createElement("tr");
        if (e.id === me.id) tr.className = "me";
        const cells = [
          e.place ? ordinal(e.place) : "DNF",
          e.name + (e.id === me.id ? " (you)" : ""),
          Math.round(e.wpm),
          pct(e.accuracy),
          e.misses.length,
        ];
        for (const [k, v] of cells.entries()) {
          const td = document.createElement(k === 1 ? "th" : "td");
          if (k === 1) {
            td.scope = "row";
            const sw = document.createElement("span");
            sw.className = "swatch";
            sw.style.background = colour.get(e.id);
            td.append(sw);
          }
          td.append(String(v));
          tr.append(td);
        }
        return tr;
      }),
  );

  // whose typing to look at
  el.whoTabs.replaceChildren(
    ...race.entrants.map((e) => {
      const b = document.createElement("button");
      b.type = "button";
      b.role = "tab";
      b.className = "who-tab";
      b.style.setProperty("--c", colour.get(e.id));
      b.setAttribute("aria-selected", String(e.id === replayOf));
      b.textContent = e.id === me.id ? "You" : e.name;
      b.addEventListener("click", () => {
        replayOf = e.id;
        renderSummary();
      });
      return b;
    }),
  );
  renderReplay(race.entrants.find((e) => e.id === replayOf));
  renderChart(race, colour);
}

// The passage as one racer typed it: every character they got wrong on the
// way is red, with what they hit instead written underneath.
function renderReplay(e) {
  if (!e) return el.replay.replaceChildren();
  const text = summary.text;
  const missed = new Map();
  for (const m of e.misses) missed.set(m.i, [...(missed.get(m.i) ?? []), m.got]);
  el.replay.classList.toggle("code", summary.mode === "code");
  const frag = document.createDocumentFragment();
  for (let i = 0; i < text.length; i++) {
    const span = charSpan(text[i]);
    span.classList.add(i < e.progress ? "ok" : "untyped");
    const got = missed.get(i);
    if (got) {
      span.classList.add("missed");
      const sub = document.createElement("span");
      sub.className = "got";
      sub.textContent = [...new Set(got)].slice(0, 3).map(visible).join("");
      span.title = `typed ${got.map(visible).join(", ")}`;
      span.append(sub);
    }
    frag.append(span);
  }
  el.replay.replaceChildren(frag);

  const counts = new Map();
  for (const m of e.misses) {
    const want = visible(text[m.i]);
    counts.set(want, (counts.get(want) ?? 0) + 1);
  }
  const worst = [...counts].sort((a, b) => b[1] - a[1])[0];
  const who = e.id === me.id ? "You" : e.name;
  el.replayNote.textContent = [
    e.misses.length === 0
      ? `${who} made no mistakes.`
      : `${who} made ${e.misses.length} mistake${e.misses.length === 1 ? "" : "s"}${worst && worst[1] > 1 ? `, most often on “${worst[0]}”` : ""}.`,
    e.place ? "" : `Didn't finish: got ${pct(e.progress / text.length)} of the way.`,
  ]
    .filter(Boolean)
    .join(" ");
}

const SVG = "http://www.w3.org/2000/svg";
function svg(tag, attrs = {}) {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
}

// Each racer's average WPM, second by second, on one shared axis.
// Drawn at the width it's shown, so its text stays readable on a phone.
function renderChart(race, colour) {
  const W = Math.max(300, el.chart.clientWidth || 640);
  const H = 240;
  const m = { l: 36, r: W < 500 ? 70 : 110, t: 12, b: 28 };
  const lines = race.entrants.filter((e) => e.series.length > 0);
  const maxT = Math.max(1, ...lines.map((e) => e.series.at(-1)[0]));
  const top = Math.max(20, ...lines.flatMap((e) => e.series.map((p) => p[1])));
  const step = top > 150 ? 50 : top > 60 ? 20 : 10;
  const maxY = Math.ceil(top / step) * step;
  const x = (t) => m.l + (t / maxT) * (W - m.l - m.r);
  const y = (v) => H - m.b - (v / maxY) * (H - m.t - m.b);

  const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img" });
  root.setAttribute(
    "aria-label",
    `WPM over time: ${lines.map((e) => `${e.name} ended at ${Math.round(e.series.at(-1)[1])}`).join(", ")}`,
  );
  for (let v = 0; v <= maxY; v += step) {
    root.append(svg("line", { class: "grid", x1: m.l, x2: W - m.r, y1: y(v), y2: y(v) }));
    const t = svg("text", { class: "tick", x: m.l - 6, y: y(v) + 4, "text-anchor": "end" });
    t.textContent = v;
    root.append(t);
  }
  const tStep = maxT > 60 ? 15 : maxT > 20 ? 5 : maxT > 8 ? 2 : 1;
  for (let s = 0; s <= maxT; s += tStep) {
    const t = svg("text", { class: "tick", x: x(s), y: H - m.b + 16, "text-anchor": "middle" });
    t.textContent = `${s}s`;
    root.append(t);
  }

  // value at time t on a racer's line, for mistake markers and the crosshair
  const at = (series, t) => {
    let prev = [0, series[0][1]];
    for (const p of series) {
      if (p[0] >= t) {
        const f = p[0] === prev[0] ? 1 : (t - prev[0]) / (p[0] - prev[0]);
        return prev[1] + f * (p[1] - prev[1]);
      }
      prev = p;
    }
    return prev[1];
  };

  const labels = [];
  for (const e of lines) {
    const c = colour.get(e.id);
    const d = e.series.map((p, k) => `${k ? "L" : "M"}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join("");
    root.append(svg("path", { class: "series", d, style: `stroke:${c}` }));
    for (const mi of e.misses) {
      const t = mi.t / 1000;
      if (t < e.series[0][0]) continue;
      const cx = x(t);
      const cy = y(at(e.series, t));
      root.append(
        svg("path", { class: "miss", d: `M${cx - 4},${cy - 4}L${cx + 4},${cy + 4}M${cx - 4},${cy + 4}L${cx + 4},${cy - 4}`, style: `stroke:${c}` }),
      );
    }
    const end = e.series.at(-1);
    labels.push({ e, c, x: x(end[0]), y: y(end[1]) });
  }
  // direct labels at each line's end, nudged apart so they don't collide
  if (lines.length <= 4) {
    labels.sort((a, b) => a.y - b.y);
    for (let k = 1; k < labels.length; k++) labels[k].y = Math.max(labels[k].y, labels[k - 1].y + 14);
    for (const l of labels) {
      root.append(svg("circle", { cx: l.x, cy: y(l.e.series.at(-1)[1]), r: 4, class: "end", style: `fill:${l.c}` }));
      const t = svg("text", { class: "label", x: l.x + 8, y: l.y + 4 });
      const name = l.e.id === me.id ? "you" : l.e.name;
      const room = W < 500 ? 6 : 10;
      t.textContent = `${name.length > room ? name.slice(0, room - 1) + "…" : name} ${Math.round(l.e.series.at(-1)[1])}`;
      root.append(t);
    }
  }

  // hover: a crosshair and everyone's WPM at that moment
  const cross = svg("line", { class: "cross", y1: m.t, y2: H - m.b, visibility: "hidden" });
  root.append(cross);
  const hit = svg("rect", { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b, fill: "transparent" });
  root.append(hit);
  const tip = document.createElement("div");
  tip.className = "tip";
  tip.hidden = true;
  hit.addEventListener("pointermove", (ev) => {
    const box = root.getBoundingClientRect();
    const px = ((ev.clientX - box.left) / box.width) * W;
    const t = Math.max(0, Math.min(maxT, ((px - m.l) / (W - m.l - m.r)) * maxT));
    cross.setAttribute("x1", x(t));
    cross.setAttribute("x2", x(t));
    cross.setAttribute("visibility", "visible");
    tip.replaceChildren(`${t.toFixed(1)}s`);
    for (const e of lines) {
      if (t > e.series.at(-1)[0] + 0.5) continue;
      const row = document.createElement("div");
      const sw = document.createElement("span");
      sw.className = "swatch";
      sw.style.background = colour.get(e.id);
      row.append(sw, `${e.id === me.id ? "you" : e.name}: ${Math.round(at(e.series, t))} wpm`);
      tip.append(row);
    }
    tip.hidden = false;
    const left = (x(t) / W) * box.width;
    tip.style.left = `${Math.min(left + 12, box.width - tip.offsetWidth)}px`;
  });
  hit.addEventListener("pointerleave", () => {
    cross.setAttribute("visibility", "hidden");
    tip.hidden = true;
  });
  el.chart.replaceChildren(root, tip);

  el.legend.replaceChildren(
    ...race.entrants.map((e) => {
      const li = document.createElement("li");
      const sw = document.createElement("span");
      sw.className = "swatch";
      sw.style.background = colour.get(e.id);
      li.append(sw, e.id === me.id ? "you" : e.name);
      return li;
    }),
  );
}

// --- sidebar -------------------------------------------------------------------

function boardList(rows) {
  if (rows.length === 0) return para("No finished races yet.");
  const ol = document.createElement("ol");
  ol.className = "board";
  for (const r of rows) ol.append(row(r.name, `${Math.round(r.wpm)} wpm`, r.id === me.id));
  return ol;
}

function historyList(rows) {
  if (rows.length === 0) return para("Your races will show up here.");
  const ol = document.createElement("ol");
  ol.className = "history";
  for (const r of rows)
    ol.append(
      row(
        (r.place ? `${ordinal(r.place)} of ${r.field}` : "DNF") +
          (r.mode === "quotes" ? "" : ` · ${r.mode}`),
        `${Math.round(r.wpm)} wpm · ${Math.round(r.accuracy * 100)}%`,
      ),
    );
  return ol;
}

function row(who, num, isMe = false) {
  const li = document.createElement("li");
  if (isMe) li.className = "me";
  const a = document.createElement("span");
  a.className = "who";
  a.textContent = who;
  const b = document.createElement("span");
  b.className = "num";
  b.textContent = num;
  li.append(a, b);
  return li;
}

function para(text) {
  const p = document.createElement("p");
  p.className = "empty";
  p.textContent = text;
  return p;
}

function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

connect();
