// WCAG 2.2 contrast (SC 1.4.3), and the pairings every theme must clear.
// Shared by the theme generator (scripts/themes.ts), which nudges colours
// until they pass, and by the checks that hold it to that: the spec reads
// the served themes.css, and pnpm shoot reads what the browser computes.

export type Rgb = [number, number, number];

export function parseHex(hex: string): Rgb {
  let h = hex.replace(/^#/, "");
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
  const n = parseInt(h.slice(0, 6), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}

export const toHex = ([r, g, b]: Rgb): string =>
  "#" + [r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("");

export function luminance([r, g, b]: Rgb): number {
  const lin = (v: number) => {
    v /= 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrast(a: Rgb | string, b: Rgb | string): number {
  const la = luminance(typeof a === "string" ? parseHex(a) : a);
  const lb = luminance(typeof b === "string" ? parseHex(b) : b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// What each colour is read against, and how much it needs. Text and the
// dimmed (untyped) text are body copy on the page and in panels: 4.5:1.
// The accent is your name, your pace and every link, at body size, so it's
// held to 4.5:1 as well, and whatever sits on it (on-accent) likewise.
// Mistakes, the caret and the racers' colours only have to read as marks
// against the page (or as large text, like the arcade's ×4): 3:1.
export const PAIRS: Array<[fg: string, bg: string, min: number]> = [
  ["text", "bg", 4.5],
  ["text", "panel", 4.5],
  ["dim", "bg", 4.5],
  ["dim", "panel", 4.5],
  ["accent", "bg", 4.5],
  ["accent", "panel", 4.5],
  ["on-accent", "accent", 4.5],
  ["bad", "bg", 3],
  ["bad", "panel", 3],
  ["caret", "bg", 3],
  ...[1, 2, 3, 4, 5, 6, 7].map((i): [string, string, number] => [`p${i}`, "bg", 3]),
];

// Every pairing a theme's tokens fail, as readable lines (empty if none).
export function shortfalls(tokens: Record<string, string | Rgb>): string[] {
  const out: string[] = [];
  for (const [fg, bg, min] of PAIRS) {
    if (!(fg in tokens) || !(bg in tokens)) {
      out.push(`--${fg} or --${bg} missing`);
      continue;
    }
    const r = contrast(tokens[fg], tokens[bg]);
    if (r < min) out.push(`--${fg} on --${bg} is ${r.toFixed(2)}:1, under ${min}:1`);
  }
  return out;
}
