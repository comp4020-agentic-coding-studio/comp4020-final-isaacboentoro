// The header's theme picker, on every page. The choice is a per-browser
// preference: applied before first paint by the inline script in <head>,
// remembered here, and empty means "follow the system's light or dark".
//
// There are close to two hundred themes, so their colours aren't in
// style.css for every visit to download: they're in themes.json (generated
// by scripts/themes.ts), fetched only once someone picks one. The chosen
// theme's own colours are kept in localStorage beside its id, which is what
// lets the inline script lay them on before the first paint.

const KEY = "keyrace-theme";
const pick = document.getElementById("theme");
const root = document.documentElement;

let all; // every theme, by id, once fetched
const themes = async () => {
  if (!all) {
    const res = await fetch("/static/themes.json");
    if (!res.ok) throw new Error(`themes.json answered ${res.status}`);
    all = new Map((await res.json()).map((t) => [t.id, t]));
  }
  return all;
};

// Lays a theme's colours over style.css's own as custom properties on
// <html>, or takes them off again for the system's (theme null).
function wear(theme) {
  for (const k of [...root.style]) if (k.startsWith("--")) root.style.removeProperty(k);
  root.style.removeProperty("color-scheme");
  if (!theme) {
    if (!root.style.length) root.removeAttribute("style");
    return void delete root.dataset.theme;
  }
  root.dataset.theme = theme.id;
  for (const [k, v] of Object.entries(theme.tokens)) root.style.setProperty(`--${k}`, v);
  root.style.colorScheme = theme.scheme;
}

function remember(theme) {
  try {
    if (theme) localStorage.setItem(KEY, JSON.stringify({ id: theme.id, scheme: theme.scheme, tokens: theme.tokens }));
    else localStorage.removeItem(KEY);
  } catch {
    // no durable storage: the theme holds for this page view
  }
}

pick.value = root.dataset.theme ?? "";
let picks = 0; // bumped on every pick, so a slow fetch can't undo a newer one

// What was stored may be stale: the palettes are regenerated, a theme is
// dropped, or an older keyrace kept only the id. Check it against the
// current list and wear that, or fall back to the system's.
let stored = null;
try {
  stored = localStorage.getItem(KEY);
} catch {
  // no storage to read: the system's theme it is
}
if (stored) {
  let id;
  try {
    id = JSON.parse(stored).id;
  } catch {
    id = stored; // an older keyrace stored the bare id
  }
  const at = picks;
  themes()
    .then((list) => {
      if (picks !== at) return; // picked since
      const now = list.get(id) ?? null;
      wear(now);
      remember(now);
      pick.value = now?.id ?? "";
    })
    .catch(() => {
      // offline: keep wearing what was stored
    });
}

pick.addEventListener("change", async () => {
  const id = pick.value;
  const at = ++picks;
  let theme = null;
  if (id) {
    try {
      theme = (await themes()).get(id) ?? null;
    } catch {
      pick.value = root.dataset.theme ?? "";
      return;
    }
  }
  if (picks !== at) return; // picked again while this one loaded
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (document.startViewTransition && !still) document.startViewTransition(() => wear(theme));
  else wear(theme);
  remember(theme);
});
