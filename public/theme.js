// The header's theme picker, on every page. The choice is a per-browser
// preference: applied before first paint by the inline script in <head>,
// remembered here, and empty means "follow the system's light or dark".

const pick = document.getElementById("theme");
const root = document.documentElement;
pick.value = root.dataset.theme ?? "";
// a stored theme that's since been removed falls back to the system's
if (pick.value !== (root.dataset.theme ?? "")) delete root.dataset.theme;

pick.addEventListener("change", () => {
  const apply = () => {
    if (pick.value) root.dataset.theme = pick.value;
    else delete root.dataset.theme;
  };
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (document.startViewTransition && !still) document.startViewTransition(apply);
  else apply();
  try {
    if (pick.value) localStorage.setItem("keyrace-theme", pick.value);
    else localStorage.removeItem("keyrace-theme");
  } catch {
    // no durable storage: the theme holds for this page view
  }
});
