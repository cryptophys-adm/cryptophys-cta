// The Instagram card (src/card.mjs) and its screenshot (src/render.mjs), with a fake browser.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { cardHtml, chartOf, panelLines, widgetConfig, chartHeightFor } from "../src/card.mjs";
import { renderCard, toBase64, fromBase64, MIN_CARD_BYTES } from "../src/render.mjs";
import { BRANDS } from "../src/brands.mjs";
import { addDrafts, getDraft, decideDraft, attachImage, mediaOf, draftsNeedingImage } from "../src/desk.mjs";
import { analysisDrafts, ANALYSIS_DISCLAIMER } from "../src/analysis-drafts.mjs";
import { dailyDrafts } from "../src/drafts.mjs";
import { checkContentDraft } from "../src/guardian.mjs";

const brand = BRANDS["xauusd-ai-cta"];
const sqlite = () => {
  const db = new DatabaseSync(":memory:");
  return { exec(q, ...b) { const s = db.prepare(q); const out = /^\s*SELECT/i.test(q) ? s.all(...b) : (s.run(...b), []); return { toArray: () => out.map((r) => ({ ...r })) }; } };
};
const ANALYSIS = {
  at: "2026-11-17T06:09:00.000Z", price: 4087.35,
  zones: [{ role: "supply", low: 4120.5, high: 4128.2, strength: "strong", sources: 4 }, { role: "demand", low: 4060.1, high: 4066.8, strength: "strong", sources: 5 }],
  patterns: [{ chart: "H4", pattern: "ascending_triangle", name: "Ascending Triangle", chapter: 46, status: "forming", upper: 4098.2, lower: 4071.6 }],
  structure: { H1: { trend: "up" } }
};

