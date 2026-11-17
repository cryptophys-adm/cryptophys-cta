// Real-time analysis drafts (owner 2026-11-14 for the Threads account xauusd-ai-cta: "fokus pada hasil analytics
// dan key level. Tidak boleh ada advices buy/sell, kecuali info buy/sell zone"; "Real-time, hanya analisa").
// From the AI Worker's public analysis (src/public-analysis.mjs) only, in fixed English templates (owner 2026-11-15:
// "Semua content in english"; no model writes public text):
//   - the key-level map, once a weekday at 06:09 UTC (13:09 WIB, before London): the demand zones ("buy area")
//     and supply zones ("sell area") as information, the price when read, the structure per chart;
//   - a pattern post when an H1, H4 or D1 pattern is confirmed (its breakout), or an H4 or D1 pattern is forming:
//     its name (no catalogue reference: owner 2026-11-15), its lines, what undoes it, the measured projection as analysis.
// Never the system's decision, an entry, a stop, a take profit or BUY/SELL as a signal: the content guardian's
// signal_words rule refuses them. Price levels are allowed here (allowLevels): they are the analysis itself.
// Each draft also carries its `overlay`: the numbers the Instagram card draws on TradingView's chart (src/card.mjs).
import { checkContentDraft } from "./guardian.mjs";
import { dateId, SHORT_DISCLAIMER, CHART_CREDIT } from "./drafts.mjs";
import { CHANNELS, TEXT_LIMITS, initialStatus } from "./channels.mjs";

export const ANALYSIS_DISCLAIMER = "Educational analysis by Cryptophys. Not an invitation to buy or sell, and not financial advice.";
export { HASHTAGS as ANALYSIS_HASHTAGS } from "./channels.mjs";
import { HASHTAGS as ANALYSIS_HASHTAGS } from "./channels.mjs";
/** At most this many pattern drafts a day per channel (the queue stays readable; each still needs approval). */
export const MAX_PATTERN_DRAFTS_PER_DAY = 4;
const TREND_ID = { up: "up", down: "down", range: "sideways" };
const STRENGTH_ID = { strong: "strong", moderate: "moderate", weak: "weak" };
const f2 = (x) => (Number.isFinite(Number(x)) ? Number(x).toFixed(2) : "?");
const hhmm = (iso) => String(iso).slice(11, 16);
/** "an H4", "a D1". */
const an = (chart) => `${/^[HM]/.test(String(chart)) ? "an" : "a"} ${chart}`;

function finish(lines, channel) {
  // X: the short disclaimer, so the analysis keeps its lines within 280 characters.
  // Instagram, YouTube, TikTok: the post is the card (or its video) with TradingView's chart, so the caption names it
  // (the guardian's attribution).
  const tail = ["", ...(["instagram", "youtube", "tiktok"].includes(channel) ? [CHART_CREDIT] : []), channel === "x" ? SHORT_DISCLAIMER : ANALYSIS_DISCLAIMER, ANALYSIS_HASHTAGS[channel] ?? ANALYSIS_HASHTAGS.threads];
  const max = TEXT_LIMITS[channel] ?? 500;
  // Too long: drop body lines from the end (never the title or the disclaimer).
  let body = [...lines];
  while (body.length > 1 && [...body, ...tail].join("\n").length > max) body.pop();
  // No blank line left over where a dropped line was.
  while (body.length > 1 && body.at(-1) === "") body.pop();
  const text = [...body, ...tail].join("\n");
  return text.length <= max ? text : null;
}

/**
 * How many of a zone's metric names each channel shows (owner 2026-11-15: "tidak perlu dicantumkan sumber playbook,
 * cukup nama metrics sumbernya"): the names, not a count; fewer where the text limit is short.
 */
