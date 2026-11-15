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
  const draft = { id: "pattern:H4:ascending_triangle:forming:4098:4072:instagram", kind: "pattern", text: `Edukasi · Pola <b>x</b>\nGaris atas 4098.20\n\nChart oleh TradingView.\n${ANALYSIS_DISCLAIMER}\n#XAUUSD #emas` };
  assert.equal(chartOf(draft), "H4");
  assert.equal(chartOf({ kind: "key_levels", id: "levels:2026-11-17:instagram" }), "H4");
  assert.equal(chartOf({ kind: "daily_recap", id: "daily:2026-11-16:instagram" }), "H1");
  assert.deepEqual(panelLines(draft.text, { disclaimers: [ANALYSIS_DISCLAIMER] }), ["Edukasi · Pola <b>x</b>", "Garis atas 4098.20"]);
  const html = cardHtml(draft, brand, { disclaimers: [ANALYSIS_DISCLAIMER], footerDisclaimer: brand.card_disclaimer });
  assert.match(html, /Edukasi · Pola &lt;b&gt;x&lt;\/b&gt;/);
  assert.doesNotMatch(html, /#XAUUSD/);
  assert.match(html, /Chart oleh TradingView/);
  assert.match(html, /bukan ajakan jual atau beli/);
  assert.match(html, /https:\/\/s3\.tradingview\.com\/external-embedding\/embed-widget-advanced-chart\.js/);
  const cfg = widgetConfig({ symbol: brand.chart_symbol, chart: "H4", height: 600 });
  assert.deepEqual([cfg.symbol, cfg.interval, cfg.allow_symbol_change, cfg.save_image, cfg.locale, cfg.height], ["OANDA:XAUUSD", "240", false, false, "en", 600]);
  // No drawing, study or data of ours goes to TradingView: the settings are display options only.
  assert.deepEqual(Object.keys(cfg).filter((k) => /stud|draw|data|price|level/i.test(k)), []);
  assert.deepEqual([chartHeightFor(5), chartHeightFor(9), chartHeightFor(14)], [700, 600, 520]);
});

test("a text cannot break out of the widget's settings script", () => {
  const html = cardHtml({ id: "x", kind: "pattern", text: "Edukasi" }, { ...brand, chart_symbol: "</script><script>alert(1)</script>" });
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
  const draft = { id: "levels:2026-11-17:instagram", kind: "key_levels", text: "Edukasi · Peta level kunci\nZona 4060.10–4066.80" };
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
  for (const d of ig) assert.match(d.text, /Chart oleh TradingView\./);
  for (const d of drafts.filter((d) => d.channel === "threads")) assert.doesNotMatch(d.text, /TradingView/);
  const recap = dailyDrafts([{ bar_close: "2026-11-15T10:00:00.000Z", stance: "WAIT", bias: "NEUTRAL", session: "london" }], { now: Date.parse("2026-11-16T22:17:00Z"), channels: ["instagram"] }).drafts[0];
  assert.match(recap.text, /Chart oleh TradingView\./);
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
  assert.deepEqual(checkContentDraft({ text: "Edukasi. Bukan ajakan jual atau beli.", chart: true }).failures.map((f) => f.check), ["attribution"]);
});

test("an approval keeps the guardian's levels rule for analysis drafts (regression: approving a key-level map blocked it)", () => {
  const sql = sqlite();
  const now = Date.parse("2026-11-17T06:09:30Z");
  const drafts = analysisDrafts(ANALYSIS, { now, channels: ["threads"], levelsRun: true });
  addDrafts(sql, drafts, { now });
  for (const d of drafts) assert.equal(decideDraft(sql, { id: d.id, decision: "approve", actor: "owner@example.com" }, { now }).status, "approved", d.kind);
  // A recap is still checked without levels: a price in it blocks it.
  addDrafts(sql, [{ id: "daily:x:threads", kind: "daily_recap", channel: "threads", text: "Edukasi · rekap. Bukan ajakan jual atau beli. Harga 4087.35", status: "pending" }], { now });
  assert.equal(decideDraft(sql, { id: "daily:x:threads", decision: "approve", actor: "owner@example.com" }, { now }).status, "blocked");
});
