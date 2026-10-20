/**
 * Look at the race instead of assuming.
 *
 * Drives real Chromium against the running app at both marking viewports,
 * 1920x1080 and 390x844, and fails loudly on anything a person would notice
 * that `pnpm check` can't: a console error, a serious axe violation in any
 * theme, a page that scrolls sideways, a race that can't be played from the
 * keyboard alone, a countdown that jumps around, a racer who can't see the
 * other one, an arcade meter that doesn't climb or reset, and a page or
 * socket heavier than its budget.
 *
 *   pnpm shoot                     # against APP_URL (default localhost:8080)
 *   pnpm shoot https://….fly.dev/  # against the deployed site
 *
 * Screenshots of every state, in every theme it checks, land in .screens/.
 */

import { mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import puppeteer, { type Browser, type Page } from "puppeteer-core";

const OUT = resolve(".screens");
const CHROME = ["/usr/bin/chromium", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"];
const VIEWPORTS = [
  { name: "desktop", width: 1920, height: 1080 },
  { name: "phone", width: 390, height: 844 },
];

// What a first visit costs over the wire (gzipped HTML + CSS + JS), and what
// one state message mid-race weighs. Both were measured, then given headroom;
// tighten them as the app gets lighter, never loosen them to pass.
const FIRST_LOAD_BUDGET = 40_000;
const STATE_MSG_BUDGET = 700;

const base = new URL(process.argv[2] ?? process.env.APP_URL ?? "http://localhost:8080");
const room = (tag: string) => new URL(`/r/shoot-${tag}-${Date.now().toString(36)}`, base).href;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const problems: string[] = [];
const report: string[] = [`target: ${base.href}`];

function findChrome(): string {
  const found = CHROME.find((p) => existsSync(p));
  if (!found) throw new Error(`no Chromium found; looked in ${CHROME.join(", ")}`);
  return found;
}

type Violation = { id: string; impact: string; help: string; where: string; why: string };

// Nothing else measures accessibility, so this is the sensor for it. Only
// serious and critical violations fail the run.
async function axe(page: Page): Promise<Violation[]> {
  await page.addScriptTag({ path: createRequire(import.meta.url).resolve("axe-core") });
  return page.evaluate(async () => {
    const run = (globalThis as unknown as {
      axe: {
        run: (o: unknown) => Promise<{
          violations: Array<{
            id: string;
            impact: string | null;
            help: string;
            nodes: Array<{ target: string[]; html: string; any: Array<{ message: string }> }>;
          }>;
        }>;
      };
    }).axe.run;
    const { violations } = await run({ runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } });
    return violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => ({
        id: v.id,
        impact: v.impact ?? "",
        help: v.help,
        where: v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(", "),
        // the first offender's markup and axe's reason, so a failure says
        // what to fix rather than just where
        why: `${v.nodes[0]?.html.slice(0, 70) ?? ""} — ${v.nodes[0]?.any[0]?.message ?? ""}`,
      }));
  });
}

async function overflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

async function open(browser: Browser, url: string, vp: (typeof VIEWPORTS)[number], note: (m: string) => void) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: vp.width, height: vp.height });
  page.on("console", (m) => {
    // the browser asking for a favicon nobody serves isn't the app's error
    if (m.type() === "error" && !m.location()?.url?.endsWith("/favicon.ico")) note(`console: ${m.text()}`);
  });
  page.on("pageerror", (e) => note(`pageerror: ${(e as Error).message}`));
  await page.goto(url, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => /^Waiting|^Starts/.test(document.getElementById("phase")!.textContent ?? ""));
  return { ctx, page };
}

const passage = (page: Page) =>
  page.$$eval("#passage span:not(.tape-track)", (s) => s.map((x) => x.textContent).join("").replace(/↵\n?/g, "\n"));

async function shot(page: Page, name: string, full = false) {
  await page.screenshot({ path: join(OUT, `${name}.png`) as `${string}.png`, fullPage: full });
}