export const METRICS_PER_ZONE = Object.freeze({ threads: 1, instagram: 3, x: 0, telegram: 3, youtube: 3, tiktok: 3 });
/** "• 3898.00–3902.40 (strong: 4H Camarilla H4, daily pivot)". */
export function zoneLine(z, { channel = "threads" } = {}) {
  const names = (Array.isArray(z.metrics) ? z.metrics : []).filter((n) => typeof n === "string" && n.trim()).slice(0, METRICS_PER_ZONE[channel] ?? 2);
  const strength = STRENGTH_ID[z.strength] ?? null;
  const meta = strength && names.length ? `${strength}: ${names.join(", ")}` : strength ?? names.join(", ");
  return `• ${f2(z.low)}–${f2(z.high)}${meta ? ` (${meta})` : ""}`;
}

/** Pure: the key-level map text for one channel, or null when there is no zone. */
export function keyLevelsText(analysis, { channel = "threads" } = {}) {
  const zones = analysis?.zones ?? [];
  const supply = zones.filter((z) => z.role === "supply").slice(-3);
  const demand = zones.filter((z) => z.role === "demand").slice(0, 3);
  if (!supply.length && !demand.length) return null;
  const lines = [`Education · XAUUSD key-level map · ${dateId(analysis.at)} ${hhmm(analysis.at)} UTC`];
  if (analysis.price != null) lines.push(`Price when read: ${f2(analysis.price)}`);
  const line = (z) => zoneLine(z, { channel });
  if (supply.length) lines.push("", "Supply zones (sell area):", ...supply.map(line));
  const at = zones.find((z) => z.role === "at_price");
  if (at) lines.push("", `Price is inside the zone ${f2(at.low)}–${f2(at.high)}.`);
  if (demand.length) lines.push("", "Demand zones (buy area):", ...demand.map(line));
  const st = Object.entries(analysis.structure ?? {}).filter(([, s]) => s.trend).map(([c, s]) => `${c} ${TREND_ID[s.trend] ?? s.trend}${s.label ? ` (${s.label})` : ""}`);
  if (st.length) lines.push("", `Structure: ${st.join(" · ")}`);
  return finish(lines, channel);
}

/** Pure: one pattern's text for one channel. */
export function patternText(p, analysis, { channel = "threads" } = {}) {
  const lines = [];
  if (p.status === "forming") {
    lines.push(`Education · Pattern forming · XAUUSD ${p.chart}`, `${p.name}`, "",
      `Upper line ${f2(p.upper)} · lower line ${f2(p.lower)}`,
      `The pattern confirms upward on ${an(p.chart)} close above ${f2(p.upper)}, or downward on a close below ${f2(p.lower)}.`);
  } else {
    const up = p.direction === "up";
    const line = up ? p.upper : p.lower, undo = up ? p.lower : p.upper;
    lines.push(`Education · Pattern breakout · XAUUSD ${p.chart}`, `${p.name} · direction ${up ? "up" : p.direction === "down" ? "down" : "unclear"}`, "",
      `Breakout line ${f2(line)}`,
      `The pattern fails if ${an(p.chart)} candle closes back ${up ? "below" : "above"} ${f2(undo)}.`);
    if (p.projection != null) lines.push(`Measured projection: ${f2(p.projection)} (analysis, not a trade objective).`);
  }
  if (analysis?.price != null) lines.push(`Price when read: ${f2(analysis.price)} · ${hhmm(analysis.at)} UTC`);
  return finish(lines, channel);
}

/** Which patterns are posted: confirmed on H1, H4, D1; forming on H4 and D1. */
export function postablePatterns(analysis) {
  return (analysis?.patterns ?? []).filter((p) => (p.status === "confirmed" && ["H1", "H4", "D1"].includes(p.chart)) || (p.status === "forming" && ["H4", "D1"].includes(p.chart)));
}
export const patternKey = (p) => `${p.chart}:${p.pattern}:${p.status}:${Math.round(p.upper)}:${Math.round(p.lower)}`;

function draft({ id, kind, channel, text, now, overlay = null }) {
  const guardian = checkContentDraft({ text, chart: false, decisionTimes: [], allowLevels: true, now });
  return { id, kind, channel, text, image_url: null, window: null, decision_times: [], guardian, overlay, status: !guardian.pass ? "blocked" : initialStatus(channel) };
}

