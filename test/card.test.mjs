// The Instagram card (src/card.mjs) and its screenshot (src/render.mjs), with a fake browser.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { cardHtml, chartOf, panelLines, chartHeightFor, SCHEMATIC_NOTE } from "../src/card.mjs";
import { renderCard, toBase64, fromBase64, MIN_CARD_BYTES } from "../src/render.mjs";
import { BRANDS } from "../src/brands.mjs";
import { addDrafts, getDraft, decideDraft, attachImage, mediaOf, draftsNeedingImage } from "../src/desk.mjs";
import { analysisDrafts, ANALYSIS_DISCLAIMER } from "../src/analysis-drafts.mjs";
import { dailyDrafts } from "../src/drafts.mjs";
import { checkContentDraft } from "../src/guardian.mjs";

const brand = BRANDS["xauusd-ai-cta"];
const sqlite = () => {
  const db = new DatabaseSync(":memory:");
  return { exec(q, ...b) { const s = db.prepare(q); const out = /^\s*SELECT|\bRETURNING\b/i.test(q) ? s.all(...b) : (s.run(...b), []); return { toArray: () => out.map((r) => ({ ...r })) }; } };
};
const ANALYSIS = {
  at: "2026-11-17T06:09:00.000Z", price: 4087.35,
  zones: [{ role: "supply", low: 4120.5, high: 4128.2, strength: "strong", sources: 4 }, { role: "demand", low: 4060.1, high: 4066.8, strength: "strong", sources: 5 }],
  patterns: [{ chart: "H4", pattern: "ascending_triangle", name: "Ascending Triangle", chapter: 46, status: "forming", upper: 4098.2, lower: 4071.6 }],
  structure: { H1: { trend: "up" } }
};

