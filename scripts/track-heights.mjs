// The Performance record's held and drawn heights (review of #69): in headless Chromium, public/ served as the Worker's
// assets, the box's height at every width from 320 to 1600 px while the record loads (held back) and once each answer is
// drawn: the managed exit pending (the live record of 2026-11-22), shown, and no record. It writes
// test/fixtures/track-heights.json, which test/theme.test.mjs (TH20) checks: a record's normal shapes never draw more than
// 2 px shorter than the room held for them, the pending shape draws at it, and the file is measured from the current
// layout (layoutHash: the fonts, the head of home.css to the body rule, its Performance rules, the page's <main>, its
// script and trackModel).
// Playwright is not a dependency of this repository (CI runs the tests before npm ci): point PLAYWRIGHT at a copy.
// Run: PLAYWRIGHT=/path/to/node_modules/playwright node scripts/track-heights.mjs
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, statSync, realpathSync, readdirSync } from "node:fs";
import { extname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const at = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const read = (p) => readFileSync(at(p), "utf8");

/** The answers measured: the live record (managed exit pending), the same with the managed exit shown, and no record. */
const pending = { available: true, version: "cryptophys.public-track-record.v1", unit: "R", simulated: true, delay_hours: 24, count: 96, since: "2026-11-09", replay_check: { status: "insufficient", shown: false }, scenarios: [
  { id: "first", label: "Exit at TP1", shown: true, since: "2026-11-09", count: 96, won: 42, lost: 22, even: 32, win_rate: 0.438, expectancy_r: 0.23, net_r: 22.41, avg_win_r: 1.06, avg_loss_r: -1, profit_factor: 2.02 },
  { id: "second", label: "Exit at TP2", shown: true, since: "2026-11-10", count: 85, won: 20, lost: 17, even: 48, win_rate: 0.235, expectancy_r: 0.37, net_r: 31.05, avg_win_r: 2.4, avg_loss_r: -1, profit_factor: 2.83 },
  { id: "managed", label: "Managed exit (the system's live rules)", shown: false, note: "Shown once the replay matches the live account." }
], notice: "Simulated, in R. Not advice and not an invitation to trade." };
const shown = { ...pending, replay_check: { status: "pass", shown: true }, scenarios: [...pending.scenarios.slice(0, 2),
  { id: "managed", label: "Managed exit (the system's live rules)", shown: true, since: "2026-11-12", count: 41, won: 21, lost: 16, even: 4, win_rate: 0.512, expectancy_r: 0.18, net_r: 7.38, avg_win_r: 1.12, avg_loss_r: -1, profit_factor: 1.47 }] };
export const ANSWERS = Object.freeze({ pending, shown, none: { available: false, unit: "R", simulated: true, scenarios: [], notice: pending.notice } });

/**
 * The hash of what the record's heights follow: the fonts (their bytes), the head of home.css to the body rule (the
 * @font-face rules, :root's sizes, gutters and widths, html and body with its line height), the Performance rules, the
 * page's <main>, its script and trackModel (re-review of #69: a :root or body change kept the hash).
 */
export function layoutHash() {
  const css = read("public/home.css"), html = read("public/performance.html");
  const body = css.indexOf("\nbody{"), headEnd = body < 0 ? -1 : css.indexOf("\n", body + 1);
  const a = css.indexOf("/* ---------- the Performance page"), b = css.indexOf("/* the header's average strip");
  const main = html.slice(html.indexOf("<main"), html.indexOf("</main>"));
  if (headEnd < 0 || a < 0 || b < a || !main) throw new Error("the head of home.css, the Performance rules or <main> not found");
  const h = createHash("sha256");
  for (const f of readdirSync(at("public/fonts")).filter((n) => n.endsWith(".woff2")).sort()) h.update(f).update("\0").update(readFileSync(at(`public/fonts/${f}`))).update("\0");
  for (const part of [css.slice(0, headEnd), css.slice(a, b), main, read("site/performance/performance.js"), read("site/home/track.js")]) h.update(part).update("\0");
  return h.digest("hex").slice(0, 16);
}

/** Runs of equal height ("320-377:887.14") from heights at consecutive widths, and back. */
export const toRuns = (from, hs) => hs.reduce((r, h, k) => { const last = r.at(-1); if (last && Math.abs(last[2] - h) < 0.005) last[1] = from + k; else r.push([from + k, from + k, h]); return r; }, []).map(([a, b, h]) => `${a}-${b}:${h.toFixed(2)}`);
export const fromRuns = (runs) => new Map(runs.flatMap((r) => { const [, a, b, h] = r.match(/^(\d+)-(\d+):([\d.]+)$/).map(Number); return Array.from({ length: b - a + 1 }, (_, k) => [a + k, h]); }));

// Run as a script (not imported by the tests).
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const pw = await import(process.env.PLAYWRIGHT || "playwright");
  const { chromium } = pw.chromium ? pw : pw.default;
  const TYPE = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".txt": "text/plain" };
  const server = createServer((req, res) => {
    let p = new URL(req.url, "http://x").pathname;
    if (p.startsWith("/api/")) { res.writeHead(404); return res.end(); }
    if (!extname(p)) p += ".html";
    const f = at(`public${p}`);
    if (!existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": TYPE[extname(f)] ?? "application/octet-stream" }); res.end(readFileSync(f));
  }).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const url = `http://127.0.0.1:${server.address().port}/performance`;
  const FROM = 320, TO = 1600;
  const browser = await chromium.launch();
  const sweep = async (answer) => {
    const page = await (await browser.newContext({ viewport: { width: TO, height: 900 }, deviceScaleFactor: 1 })).newPage();
    await page.route("**/api/public/track-record", (route) => { if (answer) route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(answer) }); });
    await page.goto(url, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    if (answer) await page.waitForFunction(() => !document.getElementById("track-box").hasAttribute("aria-busy"));
    const hs = [];
    for (let w = FROM; w <= TO; w++) { await page.setViewportSize({ width: w, height: 900 }); hs.push(await page.evaluate(() => document.getElementById("track-box").getBoundingClientRect().height)); }
    await page.context().close();
    return toRuns(FROM, hs);
  };
  const out = { measured: "headless Chromium, deviceScaleFactor 1, scripts/track-heights.mjs", chromium: browser.version(), layout: layoutHash(), held: await sweep(null) };
  for (const [k, answer] of Object.entries(ANSWERS)) out[k] = await sweep(answer);
  await browser.close(); server.close();
  writeFileSync(at("test/fixtures/track-heights.json"), `${JSON.stringify(out, null, 2)}\n`);
  console.log(`test/fixtures/track-heights.json: layout ${out.layout}; held ${out.held.length} runs, pending ${out.pending.length}, shown ${out.shown.length}, none ${out.none.length}`);
}
