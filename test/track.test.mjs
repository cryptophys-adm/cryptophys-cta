// The simulated track record (owner 2026-11-20, "approved all"): GET /api/public/track-record over
// PublicProjection.trackRecord (xauusd-ai-trading-assistant #499), the Performance page's table with the managed exit
// shown and hidden, the home's average box, and the new copy through the guardian.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { trackModel, averages, trackAvailable, signedR, dayWords, PENDING_NOTE, NOT_YET, COLUMNS } from "../site/home/track.js";
import { handle, trackRecord, publicTrackRecord, TRACK_TTL_S } from "../src/app.mjs";
import { checkContentDraft } from "../src/guardian.mjs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const first = { id: "first", label: "Exit at TP1", shown: true, since: "2026-11-09", count: 72, won: 31, lost: 19, even: 22, win_rate: 0.431, expectancy_r: 0.21, net_r: 14.94, avg_win_r: 1.09, avg_loss_r: -1, profit_factor: 1.79 };
const second = { id: "second", label: "Exit at TP2", shown: true, since: "2026-11-09", count: 72, won: 15, lost: 14, even: 43, win_rate: 0.208, expectancy_r: 0.32, net_r: 19.6, avg_win_r: 2.24, avg_loss_r: -1, profit_factor: 2.4 };
const managed = { id: "managed", label: "Managed exit (the system's live rules)", shown: true, since: "2026-11-12", count: 41, won: 31, lost: 10, even: 0, win_rate: 0.756, expectancy_r: 0.18, net_r: 7.38, avg_win_r: 0.56, avg_loss_r: -1, profit_factor: 1.74 };
const hidden = { id: "managed", label: "Managed exit (the system's live rules)", shown: false, note: "Shown once the replay matches the live account." };
const record = (over = {}) => ({
  version: "cryptophys.public-track-record.v1", unit: "R", simulated: true, delay_hours: 24, updated_at: "2026-11-20T03:00:00.000Z",
  count: 72, since: "2026-11-09", replay_check: { status: "pass", shown: true }, scenarios: [first, second, managed], ...over
});
const hiddenRecord = () => record({ replay_check: { status: "insufficient", shown: false }, scenarios: [first, second, hidden] });

test("TK1 the table with the managed exit shown: each column's own count and start, four rows, R and no colour words", () => {
  const m = trackModel(record());
  assert.equal(m.available, true);
  assert.equal(m.basis, "Simulated. Updated daily, a day behind.");
  assert.deepEqual(m.columns.map((c) => [c.title, c.sub]), [["Exit at TP1", "72 plans since 9 Nov 2026"], ["Exit at TP2", "72 plans since 9 Nov 2026"], ["Managed exit", "41 trades since 12 Nov 2026"]],
    "the columns cover different sets: each carries its own count");
  assert.deepEqual(m.rows.map((r) => r.label), ["Win rate", "Expectancy", "Net R", "Profit factor"]);
  const v = (row) => m.rows[row].cells.map((c) => [c.value, c.note]);
  assert.deepEqual(v(0), [["43%", "31 won, 19 lost, 22 even"], ["21%", "15 won, 14 lost, 43 even"], ["76%", "31 won, 10 lost"]]);
  assert.deepEqual(v(1), [["+0.21R", "per plan"], ["+0.32R", "per plan"], ["+0.18R", "per trade"]]);
  assert.deepEqual(v(2), [["+14.9R", "average win +1.09R, loss −1R"], ["+19.6R", "average win +2.24R, loss −1R"], ["+7.4R", "average win +0.56R, loss −1R"]]);
  assert.deepEqual(v(3), [["1.79", ""], ["2.40", ""], ["1.74", ""]]);
  assert.ok(m.rows.every((r) => r.cells.every((c) => !c.pending)));
  assert.deepEqual(m.rows[0].cells.map((c) => c.col), COLUMNS.map((c) => c.title), "a phone row is labelled by its column");
  assert.deepEqual(averages(record()).map((a) => [a.title, a.value]), [["Exit at TP1", "+0.21R"], ["Exit at TP2", "+0.32R"], ["Managed exit", "+0.18R"]]);
  assert.equal(signedR(-0.004), "0.00R"); assert.equal(signedR(-1.5, 2, true), "−1.5R"); assert.equal(dayWords("2026-11-09"), "9 Nov 2026");
});

