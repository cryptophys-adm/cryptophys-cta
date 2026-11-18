// Create → War Room (owner 2026-11-18: "tambahkan create content war room dengan pilihan news, 15m, 1h, 4h, 1D";
// confirmed: "Real-time analysis"). A post from the latest reading of one War Room source, read through the AI
// Worker's PublicProjection.warroom({ source }):
//   - 15m, 1H, 4H, 1D: the room's bias (bullish, bearish or neutral), its reasons and the metrics it weighed, in plain
//     words, and how many analysts were heard;
//   - News: the 24-hour digest's reading of gold, its summary and the headlines with their effect on gold.
// Analysis only, in fixed English templates around the projection's own sentences: never the room's decision (BUY,
// SELL, WAIT), its confidence, a price or order wording (the projection drops them; the guardian checks the post again:
// no price level in this kind). Pure.
import { finish } from "./analysis-drafts.mjs";
import { clock12, dateId } from "./drafts.mjs";

export const WARROOM_SOURCES = Object.freeze([
  { ref: "news", label: "News (last 24 hours)" },
  { ref: "15m", label: "15m War Room" },
  { ref: "1h", label: "1H room" },
  { ref: "4h", label: "4H room" },
  { ref: "1d", label: "1D room" }
]);
export const DEFAULT_WARROOM_SOURCE = "news";
/** The chart of the card (and its video) per source. */
export const WARROOM_CHART = Object.freeze({ news: "H1", "15m": "M15", "1h": "H1", "4h": "H4", "1d": "D1" });
const ROOM_NAME = Object.freeze({ "15m": "15-minute", "1h": "1-hour", "4h": "4-hour", "1d": "daily" });
const BIAS_WORD = Object.freeze({ bullish: "Bullish", bearish: "Bearish", neutral: "Neutral" });

export const sourceOf = (ref) => (WARROOM_SOURCES.some((s) => s.ref === ref) ? ref : DEFAULT_WARROOM_SOURCE);
const when = (iso) => (iso && Number.isFinite(Date.parse(iso)) ? `${clock12(iso)} UTC, ${dateId(iso)}` : null);
const bullets = (list) => (Array.isArray(list) ? list : []).filter((x) => typeof x === "string" && x.trim()).map((x) => `• ${x.trim()}`);

/** Pure: a War Room post for one channel from a reading (PublicProjection.warroom), or null. */
export function warroomText(reading, { channel = "threads" } = {}) {
  if (!reading || reading.error || !reading.source) return null;
  if (reading.source === "news") return newsText(reading, channel);
  const bias = BIAS_WORD[reading.bias];
  if (!bias || !ROOM_NAME[reading.source]) return null;
  const lines = [
    `Education · XAUUSD ${reading.label ?? reading.source} War Room reading`,
    "",
    `Bias on the ${ROOM_NAME[reading.source]} chart: ${bias}${Number.isFinite(reading.analysts) && reading.analysts > 0 ? ` (${reading.analysts} analysts heard)` : ""}.`,
    ...(when(reading.at) ? [`Read at the ${clock12(reading.at)} UTC close.`] : []),
    ...(reading.reasons?.length ? ["", "Why:", ...bullets(reading.reasons)] : []),
    ...(reading.metrics?.length ? ["", `Watched: ${reading.metrics.join(", ")}.`] : [])
  ];
  return finish(lines, channel);
}

function newsText(reading, channel) {
  const bias = BIAS_WORD[reading.bias];
  if (!bias && !reading.items?.length) return null;
  const c = reading.counts;
  const tally = c && (c.bullish || c.bearish || c.neutral) ? ` (${c.bearish ?? 0} bearish, ${c.bullish ?? 0} bullish, ${c.neutral ?? 0} neutral headlines)` : "";
  const lines = [
    "Education · XAUUSD news in the last 24 hours",
    "",
    ...(bias ? [`The news reading for gold: ${bias}${tally}.`] : []),
    ...(reading.summary?.length ? [reading.summary.join(" ")] : []),
    ...(reading.items?.length ? ["", "Headlines:", ...reading.items.map((i) => `• ${i.title} (${i.bias})`)] : []),
    ...(reading.reasons?.length ? ["", "Why it matters:", ...bullets(reading.reasons)] : []),
    ...(when(reading.at) ? ["", `Read at ${when(reading.at)}.`] : [])
  ];
  return finish(lines, channel);
}