test("the card page: the draft's own text without hashtags or template disclaimers, escaped; TradingView's read-only widget", () => {
  const draft = { id: "pattern:H4:ascending_triangle:forming:4098:4072:instagram", kind: "pattern", text: `Education · Pattern <b>x</b>\nUpper line 4098.20\n\nChart by TradingView.\n${ANALYSIS_DISCLAIMER}\n#XAUUSD #gold` };
  assert.equal(chartOf(draft), "H4");
  assert.equal(chartOf({ kind: "key_levels", id: "levels:2026-11-17:instagram" }), "H4");
  assert.equal(chartOf({ kind: "daily_recap", id: "daily:2026-11-16:instagram" }), "H1");
  assert.deepEqual(panelLines(draft.text, { disclaimers: [ANALYSIS_DISCLAIMER] }), ["Education · Pattern <b>x</b>", "Upper line 4098.20"]);
  const html = cardHtml(draft, brand, { disclaimers: [ANALYSIS_DISCLAIMER], footerDisclaimer: brand.card_disclaimer });
  assert.match(html, /Education · Pattern &lt;b&gt;x&lt;\/b&gt;/);
  assert.doesNotMatch(html, /#XAUUSD/);
  assert.match(html, /Chart by TradingView/);
  assert.match(html, /not financial advice/);
  assert.match(html, /https:\/\/s3\.tradingview\.com\/external-embedding\/embed-widget-advanced-chart\.js/);
  const cfg = widgetConfig({ symbol: brand.chart_symbol, chart: "H4", height: 600 });
  assert.deepEqual([cfg.symbol, cfg.interval, cfg.allow_symbol_change, cfg.save_image, cfg.locale, cfg.height], ["OANDA:XAUUSD", "240", false, false, "en", 600]);
  // No drawing, study or data of ours goes to TradingView: the settings are display options only.
  assert.deepEqual(Object.keys(cfg).filter((k) => /stud|draw|data|price|level/i.test(k)), []);
  assert.deepEqual([chartHeightFor(5), chartHeightFor(9), chartHeightFor(14)], [700, 600, 520]);
});

test("a text cannot break out of the widget's settings script", () => {
  const html = cardHtml({ id: "x", kind: "pattern", text: "Education" }, { ...brand, chart_symbol: "</script><script>alert(1)</script>" });
  assert.doesNotMatch(html, /<\/script><script>alert/);
});

/** A Puppeteer-style fake: a page whose chart frame and fit result the test sets. */
function fakeBrowser({ frame = true, fit = "ok", shot = (() => { const b = new Uint8Array(MIN_CARD_BYTES + 10); b[0] = 0xff; b[1] = 0xd8; return b; })() } = {}) {
  const calls = [];
  const browser = {
    closed: false,
    async newPage() {
      return {
        async setViewport(v) { calls.push(["viewport", v.width, v.height]); },
        async setContent(html, o) { calls.push(["content", html.length > 1000, o.waitUntil]); },
        frames: () => (frame ? [{ url: () => "about:blank" }, { url: () => "https://www.tradingview-widget.com/embed-widget/advanced-chart/", waitForSelector: async (s) => calls.push(["wait", s]) }] : [{ url: () => "about:blank" }]),
        async evaluate() { return fit; },
        async screenshot(o) { calls.push(["shot", o.type, o.quality]); return shot; }
      };
    },
    async close() { browser.closed = true; }
  };
  return { browser, calls, launch: async () => browser };
}

test("the screenshot: waits for TradingView's canvas and the panel's fit; refuses a missing chart, an overflow or a blank card", async () => {
  const draft = { id: "levels:2026-11-17:instagram", kind: "key_levels", text: "Education · Key-level map\nZone 4060.10–4066.80" };
  const ok = fakeBrowser();
  const bytes = await renderCard(draft, brand, { launch: ok.launch, sleep: async () => {} });
  assert.equal(bytes[0], 0xff);
  assert.deepEqual(ok.calls, [["viewport", 1080, 1350], ["content", true, "networkidle0"], ["wait", "canvas"], ["shot", "jpeg", 85]]);
  assert.ok(ok.browser.closed);
  for (const [opts, re] of [[{ frame: false }, /chart did not load/], [{ fit: "overflow" }, /does not fit/], [{ shot: new Uint8Array([0xff, 0xd8, 1]) }, /too small/]]) {
    const f = fakeBrowser(opts);
    await assert.rejects(renderCard(draft, brand, { launch: f.launch, sleep: async () => {} }), re);
    assert.ok(f.browser.closed, "the browser is closed on failure too");
  }
  await assert.rejects(renderCard(draft, brand, {}), /no browser/);
  const round = fromBase64(toBase64(bytes));
  assert.deepEqual([...round], [...bytes]);
});

test("Instagram drafts name TradingView, get a card, then pass the guardian with the image; other channels do not", () => {
  const sql = sqlite();
  const now = Date.parse("2026-11-17T06:09:30Z");
  const drafts = analysisDrafts(ANALYSIS, { now, channels: ["threads", "instagram"], levelsRun: true });
  const ig = drafts.filter((d) => d.channel === "instagram");
  assert.deepEqual(ig.map((d) => d.status), ["needs_image", "needs_image"]);
  for (const d of ig) assert.match(d.text, /Chart by TradingView\./);
  for (const d of drafts.filter((d) => d.channel === "threads")) assert.doesNotMatch(d.text, /TradingView/);
  const recap = dailyDrafts([{ bar_close: "2026-11-15T10:00:00.000Z", stance: "WAIT", bias: "NEUTRAL", session: "london" }], { now: Date.parse("2026-11-16T22:17:00Z"), channels: ["instagram"] }).drafts[0];
  assert.match(recap.text, /Chart by TradingView\./);
  addDrafts(sql, drafts, { now });
  assert.deepEqual(draftsNeedingImage(sql, { limit: 5 }).map((d) => d.channel), ["instagram", "instagram"]);
  const levels = ig.find((d) => d.kind === "key_levels");
  const mediaId = "ab".repeat(16);
  assert.equal(attachImage(sql, { id: levels.id, mediaId: "nope", data: "x", imageUrl: `https://cta.cryptophys.work/media/${mediaId}.jpg` }).error, "bad media id");
  assert.equal(attachImage(sql, { id: levels.id, mediaId, data: "x", imageUrl: "http://evil/x.jpg" }).error, "bad image");
  const r = attachImage(sql, { id: levels.id, mediaId, data: "/9j/AAAA", bytes: 6, imageUrl: `https://cta.cryptophys.work/media/${mediaId}.jpg` }, { now });
  assert.equal(r.status, "pending", JSON.stringify(r.guardian));
  assert.equal(attachImage(sql, { id: levels.id, mediaId: "cd".repeat(16), data: "x", imageUrl: `https://cta.cryptophys.work/media/${"cd".repeat(16)}.jpg` }).error, "the draft is pending, not needs_image");
  assert.equal(mediaOf(sql, mediaId).draft_status, "pending");
  // The key-level map carries price levels: an approval checks it the way it was drafted (levels allowed).
  assert.equal(decideDraft(sql, { id: levels.id, decision: "approve", actor: "owner@example.com" }, { now }).status, "approved");
  assert.equal(getDraft(sql, levels.id).image_url, `https://cta.cryptophys.work/media/${mediaId}.jpg`);
  // Without the credit, an image draft fails the attribution check.
  assert.deepEqual(checkContentDraft({ text: "Education only. Not financial advice.", chart: true }).failures.map((f) => f.check), ["attribution"]);
});

test("an approval keeps the guardian's levels rule for analysis drafts (regression: approving a key-level map blocked it)", () => {
  const sql = sqlite();
  const now = Date.parse("2026-11-17T06:09:30Z");
  const drafts = analysisDrafts(ANALYSIS, { now, channels: ["threads"], levelsRun: true });
  addDrafts(sql, drafts, { now });
  for (const d of drafts) assert.equal(decideDraft(sql, { id: d.id, decision: "approve", actor: "owner@example.com" }, { now }).status, "approved", d.kind);
  // A recap is still checked without levels: a price in it blocks it.
  addDrafts(sql, [{ id: "daily:x:threads", kind: "daily_recap", channel: "threads", text: "Education · recap. Not financial advice. Price 4087.35", status: "pending" }], { now });
  assert.equal(decideDraft(sql, { id: "daily:x:threads", decision: "approve", actor: "owner@example.com" }, { now }).status, "blocked");
});

// ---- The overlay on TradingView's chart (owner 2026-11-15: patterns, key levels and the projection on the chart) ----
import { overlayOf } from "../src/analysis-drafts.mjs";
import { overlayPrices, overlaySvg, overlayLabels, geometryProblem, layoutLabels, measureInChart } from "../src/card.mjs";

const CONFIRMED = { chart: "H4", pattern: "descending_channel", name: "Descending Channel", chapter: 12, status: "confirmed", direction: "down", upper: 3905.2, lower: 3871.6, projection: 3820.4 };
/** A linear price scale over a 1000 x 670 pane, like TradingView's (a higher price is higher on the chart). */
const geoFor = (prices, { from = 3790, to = 3940, h = 670 } = {}) => ({ pane: { x: 1, y: 1, w: 1000, h }, xLast: 700, ys: prices.map((p) => ((to - p) / (to - from)) * h), range: { from, to } });

test("the overlay data: the zones nearest the price and the pattern's own numbers, only on image channels", () => {
  const analysis = { ...ANALYSIS, price: 3884.7, zones: [
    { role: "supply", low: 3990, high: 3995 }, { role: "supply", low: 3915.5, high: 3921.2, strength: "strong" }, { role: "supply", low: 3898, high: 3902.4 },
    { role: "demand", low: 3861.1, high: 3866.8 }, { role: "demand", low: 3831, high: 3836.5 }, { role: "demand", low: 3700, high: 3705 }
  ], patterns: [CONFIRMED] };
  const o = overlayOf(analysis, { pattern: CONFIRMED });
  assert.deepEqual(o.zones.map((z) => z.low), [3898, 3915.5, 3861.1, 3831], "two supply above, two demand below, nearest first");
  assert.deepEqual(o.pattern, { name: "Descending Channel", chart: "H4", status: "confirmed", direction: "down", upper: 3905.2, lower: 3871.6, projection: 3820.4 });
  assert.equal(overlayOf(analysis, { pattern: { ...CONFIRMED, status: "forming" } }).pattern.projection, null, "a forming pattern has no projection");
  const drafts = analysisDrafts(analysis, { now: Date.parse("2026-11-17T06:09:30Z"), channels: ["threads", "instagram"], levelsRun: true });
  for (const d of drafts) assert.equal(Boolean(d.overlay), d.channel === "instagram", `${d.id} overlay`);
  const sql = sqlite();
  addDrafts(sql, drafts, { now: Date.parse("2026-11-17T06:09:30Z") });
  assert.deepEqual(getDraft(sql, drafts.find((d) => d.channel === "instagram" && d.kind === "pattern").id).overlay.pattern.projection, 3820.4, "the desk keeps the overlay");
});

test("the overlay's words pass the guardian (levels allowed): zones as information, no signal word, no instruction", () => {
  const o = overlayOf({ price: 3884.7, zones: [{ role: "supply", low: 3898, high: 3902.4 }, { role: "demand", low: 3861.1, high: 3866.8 }, { role: "at_price", low: 3880, high: 3886 }] }, { pattern: CONFIRMED });
  const forming = overlayOf({ price: 3884.7, zones: [] }, { pattern: { ...CONFIRMED, status: "forming" } });
  const words = [...overlayLabels(o), ...overlayLabels(forming)].join("\n");
  assert.match(words, /Supply zone · sell area 3898\.00–3902\.40/);
  assert.match(words, /Measured projection 3820\.40/);
  assert.match(words, /Close above 3905\.20 confirms up/);
  const g = checkContentDraft({ text: `Education. Not financial advice. Chart by TradingView.\n${words}`, chart: true, allowLevels: true });
  assert.ok(g.pass, JSON.stringify(g.failures));
});

test("the overlay's SVG: every zone and line at the chart's own pixel for its price, the projection arrow into the future area, labels apart", () => {
  const o = overlayOf({ price: 3884.7, zones: [{ role: "supply", low: 3898, high: 3902.4 }, { role: "supply", low: 3915.5, high: 3921.2 }, { role: "demand", low: 3861.1, high: 3866.8 }] }, { pattern: CONFIRMED });
  const prices = overlayPrices(o);
  const geo = geoFor(prices);
  assert.equal(geometryProblem(geo, prices), null);
  const svg = overlaySvg(o, geo, { frame: { x: 0, y: 0 } });
  const y = (p) => (1 + ((3940 - p) / 150) * 670).toFixed(1);
  assert.ok(svg.includes(`y="${y(3902.4)}"`), "the supply zone's top is at 3902.40's pixel");
  assert.ok(svg.includes(`y1="${y(3905.2)}"`), "the upper line is at 3905.20's pixel");
  assert.ok(svg.includes(`x1="701.0" y1="${y(3871.6)}"`), "the projection starts at the last bar on the breakout line");
  assert.ok(svg.includes(`y2="${y(3820.4)}"`), "and ends at the projection's pixel");
  assert.match(svg, /marker-end="url\(#arrow\)"/);
  assert.match(svg, /Projection area/);
  assert.doesNotMatch(svg, /<script|on\w+=/i, "no script in the overlay");
  // Labels: none overlap.
  const boxes = [...svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="(\d+)" height="(\d+)" rx="6"/g)].map((m) => m.slice(1).map(Number));
  for (let i = 0; i < boxes.length; i += 1) for (let j = i + 1; j < boxes.length; j += 1) {
    const [ax, ay, aw, ah] = boxes[i], [bx, by, bw, bh] = boxes[j];
    assert.ok(!(ax < bx + bw && bx < ax + aw && ay < by + bh && by < ay + ah), `labels ${i} and ${j} overlap`);
  }
  // Text in the overlay is escaped.
  assert.doesNotMatch(overlaySvg({ ...o, pattern: { ...o.pattern, name: "<img onerror=x>" } }, geo), /<img/);
});

