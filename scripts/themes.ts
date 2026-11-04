#!/usr/bin/env node
/**
 * Builds the theme picker's themes from Monkeytype's palettes.
 *
 *   node scripts/themes.ts           # scripts/monkeytype-themes.json → public/themes.json
 *   node scripts/themes.ts --fetch   # re-vendor the palettes from upstream first
 *
 * The page never loads public/themes.json up front: the header's picker
 * lists the themes by name (server/pages.ts), and theme.js fetches the
 * colours only when one is picked, then keeps the picked one's tokens in
 * localStorage for the pre-paint script to lay on before the first paint.
 *
 * Monkeytype keeps each theme as ten colours. Only those colours and the
 * theme names are taken (the palettes are data); none of Monkeytype's code,
 * CSS or markup. They become keyrace's tokens like this:
 *
 *   bg → --bg        subAlt → --panel       text → --text      sub → --dim
 *   main → --accent  error → --bad          caret → --caret
 *   --line         subAlt mixed 30% toward sub: a border that shows on both
 *   --on-accent    bg or text, whichever reads better on the accent
 *   --p1…--p7      racers: fixed hues, each set to read against this bg
 *   color-scheme   dark or light, from bg's luminance
 *
 * Where a colour falls short of its pairing in scripts/contrast.ts, it's
 * nudged: its HSL lightness moved, a step at a time, away from what it sits
 * on until it passes, so hue and saturation stay the theme's own. Where the
 * typed text and the untyped (dim), or the accent and the dim, then sit too
 * close (SEPARATION there), the text moves out first and the dim back only
 * if it must. The page and panel are only moved where the text can't be, or
 * where no text and dim could both read on them and stand apart (see
 * build). Every theme is checked again after, and the build fails rather
 * than write one that doesn't pass.
 *
 * keyrace's own dark and light are read from the :root blocks at the top of
 * public/style.css (the system-following default), checked the same way,
 * and listed first. Nothing of theirs is nudged: if they fall short, the
 * build fails and style.css is what to fix.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { contrast, luminance, PAIRS, parseHex, SEPARATION, shortfalls, toHex, type Rgb } from "./contrast.ts";

const REPO = "monkeytypegame/monkeytype";
const FILE = "frontend/src/ts/constants/themes.ts";
const VENDORED = "scripts/monkeytype-themes.json";
const OUT = "public/themes.json";

type Palette = Record<"bg" | "main" | "caret" | "sub" | "subAlt" | "text" | "error" | "errorExtra" | "colorfulError" | "colorfulErrorExtra", string>;
type Vendored = { source: string; license: string; note: string; themes: Record<string, Palette> };
export type Theme = { id: string; label: string; scheme: "dark" | "light"; tokens: Record<string, string> };

// --- re-vendoring: read the colour values out of upstream's source --------

async function vendor(): Promise<void> {
  // pinned to the last commit that touched the file, so the source is exact
  const commits = await (await fetch(`https://api.github.com/repos/${REPO}/commits?path=${FILE}&per_page=1`)).json();
  const sha: string = commits[0].sha;
  const source = `https://raw.githubusercontent.com/${REPO}/${sha}/${FILE}`;
  const src = await (await fetch(source)).text();
  const start = src.indexOf("export const themes");
  const body = src.slice(start, src.indexOf("\n};", start));
  const themes: Record<string, Palette> = {};
  for (const m of body.matchAll(/^ {2}("?)([a-z0-9_]+)\1: \{([^}]*)\}/gm)) {
    const colours = Object.fromEntries([...m[3].matchAll(/(\w+): "(#[0-9a-fA-F]{3,8})"/g)].map((c) => [c[1], c[2].toLowerCase()]));
    themes[m[2]] = colours as Palette;
  }
  if (Object.keys(themes).length < 100) throw new Error(`only ${Object.keys(themes).length} themes found upstream: has its shape changed?`);
  const out: Vendored = {
    source,
    license: `Monkeytype (https://github.com/${REPO}) is GPL-3.0.`,
    note: "Theme names and colour values only, as data: no Monkeytype code, CSS or markup. Regenerate with node scripts/themes.ts --fetch.",
    themes: Object.fromEntries(Object.entries(themes).sort(([a], [b]) => a.localeCompare(b))),
  };
  writeFileSync(VENDORED, JSON.stringify(out, null, 1) + "\n");
  console.log(`vendored ${Object.keys(themes).length} palettes into ${VENDORED}`);
}

// --- colour ---------------------------------------------------------------

// A colour with alpha (#rrggbbaa) is laid over what it sits on.
export function opaque(hex: string, over: string): string {
  const h = hex.replace(/^#/, "");
  if (h.length !== 4 && h.length !== 8) return toHex(parseHex(hex));
  const a = parseInt(h.length === 4 ? h[3] + h[3] : h.slice(6), 16) / 255;
  const fg = parseHex(hex);
  const bg = parseHex(over);
  return toHex(fg.map((v, i) => v * a + bg[i] * (1 - a)) as Rgb);
}

type Hsl = [h: number, s: number, l: number];

export function toHsl([r, g, b]: Rgb): Hsl {
  [r, g, b] = [r / 255, g / 255, b / 255];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function fromHsl([h, s, l]: Hsl): Rgb {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

const mix = (a: string, b: string, t: number): string =>
  toHex(parseHex(a).map((v, i) => v + (parseHex(b)[i] - v) * t) as Rgb);

const STEP = 0.005;

// The least lightness change that has `hex` clear `min` against every one
// of `on`. It moves away from the first (the page): lighter on a dark page,
// darker on a light one. Only if that runs out, and `flip` allows, does it
// try the other side.
export function nudge(hex: string, on: string[], min: number, flip = true): string | null {
  return shift(hex, (c) => on.every((b) => contrast(c, b) >= min), on[0], flip);
}

// The same walk for any test: the least lightness change that `passes`,
// moving away from `from` first.
function shift(hex: string, passes: (c: string) => boolean, from: string, flip = true): string | null {
  if (passes(hex)) return hex;
  const [h, s, l] = toHsl(parseHex(hex));
  const up = luminance(parseHex(hex)) >= luminance(parseHex(from));
  for (const dir of (up ? [1, -1] : [-1, 1]).slice(0, flip ? 2 : 1)) {
    for (let k = 1; k * STEP <= 1; k++) {
      const next = l + dir * k * STEP;
      if (next < 0 || next > 1) break;
      const c = toHex(fromHsl([h, s, next]));
      if (passes(c)) return c;
    }
  }
  return null;
}

function must(hex: string, on: string[], min: number): string {
  return nudge(hex, on, min) ?? fail(`no lightness of ${hex} reaches ${min}:1 against ${on.join(" and ")}`);
}

function fail(why: string): never {
  throw new Error(why);
}

const apart = (a: string, b: string): number => SEPARATION.find(([x, y]) => x === a && y === b)![2];

// --- racers ---------------------------------------------------------------

// Nine hues, most distinct first. The two nearest the theme's accent (which
// is yours) and its mistake colour are left out, so nobody else's colour
// passes for your own or for a typo; the first seven left are p1…p7.
const RACER_HUES = [210, 25, 145, 275, 330, 185, 50, 100, 0];

function racers(bg: string, dark: boolean, avoid: string[]): string[] {
  const near = (h: number, c: string) => {
    const [ch, cs] = toHsl(parseHex(c));
    return cs < 0.2 ? 360 : Math.min(Math.abs(h - ch), 360 - Math.abs(h - ch));
  };
  const keep = [...RACER_HUES];
  for (const c of avoid) {
    const worst = keep.reduce((a, b) => (near(b, c) < near(a, c) ? b : a));
    if (near(worst, c) < 30) keep.splice(keep.indexOf(worst), 1);
  }
  // each starts mid-lightness and is nudged to 4.5:1 rather than the 3:1 a
  // mark needs: the name tag over someone's caret is the page colour on theirs
  return keep.slice(0, 7).map((h) => must(toHex(fromHsl([h, 0.7, dark ? 0.55 : 0.42])), [bg], 4.5));
}

// --- one theme ------------------------------------------------------------

export type Nudge = { token: string; from: string; to: string };

export function build(p: Palette): { theme: Omit<Theme, "id" | "label">; nudged: Nudge[] } {
  let bg = opaque(p.bg, "#000000");
  let panel = opaque(p.subAlt, bg);
  const raw = {
    text: opaque(p.text, bg),
    dim: opaque(p.sub, bg),
    accent: opaque(p.main, bg),
    bad: opaque(p.error, bg),
    caret: opaque(p.caret, bg),
  };
  const nudged: Nudge[] = [];
  const note = (token: string, from: string, to: string) => {
    if (to !== from) nudged.push({ token, from, to });
    return to;
  };
  // A few palettes sit their text on a mid-tone page and panel that
  // straddle the point where light text stops reading and dark text starts.
  // Flipping cream text to black would make it another theme, so there the
  // surface that falls short moves instead, away from the text, until the
  // text as published reads on it.
  const published = { bg, panel };
  if (!nudge(raw.text, [bg, panel], 4.5, false)) {
    bg = must(bg, [raw.text], 4.5);
    panel = must(panel, [raw.text], 4.5);
  }
  // The typed letters have to stand apart from the untyped ones
  // (SEPARATION), and both have to read on the page, all on the text's side
  // of it. Those multiply: text 2:1 from a dim that's 4.5:1 on the page is
  // 9:1 on the page. Where even white (or black) can't reach that, no text
  // and dim could, so the surface moves on, away from the text, until it
  // can, with a little to spare (at exactly 9:1 the dim would have to be
  // one exact colour, which a stepped search can miss).
  const light = luminance(parseHex(raw.text)) >= luminance(parseHex(bg));
  const far = light ? "#ffffff" : "#000000";
  const reach = PAIRS.find(([fg, on]) => fg === "dim" && on === "bg")![2] * apart("text", "dim") * 1.05;
  bg = note("bg", published.bg, must(bg, [far], reach));
  panel = note("panel", published.panel, must(panel, [far], reach));
  const reads = (min: number) => (c: string) => contrast(c, bg) >= min && contrast(c, panel) >= min;
  const fix = (token: keyof typeof raw, on: string[], min: number) => must(raw[token], on, min);
  let text = fix("text", [bg, panel], 4.5);
  let dim = fix("dim", [bg, panel], 4.5);
  // Typed too close to untyped: the text moves out, away from the dim, as
  // it has the most room; where it runs out of room before it's far enough,
  // it goes all the way and the dim comes back toward the page, no nearer
  // than its own 4.5:1.
  if (contrast(text, dim) < apart("text", "dim")) {
    const ok = (t: string) => (c: string) => reads(4.5)(c) && contrast(c, t) >= apart("text", "dim");
    const out = shift(text, ok(dim), dim, false);
    if (out) text = out;
    else {
      const [h, s] = toHsl(parseHex(text));
      text = toHex(fromHsl([h, s, light ? 1 : 0]));
      dim = shift(dim, ok(text), text, false) ?? fail(`no --dim reads on the page and stands apart from ${text}`);
    }
  }
  // The accent likewise from the dim, either way, whichever is nearer.
  const accent = shift(fix("accent", [bg, panel], 4.5), (c) => reads(4.5)(c) && contrast(c, dim) >= apart("accent", "dim"), dim)
    ?? fail(`no --accent reads on the page and stands apart from --dim ${dim}`);
  note("text", raw.text, text);
  note("dim", raw.dim, dim);
  note("accent", raw.accent, accent);
  const bad = note("bad", raw.bad, fix("bad", [bg, panel], 3));
  const caret = note("caret", raw.caret, fix("caret", [bg], 3));
  const onAccent = contrast(text, accent) > contrast(bg, accent) ? text : bg;
  const tokens: Record<string, string> = {
    bg, panel, text, dim, accent, "on-accent": onAccent, bad, caret,
    line: mix(panel, raw.dim, 0.3),
  };
  // dark or light by which way the text reads, not by a cut-off in the
  // page's own brightness, which a mid-tone page straddles
  const dark = luminance(parseHex(text)) > luminance(parseHex(bg));
  racers(bg, dark, [accent, bad]).forEach((c, i) => (tokens[`p${i + 1}`] = c));
  return { theme: { scheme: dark ? "dark" : "light", tokens }, nudged };
}

// keyrace's own pair, read from style.css's :root blocks.
function keyrace(): Theme[] {
  const css = readFileSync("public/style.css", "utf8");
  const read = (block: string | undefined, what: string) => {
    if (!block) throw new Error(`no ${what} block found at the top of public/style.css`);
    const tokens = Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})\b/gi)].map((m) => [m[1], m[2].toLowerCase()]));
    tokens.caret ??= tokens.accent;
    return tokens;
  };
  const dark = read(css.match(/^:root \{([^}]*)\}/m)?.[1], ":root");
  const light = read(css.match(/@media \(prefers-color-scheme: light\) \{\s*:root:not\(\[data-theme\]\) \{([^}]*)\}/)?.[1], "light :root");
  return [
    { id: "keyrace-dark", label: "keyrace dark", scheme: "dark", tokens: dark },
    { id: "keyrace-light", label: "keyrace light", scheme: "light", tokens: light },
  ];
}

// --- the build ------------------------------------------------------------

// Every theme the picker offers, keyrace's own first, then Monkeytype's in
// name order, and what was nudged in each to get there.
export function generate(): { themes: Theme[]; nudged: Record<string, Nudge[]>; palettes: Record<string, Palette> } {
  const vendored: Vendored = JSON.parse(readFileSync(VENDORED, "utf8"));
  const themes = keyrace();
  const nudged: Record<string, Nudge[]> = {};
  const palettes: Record<string, Palette> = {};
  for (const [name, palette] of Object.entries(vendored.themes)) {
    const id = name.replace(/_/g, "-");
    const built = build(palette);
    themes.push({ id, label: name.replace(/_/g, " "), ...built.theme });
    palettes[id] = palette;
    if (built.nudged.length) nudged[id] = built.nudged;
  }
  return { themes, nudged, palettes };
}

async function main(): Promise<void> {
  if (process.argv.includes("--fetch")) await vendor();
  const { themes, nudged, palettes } = generate();
  const failing = themes.flatMap((t) => shortfalls(t.tokens).map((f) => `${t.id}: ${f}`));
  if (failing.length) {
    console.error(`themes falling short of contrast:\n  ${failing.join("\n  ")}`);
    process.exit(1);
  }
  // one theme a line, so a change to one palette is a one-line diff
  const lines = themes.map((t) => JSON.stringify(t));
  writeFileSync(OUT, `[\n${lines.join(",\n")}\n]\n`);
  console.log(`${lines.length} themes into ${OUT}; ${Object.keys(nudged).length} of ${Object.keys(palettes).length} Monkeytype palettes nudged:`);
  for (const [id, ns] of Object.entries(nudged)) console.log(`  ${id}: ${ns.map((n) => `${n.token} ${n.from}→${n.to}`).join(", ")}`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