const num = (x) => (Number.isFinite(Number(x)) ? Math.round(Number(x) * 100) / 100 : null);
const zoneOf = (z) => ({ role: z.role, low: num(z.low), high: num(z.high), strength: z.strength ?? null });
/**
 * Pure: what the Instagram card draws on TradingView's chart (src/card.mjs). The same numbers as the text, never
 * more: the price when read, the zones nearest to it (at most two supply above and two demand below, and the zone the
 * price is in), and for a pattern post its lines and measured projection. Only for channels with an image.
 */
export function overlayOf(analysis, { pattern = null, maxZones = 2 } = {}) {
  const price = num(analysis?.price);
  const zones = (analysis?.zones ?? []).filter((z) => num(z.low) != null && num(z.high) != null);
  const by = (role, sort) => zones.filter((z) => z.role === role).sort(sort).slice(0, maxZones).map(zoneOf);
  const out = {
    price,
    zones: [...by("supply", (a, b) => a.low - b.low), ...by("at_price", () => 0).slice(0, 1), ...by("demand", (a, b) => b.high - a.high)]
  };
  if (pattern) {
    out.pattern = { name: String(pattern.name ?? "").slice(0, 60), chart: pattern.chart, status: pattern.status, direction: pattern.direction ?? null,
      upper: num(pattern.upper), lower: num(pattern.lower), projection: pattern.status === "confirmed" ? num(pattern.projection) : null,
      ...(linesOf(pattern) ? { lines: linesOf(pattern) } : {}) };
  }
  return out;
}
/** Channels whose post is media made from the card (Instagram: the card; YouTube and TikTok: the video). */
export const hasImage = (channel) => initialStatus(channel) === "needs_image" || initialStatus(channel) === "needs_video";
/** A pattern's two lines as the xauusd analysis gives them ({ from, to, upper: [start, end], lower: [...] }), checked. */
function linesOf(p) {
  const l = p?.lines;
  const pair = (v) => Array.isArray(v) && v.length === 2 && v.every((x) => num(x) != null) ? v.map(num) : null;
  if (!l || !Number.isFinite(Date.parse(l.from)) || !Number.isFinite(Date.parse(l.to)) || Date.parse(l.from) >= Date.parse(l.to)) return null;
  const upper = pair(l.upper), lower = pair(l.lower);
  return upper && lower ? { from: new Date(Date.parse(l.from)).toISOString(), to: new Date(Date.parse(l.to)).toISOString(), upper, lower } : null;
}

/**
 * Pure: the drafts of one run. `postedToday` is how many pattern drafts each channel already has today;
 * `known` the pattern keys already drafted (so a pattern is posted once per status).
 */
export function analysisDrafts(analysis, { now = Date.now(), channels = CHANNELS, levelsRun = false, postedToday = {}, known = new Set() } = {}) {
  const day = new Date(now).toISOString().slice(0, 10);
  const out = [];
  for (const channel of channels.filter((c) => CHANNELS.includes(c))) {
    if (levelsRun) {
      const text = keyLevelsText(analysis, { channel });
      if (text) out.push(draft({ id: `levels:${day}:${channel}`, kind: "key_levels", channel, text, now, overlay: overlayOf(analysis, { maxZones: 3 }) }));
    }
    let room = MAX_PATTERN_DRAFTS_PER_DAY - (Number(postedToday[channel]) || 0);
    for (const p of postablePatterns(analysis)) {
      if (room <= 0) break;
      const id = `pattern:${patternKey(p)}:${channel}`;
      if (known.has(id)) continue;
      const text = patternText(p, analysis, { channel });
      if (!text) continue;
      out.push(draft({ id, kind: "pattern", channel, text, now, overlay: overlayOf(analysis, { pattern: p }) }));
      room -= 1;
    }
  }
  return out;
}