test("TK2 the managed exit hidden: one slate line over the four rows, no number; hidden too when only one of the two flags says shown", () => {
  for (const body of [hiddenRecord(), record({ replay_check: { status: "fail", shown: false } }), record({ scenarios: [first, second, { ...managed, shown: false }] })]) {
    const m = trackModel(body);
    const col = m.columns.find((c) => c.id === "managed");
    assert.equal(col.shown, false);
    assert.equal(col.sub, "", "no count");
    const cells = m.rows.flatMap((r) => r.cells.filter((c) => c.col === "Managed exit"));
    assert.equal(cells.length, 1);
    assert.deepEqual({ ...cells[0] }, { col: "Managed exit", value: "", note: PENDING_NOTE, pending: true, rowspan: 4 });
    assert.equal(m.rows[1].cells.length, 2, "the other rows carry the two shown columns only");
    assert.doesNotMatch(cells.map((c) => `${c.value} ${c.note}`).join(" "), /\d/, "no number in the managed column");
    assert.deepEqual(averages(body).map((a) => a.id), ["first", "second"], "the home box hides the managed line");
  }
  const css = read("public/home.css");
  assert.match(css, /\.track td\.pending\{[^}]*color:var\(--slate\)/, "the pending line is slate");
});

test("TK3 no record yet: the page says the numbers are not available, the home box stays hidden", () => {
  for (const body of [null, {}, { available: false, unit: "R", scenarios: [] }, { status: "unavailable" }, record({ unit: "USD" }), record({ scenarios: [hidden] })]) {
    assert.equal(trackAvailable(body), false, JSON.stringify(body));
    assert.equal(trackModel(body).available, false);
    assert.deepEqual(averages(body), []);
  }
  assert.match(NOT_YET, /not available yet/);
  const page = read("site/performance/performance.js");
  assert.match(page, /NOT_YET/);
  assert.match(read("public/index.html"), /id="avg-strip"[^>]*hidden/, "hidden until there are numbers");
});

test("TK4 GET /api/public/track-record: the documented fields from PROJECTION.trackRecord, R only, cached 10 minutes at the edge", async () => {
  const store = new Map();
  const cache = { match: async (k) => store.get(k.url)?.clone() ?? null, put: async (k, r) => { store.set(k.url, r); } };
  let calls = 0;
  const env = { PROJECTION: { trackRecord: async () => { calls++; return record({ extra: "x", scenarios: [{ ...first, trade_plan: [1], price: 4021.5 }, second, { ...managed, label: "Omega v4" }] }); } } };
  const req = () => new Request("https://cta.cryptophys.work/api/public/track-record");
  const r = await handle(req(), env, { cache });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), `public, max-age=${TRACK_TTL_S}`);
  assert.equal(TRACK_TTL_S, 600);
  const body = await r.json();
  assert.equal(body.available, true);
  assert.equal(body.unit, "R");
  assert.deepEqual(body.scenarios.map((s) => s.id), ["first", "second", "managed"]);
  assert.deepEqual(Object.keys(body.scenarios[0]).sort(), ["avg_loss_r", "avg_win_r", "count", "even", "expectancy_r", "id", "label", "lost", "net_r", "profit_factor", "shown", "since", "win_rate", "won"]);
  assert.doesNotMatch(JSON.stringify(body), /omega|trade_plan|price|extra/i, "nothing beyond the documented aggregates; never the internal name");
  assert.equal(body.scenarios[2].label, null);
  // A second visitor is answered from the edge cache, with the browser's 10 minutes set again.
  const [k] = store.keys(); const h = new Headers(store.get(k).headers); h.set("cache-control", "public, max-age=14400");
  store.set(k, new Response(await store.get(k).clone().text(), { status: 200, headers: h }));
  const again = await handle(req(), env, { cache });
  assert.equal(calls, 1);
  assert.equal(again.headers.get("cache-control"), `public, max-age=${TRACK_TTL_S}`);
  // The managed exit passes on numbers only when the replay check and its own flag both say shown.
  const p = publicTrackRecord(record({ replay_check: { status: "fail", shown: false } }));
  assert.deepEqual(p.scenarios[2], { id: "managed", label: "Managed exit (the system's live rules)", shown: false, note: "Shown once the replay matches the live account." });
  assert.deepEqual(publicTrackRecord(hiddenRecord()).scenarios[2].shown, false);
  assert.equal(trackModel(await (await handle(req(), { PROJECTION: { trackRecord: async () => hiddenRecord() } }, { cache: undefined })).json()).columns[2].shown, false);
});