test("a geometry that would misplace the overlay is refused (the card is then not stored)", () => {
  const prices = [3900, 3850];
  assert.match(geometryProblem({ error: "no chart model" }, prices), /no chart model/);
  assert.match(geometryProblem({ ...geoFor(prices), ys: [100, 50] }, prices), /not monotonic/);
  assert.match(geometryProblem({ ...geoFor(prices), ys: [-5, 50] }, prices), /off the chart/);
  assert.match(geometryProblem({ ...geoFor(prices), xLast: 2000 }, prices), /last bar/);
  assert.equal(layoutLabels([], { top: 0, bottom: 100 }).length, 0);
});

test("the in-chart measurement: widens the view, sets the price range over the levels and recent candles, reads the mapping", () => {
  const calls = [];
  const bars = Array.from({ length: 100 }, (_, i) => [i, 0, 3880 + (i % 5), 3870 - (i % 3), 3875]);
  const ps = { setMode: (m) => calls.push(["mode", m.autoScale]), setPriceRangeInPrice: (r) => { calls.push(["range", Math.round(r.from), Math.round(r.to)]); ps.r = r; }, priceToCoordinate: (p) => ((ps.r.to - p) / (ps.r.to - ps.r.from)) * 670 };
  const ts = { width: () => 1000, setBarSpacing: (s) => calls.push(["spacing", Math.round(s)]), setRightOffset: (n) => calls.push(["offset", n]), indexToCoordinate: () => 700 };
  globalThis.window = { chartWidget: { model: () => ({ mainSeries: () => ({ priceScale: () => ps, bars: () => ({ lastIndex: () => 99, valueAt: (i) => bars[i] }), firstValue: () => 3875 }), timeScale: () => ts }), paneWidgets: () => [{ canvasElement: () => ({ getBoundingClientRect: () => ({ x: 1, y: 1, width: 1000, height: 670 }) }) }] } };
  try {
    const geo = measureInChart({ prices: [3905.2, 3820.4], futureShare: 0.3, bars: 70 });
    assert.deepEqual(calls.slice(0, 3), [["spacing", 10], ["offset", 30], ["mode", false]]);
    const [, from, to] = calls.find((c) => c[0] === "range");
    assert.ok(from < 3820.4 && to > 3905.2, "the range covers the levels");
    assert.equal(geometryProblem(geo, [3905.2, 3820.4]), null);
    delete globalThis.window.chartWidget;
    assert.deepEqual(measureInChart({ prices: [1], futureShare: 0.1 }), { error: "no chart model" });
  } finally { delete globalThis.window; }
});