test("the card page: the draft's own text without hashtags or template disclaimers, escaped; our schematic, no TradingView", () => {
  const draft = { id: "pattern:H4:ascending_triangle:forming:4098:4072:instagram", kind: "pattern", text: `Education · Pattern <b>x</b>\nUpper line 4098.20\n\nChart by Cryptophys.\n${ANALYSIS_DISCLAIMER}\n#XAUUSD #gold` };
  assert.equal(chartOf(draft), "H4");
  assert.equal(chartOf({ kind: "key_levels", id: "levels:2026-11-17:instagram" }), "H4");
  assert.equal(chartOf({ kind: "daily_recap", id: "daily:2026-11-16:instagram" }), "H1");
  assert.deepEqual(panelLines(draft.text, { disclaimers: [ANALYSIS_DISCLAIMER] }), ["Education · Pattern <b>x</b>", "Upper line 4098.20"]);
  assert.deepEqual(panelLines("T\nChart by TradingView.\nx"), ["T", "x"], "an older draft's credit line is dropped from the panel too");
  const html = cardHtml(draft, brand, { disclaimers: [ANALYSIS_DISCLAIMER], footerDisclaimer: brand.card_disclaimer });
  assert.match(html, /Education · Pattern &lt;b&gt;x&lt;\/b&gt;/);
  assert.doesNotMatch(html, /#XAUUSD/);
  assert.equal(brand.chart_attribution, "Chart by Cryptophys");
  assert.equal("chart_symbol" in brand, false, "no TradingView symbol any more");
  assert.match(html, /<b>Chart by Cryptophys<\/b>/);
  assert.match(html, /not financial advice/);
  assert.doesNotMatch(html, /tradingview|<iframe|<script[^>]*\ssrc=|https?:\/\/(?!www\.w3\.org)/i, "no widget, no frame, no outside script or host: the page needs no network");
  assert.doesNotMatch(html, /id="chart"/, "a draft without an overlay has no chart area");
  assert.deepEqual([chartHeightFor(5), chartHeightFor(9), chartHeightFor(14)], [700, 600, 520]);
  // With an overlay: the schematic, marked as one.
  const withOverlay = cardHtml({ ...draft, overlay: { price: 4087.35, zones: [{ role: "supply", low: 4120.5, high: 4128.2 }], pattern: { name: "Ascending Triangle", status: "forming", upper: 4098.2, lower: 4071.6 } } }, brand, { disclaimers: [ANALYSIS_DISCLAIMER] });
  assert.match(withOverlay, /<div class="chart" id="chart"><svg /);
  assert.ok(withOverlay.includes(SCHEMATIC_NOTE), "the schematic footnote");
  assert.equal(SCHEMATIC_NOTE, "Schematic: our levels to scale, not a price chart");
  assert.doesNotMatch(withOverlay, /tradingview|<iframe/i);
});

test("a text cannot break out of the card: the brand, the panel and the overlay's words are escaped", () => {
  const html = cardHtml({ id: "x", kind: "pattern", text: "Education\n</p><script>alert(1)</script>", overlay: { price: 3884.7, zones: [], pattern: { name: "</text><script>alert(2)</script>", status: "forming", upper: 3905.2, lower: 3871.6 } } }, { ...brand, chart_attribution: "</b><script>alert(3)</script>" });
  assert.doesNotMatch(html, /<script>alert/);
  assert.equal((html.match(/<script>/g) ?? []).length, 1, "the page's own fit script only");
});

/** A Puppeteer-style fake: a page whose fit result and screenshot the test sets. */
function fakeBrowser({ fit = "ok", shot = (() => { const b = new Uint8Array(MIN_CARD_BYTES + 10); b[0] = 0xff; b[1] = 0xd8; return b; })() } = {}) {
  const calls = [];
  const browser = {
    closed: false,
    async newPage() {
      return {
        async setViewport(v) { calls.push(["viewport", v.width, v.height]); },
        async setContent(html, o) { calls.push(["content", html.length > 1000, o.waitUntil]); browser.html = html; },
        frames: () => { throw new Error("the card has no frame to look for"); },
        async evaluate() { return fit; },
        async screenshot(o) { calls.push(["shot", o.type, o.quality]); return shot; }
      };
    },
    async close() { browser.closed = true; }
  };
  return { browser, calls, launch: async () => browser };
}

test("the screenshot: the page, its fit, the JPEG; refuses an overflow, a blank or a non-JPEG card", async () => {
  const draft = { id: "levels:2026-11-17:instagram", kind: "key_levels", text: "Education · Key-level map\nZone 4060.10–4066.80" };
  const ok = fakeBrowser();
  const bytes = await renderCard(draft, brand, { launch: ok.launch });
  assert.equal(bytes[0], 0xff);
  assert.deepEqual(ok.calls, [["viewport", 1080, 1350], ["content", true, "load"], ["shot", "jpeg", 85]], "no wait for a chart: the schematic is in the page");
  assert.ok(ok.browser.closed);
  const notJpeg = new Uint8Array(MIN_CARD_BYTES + 10);
  for (const [opts, re] of [[{ fit: "overflow" }, /does not fit/], [{ fit: null }, /no fit result/], [{ shot: new Uint8Array([0xff, 0xd8, 1]) }, /too small/], [{ shot: notJpeg }, /not a JPEG/]]) {
    const f = fakeBrowser(opts);
    await assert.rejects(renderCard(draft, brand, { launch: f.launch }), re);
    assert.ok(f.browser.closed, "the browser is closed on failure too");
  }
  await assert.rejects(renderCard(draft, brand, {}), /no browser/);
  const round = fromBase64(toBase64(bytes));
  assert.deepEqual([...round], [...bytes]);
});

test("Instagram drafts carry the chart's credit, get a card, then pass the guardian with the image; other channels do not", () => {
  const sql = sqlite();
  const now = Date.parse("2026-11-17T06:09:30Z");
  const drafts = analysisDrafts(ANALYSIS, { now, channels: ["threads", "instagram"], levelsRun: true });
  const ig = drafts.filter((d) => d.channel === "instagram");
  assert.deepEqual(ig.map((d) => [d.kind, d.status]), [["key_levels", "needs_image"]], "the forming pattern is no longer drafted (owner 2026-11-25: \"Only confirmed\")");
  for (const d of ig) assert.match(d.text, /Chart by Cryptophys\./);
  for (const d of drafts) assert.doesNotMatch(d.text, /TradingView/);
  for (const d of drafts.filter((d) => d.channel === "threads")) assert.doesNotMatch(d.text, /Chart by/);
  const recap = dailyDrafts([{ bar_close: "2026-11-15T10:00:00.000Z", stance: "WAIT", bias: "NEUTRAL", session: "london" }], { now: Date.parse("2026-11-16T22:17:00Z"), channels: ["instagram"] }).drafts[0];
  assert.match(recap.text, /Chart by Cryptophys\./);
  addDrafts(sql, drafts, { now });
  assert.deepEqual(draftsNeedingImage(sql, { limit: 5 }).map((d) => d.channel), ["instagram"]);
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

// ---- The overlay (owner 2026-11-15: patterns, key levels and the projection on the chart; drawn on our schematic) ----
import { overlayOf } from "../src/analysis-drafts.mjs";
import { overlayPrices, overlaySvg, overlayLabels, geometryProblem, layoutLabels, schematicOverlay, schematicGeo, schematicSvg } from "../src/card.mjs";

const CONFIRMED = { chart: "H4", pattern: "descending_channel", name: "Descending Channel", chapter: 12, status: "confirmed", direction: "down", upper: 3905.2, lower: 3871.6, projection: 3820.4 };
/** A linear price scale over a 1000 x 670 pane (a higher price is higher on the chart). */
const geoFor = (prices, { from = 3790, to = 3940, h = 670 } = {}) => ({ pane: { x: 1, y: 1, w: 1000, h }, xLast: 700, ys: prices.map((p) => ((to - p) / (to - from)) * h), range: { from, to } });

test("the overlay data: the zones nearest the price and the pattern's own numbers, on every draft (a text channel may be switched to Image)", () => {
  const analysis = { ...ANALYSIS, price: 3884.7, zones: [
    { role: "supply", low: 3990, high: 3995 }, { role: "supply", low: 3915.5, high: 3921.2, strength: "strong" }, { role: "supply", low: 3898, high: 3902.4 },
    { role: "demand", low: 3861.1, high: 3866.8 }, { role: "demand", low: 3831, high: 3836.5 }, { role: "demand", low: 3700, high: 3705 }
  ], patterns: [CONFIRMED] };
  const o = overlayOf(analysis, { pattern: CONFIRMED });
  assert.deepEqual(o.zones.map((z) => z.low), [3898, 3915.5, 3861.1, 3831], "two supply above, two demand below, nearest first");
  assert.deepEqual(o.pattern, { name: "Descending Channel", chart: "H4", status: "confirmed", direction: "down", upper: 3905.2, lower: 3871.6, projection: 3820.4 });
  assert.equal(overlayOf(analysis, { pattern: { ...CONFIRMED, status: "forming" } }).pattern.projection, null, "a forming pattern has no projection");
  const drafts = analysisDrafts(analysis, { now: Date.parse("2026-11-17T06:09:30Z"), channels: ["threads", "instagram"], levelsRun: true });
  for (const d of drafts) assert.ok(d.overlay, `${d.id} overlay: the card can be drawn for any channel's format`);
  const sql = sqlite();
  addDrafts(sql, drafts, { now: Date.parse("2026-11-17T06:09:30Z") });
  assert.deepEqual(getDraft(sql, drafts.find((d) => d.channel === "instagram" && d.kind === "pattern").id).overlay.pattern.projection, 3820.4, "the desk keeps the overlay");
});

test("the overlay's words pass the guardian (levels allowed): zones as information, no signal word, no instruction", () => {
  const o = overlayOf({ price: 3884.7, zones: [{ role: "supply", low: 3898, high: 3902.4, metrics: ["4H Camarilla H4", "daily pivot"] }, { role: "demand", low: 3861.1, high: 3866.8 }, { role: "at_price", low: 3880, high: 3886 }] }, { pattern: CONFIRMED });
  const forming = overlayOf({ price: 3884.7, zones: [] }, { pattern: { ...CONFIRMED, status: "forming" } });
  const words = [...overlayLabels(o), ...overlayLabels(forming)].join("\n");
  assert.match(words, /Supply zone · sell area 3898\.00–3902\.40\n/);
  assert.doesNotMatch(words, /Camarilla|pivot/, "on the chart the zone only, no metric names (owner 2026-11-15)");
  assert.match(words, /Demand zone · buy area 3861\.10–3866\.80\n/);
  assert.match(words, /Measured projection 3820\.40/);
  assert.match(words, /Close above 3905\.20 confirms up/);
  const g = checkContentDraft({ text: `Education. Not financial advice. Chart by Cryptophys.\n${words}`, chart: true, allowLevels: true });
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

test("the schematic: our own linear scale over the overlay's numbers, every level inside it, marked as a schematic", () => {
  const o = overlayOf({ price: 3884.7, zones: [{ role: "supply", low: 3898, high: 3902.4 }, { role: "demand", low: 3861.1, high: 3866.8 }] }, { pattern: CONFIRMED });
  const prices = overlayPrices(o);
  const geo = schematicGeo(o, { width: 1080, height: 600 });
  assert.equal(geometryProblem(geo, prices), null);
  assert.deepEqual([geo.pane.w, geo.pane.h], [970, 600], "the right 110 px are the price axis");
  assert.ok(geo.range.from < Math.min(...prices) && geo.range.to > Math.max(...prices), "padded above and below");
  for (const [i, price] of prices.entries()) {
    const want = 600 - ((price - geo.range.from) / (geo.range.to - geo.range.from)) * 600;
    assert.ok(Math.abs(geo.ys[i] - want) < 1e-9, `${price} at its own pixel`);
  }
  assert.ok(Math.abs(geo.xLast - 970 * 0.72) < 1e-9, "a confirmed pattern with a projection leaves room for it");
  assert.ok(Math.abs(schematicGeo({ ...o, pattern: undefined }).xLast - 970 * 0.94) < 1e-9, "a key-level map: little room on the right");
  const svg = schematicSvg(o, { height: 600 });
  assert.ok(svg.includes(SCHEMATIC_NOTE) && svg.includes(`aria-label="${SCHEMATIC_NOTE}"`), "the footnote and the label say it is a schematic");
  for (const words of ["When read", ">3884.70<", "Measured projection 3820.40", "Supply zone · sell area 3898.00–3902.40"]) assert.ok(svg.includes(words), words);
  assert.doesNotMatch(svg, /<script|on\w+=|<image|href=/i, "no script, no outside image");
  assert.doesNotMatch(svg.replace(/<marker\b[\s\S]*?<\/marker>/g, ""), /<(path|polyline|polygon)\b/, "no price series: no candles, no line through prices (the arrowhead is the only path)");
});

test("the projection guard holds on the card: an insane or wrong-side projection is not drawn", () => {
  const base = { price: 3884.7, zones: [] };
  const draw = (pattern) => schematicSvg(schematicOverlay({ ...base, pattern }), { height: 600 });
  const good = { name: "Descending Channel", status: "confirmed", direction: "down", upper: 3905.2, lower: 3871.6, projection: 3820.4 };
  assert.equal(schematicOverlay({ ...base, pattern: good }).pattern.projection, 3820.4);
  assert.match(draw(good), /Measured projection 3820\.40/);
  for (const projection of [0, -5, 9999, 3880, Number.NaN]) {
    assert.equal(schematicOverlay({ ...base, pattern: { ...good, projection } }).pattern.projection, null, String(projection));
    const svg = draw({ ...good, projection });
    assert.doesNotMatch(svg, /Measured projection|marker-end/, `${projection}: no projection drawn`);
    assert.doesNotMatch(svg, /NaN|Infinity/);
  }
  assert.equal(schematicOverlay({ ...base, pattern: { ...good, status: "forming" } }).pattern.projection, null, "a forming pattern has none");
  assert.equal(schematicOverlay(null), null);
  // The card page passes the guard too.
  const html = cardHtml({ id: "pattern:H4:x:confirmed:1:2:instagram", kind: "pattern", text: "Education · Pattern breakout\nline", overlay: { ...base, pattern: { ...good, projection: 0 } } }, brand);
  assert.doesNotMatch(html, /Measured projection/);
});

test("the screenshot with an overlay: the schematic is in the page given to the browser", async () => {
  const o = overlayOf({ price: 3884.7, zones: [{ role: "demand", low: 3861.1, high: 3866.8 }] }, { pattern: CONFIRMED });
  const draft = { id: "pattern:H4:descending_channel:confirmed:3905:3872:instagram", kind: "pattern", text: "Education · Pattern breakout\nBreakout line 3871.60", overlay: o };
  const f = fakeBrowser();
  const bytes = await renderCard(draft, brand, { launch: f.launch });
  assert.equal(bytes[0], 0xff);
  assert.match(f.browser.html, /<div class="chart" id="chart"><svg [^>]*height="700"/);
  assert.match(f.browser.html, /Measured projection 3820\.40/);
  assert.ok(f.browser.html.includes(SCHEMATIC_NOTE));
});

test("the pattern's lines are drawn as fitted, from its start candle, and carried to the current candle", () => {
  const lines = { from: "2026-11-10T08:00:00.000Z", to: "2026-11-14T20:00:00.000Z", upper: [3990, 3905.2], lower: [3950, 3871.6] };
  const o = overlayOf({ price: 3884.7, zones: [] }, { pattern: { ...CONFIRMED, lines } });
  assert.deepEqual(o.pattern.lines, lines);
  assert.equal(overlayOf({ price: 1, zones: [] }, { pattern: { ...CONFIRMED, lines: { ...lines, from: lines.to } } }).pattern.lines, undefined, "a start after the end is refused");
  const prices = overlayPrices(o);
  assert.ok(prices.includes(3990) && prices.includes(3950), "the start prices are in the range");
  const geo = { ...geoFor(prices, { from: 3790, to: 4010 }), xLast: 700, xs: [300, 650] };
  const y = (p) => 1 + ((4010 - p) / 220) * 670;
  const svg = overlaySvg(o, geo);
  // The upper line starts at its start candle and price, and runs on past its last candle at the same slope.
  const m = /<line x1="301\.0" y1="([\d.]+)" x2="701\.0" y2="([\d.]+)"/.exec(svg);
  assert.ok(m, svg.slice(0, 400));
  assert.equal(Number(m[1]).toFixed(1), y(3990).toFixed(1));
  const slope = (y(3905.2) - y(3990)) / 350;
  assert.equal(Number(m[2]).toFixed(1), (y(3905.2) + slope * 50).toFixed(1));
  assert.match(svg, /<circle cx="301\.0"/, "the start is marked");
  // No anchors: the levels flat over the recent candles.
  const flat = overlaySvg(o, { ...geo, xs: [null, 650] });
  assert.doesNotMatch(flat, /<circle/);
  assert.match(flat, new RegExp(`y1="${y(3905.2).toFixed(1)}" x2="701\\.0" y2="${y(3905.2).toFixed(1)}"`));
  assert.match(geometryProblem({ ...geo, xs: [-5, 650] }, prices), /pattern point/);
});
