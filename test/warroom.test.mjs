// Create → War Room (owner 2026-11-18: sources news, 15m, 1h, 4h, 1D; confirmed: "Real-time analysis"): the latest
// reading as analysis, every channel's text passing the guardian; never a decision, a confidence or a price.
import test from "node:test";
import assert from "node:assert/strict";
import { warroomText, WARROOM_SOURCES, sourceOf } from "../src/warroom-drafts.mjs";
import { templateTexts, checkPost, overlayFor, COMPOSE_KINDS } from "../src/compose.mjs";
import { chartOf } from "../src/card.mjs";

const ROOM = { version: "cryptophys.public-warroom.v1", source: "1h", label: "1H", at: "2026-11-18T17:00:00.000Z", bias: "bearish", analysts: 10,
  reasons: ["Rounding-top breakout and double-top formation signal a structural downside move.", "US dollar strength and gold ETF outflows add macro pressure to the downside.", "Footprint matrix order flow shows sellers in control."],
  metrics: ["rounding top breakout", "US dollar strength", "footprint matrix order flow"] };
const NEWS = { version: "cryptophys.public-warroom.v1", source: "news", label: "News", at: "2026-11-18T17:00:00.000Z", bias: "bearish",
  summary: ["A firm dollar and ETF outflows weigh on gold."], reasons: ["Fed speakers stay hawkish."], counts: { bullish: 3, bearish: 9, neutral: 5 },
  items: [{ title: "Dollar firms as Fed speakers stay hawkish", bias: "bearish" }, { title: "Central banks keep adding gold", bias: "bullish" }] };
const CHANNELS = ["threads", "x", "telegram", "instagram", "youtube", "tiktok"];

test("WR1 the sources and the room post: bias, reasons, metrics; every channel passes the guardian", () => {
  assert.deepEqual(WARROOM_SOURCES.map((s) => s.ref), ["news", "15m", "1h", "4h", "1d"]);
  assert.equal(sourceOf("5m"), "news");
  assert.ok(COMPOSE_KINDS.includes("warroom"));
  const t = warroomText(ROOM, { channel: "threads" });
  assert.match(t, /^Education · XAUUSD 1H War Room reading\n\nBias on the 1-hour chart: Bearish \(10 analysts heard\)\.\nRead at the 5:00 PM UTC close\./);
  assert.match(t, /Why:\n• Rounding-top/);
  assert.match(t, /Not an invitation to buy or sell, and not financial advice\./);
  for (const c of CHANNELS) {
    const text = warroomText(ROOM, { channel: c });
    assert.ok(text, c);
    const r = checkPost({ channel: c, kind: "warroom", text });
    assert.equal(r.guardian.pass, true, `${c}: ${JSON.stringify(r.guardian.failures)}`);
  }
  assert.equal(warroomText({ ...ROOM, bias: null }), null);
  assert.equal(warroomText({ error: "no reading" }), null);
});

test("WR2 the news post: the reading, the tally, the headlines with their effect on gold; every channel passes", () => {
  const t = warroomText(NEWS, { channel: "telegram" });
  assert.match(t, /^Education · XAUUSD news in the last 24 hours\n\nThe news reading for gold: Bearish \(9 bearish, 3 bullish, 5 neutral headlines\)\./);
  assert.match(t, /Headlines:\n• Dollar firms as Fed speakers stay hawkish \(bearish\)\n• Central banks keep adding gold \(bullish\)/);
  for (const c of CHANNELS) assert.equal(checkPost({ channel: c, kind: "warroom", text: warroomText(NEWS, { channel: c }) }).guardian.pass, true, c);
  // X keeps to 280 characters by dropping body lines from the end.
  assert.ok(warroomText(NEWS, { channel: "x" }).length <= 280);
});

test("WR3 the template, the card's chart, and the guardian on an edited post: no price, no signal in this kind", () => {
  const out = templateTexts("warroom", { channels: ["threads", "x"], settings: {}, warroom: ROOM, ref: "1h" });
  assert.deepEqual([out.ref, out.options.length, out.at], ["1h", 5, ROOM.at]);
  assert.ok(out.texts.threads && out.texts.x);
  const none = templateTexts("warroom", { channels: ["threads"], settings: {}, warroom: { error: "no reading of this room yet" }, ref: "1d" });
  assert.deepEqual([none.texts.threads, none.note], [null, "No reading from this source right now (no reading of this room yet)."]);
  assert.deepEqual(overlayFor("warroom", null, "15m"), { chart: "M15" });
  assert.equal(chartOf({ kind: "warroom", overlay: overlayFor("warroom", null, "4h") }), "H4");
  assert.equal(chartOf({ kind: "warroom", overlay: overlayFor("warroom", null, "news") }), "H1");
  const text = warroomText(ROOM, { channel: "threads" });
  const edited = checkPost({ channel: "threads", kind: "warroom", text: text.replace("Bias on", "SELL at 3741.80. Bias on") });
  assert.deepEqual(edited.guardian.failures.map((f) => f.check).sort(), ["instruction", "price_level", "signal_words"]);
});