test("TK5 the route without a record: 200 { available: false }, not cached, so the page degrades instead of failing", async () => {
  const noCache = { match: async () => null, put: async () => { throw new Error("must not cache"); } };
  const cases = [
    {},                                                                         // no binding
    { PROJECTION: {} },                                                         // an AI Worker before #499
    { PROJECTION: { trackRecord: async () => { throw new Error("down"); } } },  // a failure
    { PROJECTION: { trackRecord: async () => ({ version: "v1", status: "unavailable" }) } },
    { PROJECTION: { trackRecord: async () => record({ unit: "USD" }) } }
  ];
  for (const env of cases) {
    const r = await trackRecord(env, new Request("https://x/api/public/track-record"), noCache);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("cache-control"), "no-store");
    const body = await r.json();
    assert.equal(body.available, false);
    assert.equal(trackModel(body).available, false);
  }
});

test("TK6 the pages: Performance before Archive in the nav, aria-current on its own page, built like the home page, the copy through the guardian", () => {
  const home = read("public/index.html"), perf = read("public/performance.html");
  // The links inline (owner 2026-11-20: "jangan digabungkan semua"), Minutes not among them (it follows the hero); Performance before Archive.
  const nav = (html) => { const n = html.slice(html.indexOf('<nav class="nav" aria-label="Main">'), html.indexOf("</nav>", html.indexOf('aria-label="Main"'))); return [...n.matchAll(/<a [^>]*>([^<]+)</g)].map((m) => m[1]); };
  const groups = ["The cast", "How it works", "Performance", "Archive"];
  assert.deepEqual(nav(home), groups);
  assert.deepEqual(nav(perf), groups);
  assert.match(perf, /<a href="\/performance" aria-current="page">Performance<\/a>/);
  assert.doesNotMatch(home, /aria-current/);
  assert.match(perf, /<h1>Performance<\/h1>/);
  assert.equal((perf.match(/<table/g) ?? []).length, 1, "one table");
  for (const t of ["R", "Win rate", "Expectancy", "Net R", "Profit factor"]) assert.match(perf, new RegExp(`<dt>${t}</dt>`), t);
  assert.match(perf, /"Even" plans/);
  assert.match(perf, /cover different sets/, "the footnote: the columns count different plans");
  assert.match(perf, /<script type="module" src="\/performance\.js\?v=[0-9a-f]{12}"><\/script>/, "the build's hash in the URL (RM11 checks it is this build's)");
  assert.doesNotMatch(perf, /\sstyle=|<style|<script>(?!<\/script>)|<script(?![^>]*\ssrc=)[^>]*>/i, "no inline style or script (CSP)");
  assert.match(perf, /href="\/home\.css\?v=[0-9a-f]{12}"/); assert.doesNotMatch(perf, /cta\.css/);
  const b = JSON.parse(read("public/room/build.json"));
  assert.equal(b.performance, createHash("sha256").update(readFileSync(new URL("../public/performance.js", import.meta.url))).digest("hex"), "public/performance.js is built from site/performance");
  // Never the internal name; the readings' colours never on the numbers.
  for (const f of ["public/performance.html", "public/performance.js", "public/home.js", "site/home/track.js", "site/performance/performance.js"]) assert.doesNotMatch(read(f), /omega/i, f);
  const css = read("public/home.css");
  const numbers = css.slice(css.indexOf("/* the live gold price"), css.indexOf("/* ---------- the latest post")) + css.slice(css.indexOf("/* ---------- the Performance page"));
  assert.ok(numbers.includes(".dial-face b{") && numbers.includes(".track td b{"), "the dial's digits and the table's numbers are both checked");
  assert.doesNotMatch(numbers.replace(/\.tick\.(bear|bull)\{background:var\(--(bear|bull)\)\}/g, ""), /--bear|--bull|#F2606E|#3FD08A/i, "red and green only on the reading's tick (never on the dial or a number)");
  // The guardian over the new copy (the page's words, the table's and the home box's): no order wording, promise,
  // level, account data or internal name. "Exit at TP1" and "Exit at TP2" are the owner's approved column names.
  const words = (html) => html.replace(/<script[\s\S]*?<\/script>|<head>[\s\S]*?<\/head>/g, " ").replace(/<[^>]+>/g, " ").replace(/&minus;/g, "-").replace(/\s+/g, " ");
  const copy = [words(perf.slice(perf.indexOf("<main"), perf.indexOf("</main>"))), PENDING_NOTE, NOT_YET, "Average per plan, simulated",
    ...trackModel(record()).rows.flatMap((r) => [r.label, ...r.cells.map((c) => `${c.value} ${c.note}`)]), ...trackModel(record()).columns.map((c) => `${c.title} ${c.sub}`)].join("\n");
  const g = checkContentDraft({ text: copy.replace(/Exit at TP[12]/g, "Exit") });
  assert.deepEqual(g.failures.filter((f) => !["capacity", "disclaimer"].includes(f.check)), [], "a page is not a post: only the post-only capacity and disclaimer lines are not asked");
});

test("TK-N the header strip and the table use Nexus's colours (owner 2026-11-20)", async () => {
  const { toneR, toneWin, trackModel, averages } = await import("../site/home/track.js");
  assert.deepEqual([toneR(0.21), toneR(-0.4), toneR(0), toneR(null)], ["pos", "neg", "zero", ""]);
  assert.deepEqual([toneWin(0.5), toneWin(0.43)], ["pos", "wait"]);
  const rows = trackModel(record()).rows;
  assert.deepEqual(rows.map((r) => r.cells[0].tone), [toneWin(record().scenarios[0].win_rate), toneR(record().scenarios[0].expectancy_r), toneR(record().scenarios[0].net_r), "pf"]);
  assert.deepEqual(averages(record()).map((a) => [a.short, a.tone]), [["TP1", "pos"], ["TP2", "pos"], ["Managed exit", "pos"]]);
});

test("TK-S the strip sits in the header of both pages; the hero has no average box", async () => {
  const { readFileSync } = await import("node:fs");
  for (const f of ["public/index.html", "public/performance.html"]) {
    const html = readFileSync(f, "utf8");
    const header = html.slice(html.indexOf("<header"), html.indexOf("</header>"));
    assert.match(header, /id="avg-strip" href="\/performance" title="Simulated, the average of the exit scenarios" hidden/, f);
  }
  assert.doesNotMatch(readFileSync("public/index.html", "utf8"), /class="avg" id="avg"/);
});

test("TK-H the header's four codes: the mean over the scenarios shown, with Nexus tones", async () => {
  const { headline } = await import("../site/home/track.js");
  const body = { available: true, unit: "R", replay_check: { status: "insufficient", shown: false }, scenarios: [
    { id: "first", shown: true, count: 72, win_rate: 0.431, expectancy_r: 0.21, net_r: 14.92, profit_factor: 1.79 },
    { id: "second", shown: true, count: 62, win_rate: 0.242, expectancy_r: 0.32, net_r: 19.56, profit_factor: 2.4 },
    { id: "managed", shown: false, note: "x" }] };
  assert.deepEqual(headline(body).map((h) => [h.code, h.value, h.tone]), [["WR", "34%", "wait"], ["EXP", "+0.27R", "pos"], ["NETR", "+17.2R", "pos"], ["PF", "2.09", "pf"]]);
  assert.deepEqual(headline({ available: false }), []);
});