// The first visit, measured the way a browser fetches it.
async function weigh(): Promise<void> {
  let total = 0;
  const parts: string[] = [];
  const get = async (path: string) => {
    const res = await fetch(new URL(path, base), { headers: { "accept-encoding": "gzip" } });
    const bytes = Number(res.headers.get("content-length") ?? (await res.arrayBuffer()).byteLength);
    total += bytes;
    parts.push(`${path} ${(bytes / 1000).toFixed(1)}kB${res.headers.get("content-encoding") === "gzip" ? "" : " (not gzipped)"}`);
    return res;
  };
  await get("/");
  for (const p of ["/static/style.css", "/static/app.js", "/static/theme.js"]) {
    const res = await get(p);
    const etag = res.headers.get("etag");
    if (!etag) problems.push(`${p} has no ETag, so every visit downloads it again`);
    else {
      const again = await fetch(new URL(p, base), { headers: { "if-none-match": etag } });
      if (again.status !== 304) problems.push(`${p} answered ${again.status} to a matching If-None-Match, not 304`);
    }
  }
  report.push(`first load: ${(total / 1000).toFixed(1)}kB over the wire (${parts.join(", ")}), budget ${FIRST_LOAD_BUDGET / 1000}kB`);
  if (total > FIRST_LOAD_BUDGET) problems.push(`first load is ${total} bytes, over the ${FIRST_LOAD_BUDGET} budget`);
}

