// The race page. The server owns the race (phases, timing, placings); this
// file renders what it's told and reports how far along the passage you are.

const $ = (id) => document.getElementById(id);
const roomId = document.querySelector("main").dataset.room;
const me = window.ME;

const el = {
  phase: $("phase"),
  lanes: $("lanes"),
  passage: $("passage"),
  source: $("source"),
  input: $("input"),
  join: $("join"),
  live: $("me-live"),
  nameForm: $("name-form"),
  name: $("name"),
  history: $("history"),
  today: $("today"),
  allTime: $("all-time"),
};

let ws;
let state = null; // latest room snapshot
let skew = 0; // server clock minus ours
let typed = "";
let errors = 0;

function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws?room=${encodeURIComponent(roomId)}`);
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.t === "state") onState(msg.room);
    if (msg.t === "board") onBoard(msg);
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
    typed = "";
    errors = 0;
    el.input.value = "";
  }
  state = room;
  render();
}

function mine() {
  return state?.entrants.find((e) => e.id === me.id);
}

function render() {
  if (!state) return;
  const entrant = mine();
  const text = state.quote.text;

  // passage: what you've typed, coloured against what you should have
  const frag = document.createDocumentFragment();
  for (let i = 0; i < text.length; i++) {
    const span = document.createElement("span");
    span.textContent = text[i];
    if (i < typed.length) span.className = typed[i] === text[i] ? "ok" : "bad";
    if (i === typed.length && state.phase === "racing" && entrant && !entrant.finished)
      span.classList.add("caret");
    frag.append(span);
  }
  el.passage.replaceChildren(frag);
  el.source.textContent = `— ${state.quote.source}`;

  // lanes
  const lanes = state.entrants
    .slice()
    .sort((a, b) => (a.place ?? 99) - (b.place ?? 99) || b.progress - a.progress);
  el.lanes.replaceChildren(
    ...lanes.map((e) => {
      const li = document.createElement("li");
      if (e.id === me.id) li.className = "me";
      const pct = Math.round((e.progress / text.length) * 100);
      li.innerHTML = `<span class="who"></span><span class="bar"><span style="width:${pct}%"></span></span><span class="num"></span>`;
      li.querySelector(".who").textContent = e.name + (e.id === me.id ? " (you)" : "");
      li.querySelector(".num").textContent = e.finished
        ? `${ordinal(e.place)} · ${Math.round(e.wpm)} wpm`
        : state.phase === "racing" || state.phase === "results"
          ? `${Math.round(e.wpm)} wpm`
          : "ready";
      li.setAttribute("aria-label", `${e.name}: ${pct}% ${li.querySelector(".num").textContent}`);
      return li;
    }),
  );
  if (lanes.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "Nobody on the line yet.";
    el.lanes.replaceChildren(li);
  }

  // controls
  const canJoin = state.phase === "lobby" || state.phase === "countdown";
  el.join.disabled = !canJoin;
  el.join.textContent = entrant && canJoin ? "Leave" : "Join next race";
  el.join.hidden = state.phase === "racing" && !!entrant;
  const racing = state.phase === "racing" && entrant && !entrant.finished;
  // Typing is how you join: the box is live before a race, and the first
  // keystroke puts you on the line.
  const canType = canJoin || racing;
  if (el.input.disabled === canType) {
    el.input.disabled = !canType;
    // a disabled box drops focus; take it back unless you've moved elsewhere
    if (canType && (document.activeElement === document.body || racing)) el.input.focus();
  }
  el.input.placeholder = racing
    ? "Go!"
    : entrant && canJoin
      ? "Get ready…"
      : canJoin
        ? "Start typing to join the next race"
        : state.phase === "racing"
          ? entrant
            ? "Done! Waiting for the others…"
            : "Race under way. Join the next one when it ends."
          : "Next race soon…";

  el.live.textContent = entrant && (state.phase === "racing" || state.phase === "results")
    ? `${Math.round(entrant.wpm)} wpm · ${accuracyPct()}%`
    : "";
  tick();
}

function accuracyPct() {
  const good = correctPrefix();
  return good + errors === 0 ? 100 : Math.round((good / (good + errors)) * 100);
}

function tick() {
  if (!state) return;
  const left = Math.max(0, Math.ceil((state.endsAt - (Date.now() + skew)) / 1000));
  const watching = state.watching === 1 ? "just you here" : `${state.watching} here`;
  const n = state.entrants.length;
  el.phase.textContent = {
    lobby: `Waiting for someone to start a race · ${watching}`,
    countdown: `Starts in ${left}s · ${n} on the line · ${watching}`,
    racing: `Racing · ${left}s left · ${watching}`,
    results: `Finished · next race in ${left}s`,
  }[state.phase];
}
// The phase line only re-announces when its text changes, so ticking every
// second is fine for screen readers during the countdown.
setInterval(tick, 1000);

function correctPrefix() {
  const text = state.quote.text;
  let i = 0;
  while (i < typed.length && typed[i] === text[i]) i++;
  return i;
}

el.input.addEventListener("input", () => {
  if (!state) return;
  if (state.phase === "lobby" || state.phase === "countdown") {
    // Before the start, keystrokes join you and are otherwise swallowed.
    el.input.value = "";
    if (!mine()) send({ t: "join" });
    return;
  }
  if (state.phase !== "racing") return;
  const text = state.quote.text;
  let next = el.input.value;
  // You can run at most a word past your first mistake; fix it to go on.
  const good = (() => {
    let i = 0;
    while (i < next.length && next[i] === text[i]) i++;
    return i;
  })();
  if (next.length > good + 8) next = next.slice(0, good + 8);
  if (next.length > typed.length && next[next.length - 1] !== text[next.length - 1]) errors++;
  typed = next;
  if (el.input.value !== typed) el.input.value = typed;
  send({ t: "progress", n: correctPrefix(), errors });
  render();
});

// Paste would make the anti-cheat clamp the only defence; just refuse it.
el.input.addEventListener("paste", (e) => e.preventDefault());
el.input.addEventListener("drop", (e) => e.preventDefault());

el.passage.addEventListener("click", () => el.input.disabled || el.input.focus());

el.join.addEventListener("click", () => {
  send({ t: mine() ? "leave" : "join" });
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
        r.place ? `${ordinal(r.place)} of ${r.field}` : "DNF",
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