test("the screenshot with an overlay: measured in TradingView's frame, drawn in the page; a bad geometry stores no card", async () => {
  const o = overlayOf({ price: 3884.7, zones: [{ role: "demand", low: 3861.1, high: 3866.8 }] }, { pattern: CONFIRMED });
  const draft = { id: "pattern:H4:descending_channel:confirmed:3905:3872:instagram", kind: "pattern", text: "Education · Pattern breakout\nBreakout line 3871.60", overlay: o };
  const run = async (geo) => {
    const seen = { svg: null, measured: null };
    const jpeg = new Uint8Array(MIN_CARD_BYTES + 1); jpeg[0] = 0xff; jpeg[1] = 0xd8;
    const browser = { async newPage() { return {
      async setViewport() {}, async setContent() {},
      frames: () => [{ url: () => "https://www.tradingview-widget.com/embed-widget/advanced-chart/", waitForSelector: async () => {}, evaluate: async (fn, arg) => { seen.measured = { fn: fn.name, arg }; return geo(arg.prices); } }],
      evaluate: async (fn, arg) => { if (arg !== undefined) { seen.svg = arg; return null; } return /iframe/.test(String(fn)) ? { x: 0, y: 0 } : "ok"; },
      async screenshot() { return jpeg; }
    }; }, async close() {} };
    const bytes = await renderCard(draft, brand, { launch: async () => browser, sleep: async () => {} });
    return { bytes, seen };
  };
  const { bytes, seen } = await run((prices) => geoFor(prices));
  assert.equal(bytes[0], 0xff);
  assert.equal(seen.measured.fn, "measureInChart");
  assert.deepEqual([seen.measured.arg.futureShare, seen.measured.arg.bars], [0.3, 70]);
  assert.deepEqual(seen.measured.arg.prices, overlayPrices(o));
  assert.match(seen.svg, /Measured projection 3820\.40/);
  await assert.rejects(run((prices) => ({ ...geoFor(prices), ys: prices.map(() => 10) })), /overlay cannot be placed/);
  await assert.rejects(run(() => ({ error: "no chart model" })), /overlay cannot be placed \(no chart model\)/);
});