async function viewport(browser: Browser, vp: (typeof VIEWPORTS)[number]): Promise<void> {
  const note = (m: string) => problems.push(`[${vp.name}] ${m}`);
  const url = room(vp.name);

  // Two racers in the same room: one plays by keyboard alone, one watches.
  const a = await open(browser, url, vp, note);
  const b = await open(browser, url, vp, note);
  const pa = a.page;
  const pb = b.page;

  // Socket weight: count what A receives from here on.
  const cdp = await pa.createCDPSession();
  await cdp.send("Network.enable");
  const frames: number[] = [];
  cdp.on("Network.webSocketFrameReceived", (e) => {
    const data = (e as { response: { payloadData: string } }).response.payloadData;
    if (data.startsWith('{"t":"state"')) frames.push(data.length);
  });

  // The lobby, in every theme the picker offers: axe reads the real page.
  const themes = await pa.$$eval("#theme option", (os) => os.map((o) => (o as HTMLOptionElement).value).filter(Boolean));
  if (themes.length < 2) note(`only ${themes.length} theme(s) offered`);
  for (const v of await axe(pa)) note(`axe [system] ${v.impact}: ${v.id} at ${v.where} — ${v.help}`);
  for (const id of themes) {
    await pa.select("#theme", id);
    await wait(450); // a view transition crossfades the change; judge it settled
    const worn = await pa.evaluate(() => document.documentElement.dataset.theme);
    if (worn !== id) note(`picked theme ${id}, page wears ${worn}`);
    for (const v of await axe(pa)) note(`axe [${id}] ${v.impact}: ${v.id} at ${v.where} — ${v.help}`);
    if (vp.name === "desktop") await shot(pa, `theme-${id}`);
  }
  await pa.reload({ waitUntil: "networkidle0" });
  if ((await pa.evaluate(() => document.documentElement.dataset.theme)) !== themes.at(-1)) {
    note("the chosen theme didn't survive a reload");
  }
  await pa.select("#theme", "");
  await wait(450);
  await shot(pa, `${vp.name}-lobby`, true);
  if ((await overflow(pa)) > 0) note(`lobby scrolls sideways by ${await overflow(pa)}px`);

  // Keyboard only from here: focus the box the way a person would, by Tab.
  await pa.focus("body");
  let reached = false;
  for (let i = 0; i < 40 && !reached; i++) {
    await pa.keyboard.press("Tab");
    reached = await pa.evaluate(() => document.activeElement?.id === "input");
  }
  if (!reached) note("Tab never reaches the typing box");
  await pa.focus("#input");

  // A keystroke joins; Enter readies. B joins and readies by keyboard too.
  await pa.keyboard.press("a");
  await pb.focus("#input");
  await pb.keyboard.press("a");
  await wait(300);
  await shot(pa, `${vp.name}-countdown`);
  for (const v of await axe(pa)) note(`axe [countdown] ${v.impact}: ${v.id} at ${v.where} — ${v.help}`);

  // The countdown is the server's clock: it should tick down one at a time,
  // never jump or stall, whatever the socket's jitter.
  const ticks: number[] = [];
  for (let i = 0; i < 6; i++) {
    const n = Number(await pa.$eval("#banner .big", (e) => e.textContent));
    if (Number.isFinite(n)) ticks.push(n);
    await wait(500);
  }
  const jumps = ticks.slice(1).filter((n, i) => ticks[i] - n > 1 || n > ticks[i]);
  if (jumps.length) note(`countdown jumped: ${ticks.join(" → ")}`);

  await pa.keyboard.press("Enter");
  await pb.keyboard.press("Enter");
  await pa.waitForFunction(() => document.getElementById("phase")!.textContent!.startsWith("Racing"), { timeout: 15_000 });

  // The race: A types it all, with one wrong word fixed by backspacing into
  // it; B gets part way. Each should see the other while it happens.
  const text = await passage(pa);
  const words = text.split(" ");
  await pb.keyboard.type(text.slice(0, 12), { delay: 70 });
  const wrong = words[0].slice(0, -1) + (words[0].at(-1) === "x" ? "y" : "x");
  await pa.keyboard.type(`${wrong} `, { delay: 70 });
  await pa.keyboard.press("Backspace");
  await pa.keyboard.press("Backspace");
  await pa.keyboard.type(text.slice(words[0].length - 1, 30), { delay: 70 });
  await wait(250);
  const sees = await pa.$$eval("#passage .ghost", (g) => g.map((x) => (x as HTMLElement).dataset.name));
  if (sees.length === 0) note("mid-race, the other racer's caret isn't in the passage");
  const lanes = await pa.$$eval("#lanes li", (l) => l.length);
  if (lanes !== 2) note(`mid-race, ${lanes} lane(s) shown for 2 racers`);
  await shot(pa, `${vp.name}-racing`);
  if ((await overflow(pa)) > 0) note(`race view scrolls sideways by ${await overflow(pa)}px`);
  for (const v of await axe(pa)) note(`axe [racing] ${v.impact}: ${v.id} at ${v.where} — ${v.help}`);

  // Is the passage, the box and your pace all on screen at once while racing?
  const fits = await pa.evaluate(() => {
    const vh = innerHeight;
    return ["#passage", "#input", "#me-live"].filter((s) => {
      const r = document.querySelector(s)!.getBoundingClientRect();
      return r.bottom > vh || r.top < 0;
    });
  });
  if (fits.length) note(`racing, off screen: ${fits.join(", ")}`);

  await pa.keyboard.type(text.slice(30), { delay: 45 });
  await pa.waitForFunction(() => /Finished/.test(document.getElementById("banner")!.textContent ?? ""), { timeout: 30_000 })
    .catch(() => note("typing the whole passage (one fixed mistake) didn't finish the race"));
  await pb.close();
  await pa.waitForFunction(() => !document.getElementById("summary")!.hidden, { timeout: 15_000 })
    .catch(() => note("the summary never appeared"));
  await wait(500);
  await shot(pa, `${vp.name}-results`, true);
  // a lane's place and pace is one reading; wrapped onto two lines it isn't
  const wrapped = await pa.$$eval("#lanes .num", (ns) =>
    ns.filter((n) => n.getBoundingClientRect().height > parseFloat(getComputedStyle(n).lineHeight) * 1.5).map((n) => n.textContent),
  );
  if (wrapped.length) note(`lane stats wrap onto two lines: ${wrapped.join(", ")}`);
  if ((await overflow(pa)) > 0) note(`results scroll sideways by ${await overflow(pa)}px`);
  for (const v of await axe(pa)) note(`axe [results] ${v.impact}: ${v.id} at ${v.where} — ${v.help}`);

  // racing frames only: the joins and the passage itself are once-off
  const racing = frames.slice(-20);
  const avg = racing.reduce((s, n) => s + n, 0) / Math.max(1, racing.length);
  report.push(`${vp.name} ${vp.width}x${vp.height}: ${themes.length} themes scanned, state ~${Math.round(avg)}B/msg mid-race (budget ${STATE_MSG_BUDGET}B), countdown ${ticks.join("→")}`);
  if (avg > STATE_MSG_BUDGET) note(`state messages average ${Math.round(avg)}B, over the ${STATE_MSG_BUDGET}B budget`);

  await a.ctx.close();
  await b.ctx.close();
}

// Arcade, played the way it's scored: clean words should climb the
// multiplier, one mistake should drop it, and the meter and results should
// say so, on screen and inside the page's width.
async function arcade(browser: Browser, vp: (typeof VIEWPORTS)[number]): Promise<void> {
  const note = (m: string) => problems.push(`[${vp.name} arcade] ${m}`);
  const { ctx, page } = await open(browser, room(`arcade-${vp.name}`), vp, note);
  await page.click('.mode[data-mode="arcade"]');
  await page.waitForFunction(() => document.querySelector('.mode[data-mode="arcade"]')!.getAttribute("aria-checked") === "true");
  await page.focus("#input");
  await page.keyboard.press("a");
  await wait(200);
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.getElementById("phase")!.textContent!.startsWith("Racing"), { timeout: 15_000 });
  const words = (await passage(page)).split(" ");
  const meter = () =>
    page.evaluate(() => ({
      shown: !document.getElementById("arcade")!.hidden,
      combo: Number(document.getElementById("combo")!.textContent),
      x: document.getElementById("mult")!.textContent,
    }));
  for (let w = 0; w < 6; w++) await page.keyboard.type(`${words[w]} `, { delay: 55 });
  await wait(250);
  const built = await meter();
  if (!built.shown) note("the combo meter isn't shown during an arcade game");
  if (built.x !== "×2") note(`six clean words should reach ×2, meter says ${built.x}`);
  if (built.combo < 20) note(`combo only ${built.combo} after six clean words`);
  await shot(page, `${vp.name}-arcade`);
  if ((await overflow(page)) > 0) note(`arcade scrolls sideways by ${await overflow(page)}px`);
  const meterBox = await page.$eval("#arcade", (e) => {
    const r = e.getBoundingClientRect();
    return r.bottom <= innerHeight && r.top >= 0;
  });
  if (!meterBox) note("the combo meter is off screen while racing");
  for (const v of await axe(page)) note(`axe ${v.impact}: ${v.id} at ${v.where} — ${v.why}`);

  const next = words[6];
  await page.keyboard.type(next[0] === "z" ? "q" : "z", { delay: 55 });
  await wait(250);
  const broken = await meter();
  if (broken.x !== "×1" || broken.combo !== 0) note(`a mistake should reset to ×1 and combo 0, meter says ${broken.x} / ${broken.combo}`);
  await ctx.close();
}

async function main(): Promise<void> {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  await weigh();
  const browser = await puppeteer.launch({ executablePath: findChrome(), args: ["--no-sandbox", "--font-render-hinting=none"] });
  try {
    for (const vp of VIEWPORTS) {
      await viewport(browser, vp);
      await arcade(browser, vp);
    }
  } finally {
    await browser.close();
  }
  console.log(report.join("\n"));
  console.log(`screens: ${OUT}`);
  if (problems.length) {
    console.error(`\n${problems.length} problem(s):\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    process.exit(1);
  }
  console.log("\nno problems found");
}

await main();
