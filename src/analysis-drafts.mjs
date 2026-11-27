// Real-time analysis drafts (owner 2026-11-14 for the Threads account xauusd-ai-cta: "fokus pada hasil analytics
// dan key level. Tidak boleh ada advices buy/sell, kecuali info buy/sell zone"; "Real-time, hanya analisa").
// From the AI Worker's public analysis (src/public-analysis.mjs) only, in fixed English templates (owner 2026-11-15:
// "Semua content in english"; no model writes public text):
//   - the key-level map per chart at each H1, H4 and D1 close, merged when they close together (chartMapText below, from
//     xauusd KM1's zones_by_chart; owner 2026-11-25); before KM1, once a weekday at 06:09 UTC (13:09 WIB, before London): the demand zones ("buy area")
//     and supply zones ("sell area") as information, the price when read, the structure per chart;
//   - a pattern post when an M15, H1, H4 or D1 pattern is confirmed (its breakout; M15 since 2026-11-27, owner "tambah
//     content per 1h jika ada pattern 15m confirmed juga diposting", read at the hourly run, no daily cap); the scheduled
//     run drafts confirmed ones only
//     (owner 2026-11-25: "Only confirmed"), while Create still offers an H4 or D1 pattern forming to a person:
//     its name (no catalogue reference: owner 2026-11-15), its lines, what undoes it, the measured projection as analysis.
// Never the system's decision, an entry, a stop, a take profit or BUY/SELL as a signal: the content guardian's
// signal_words rule refuses them. Price levels are allowed here (allowLevels): they are the analysis itself.
// Each draft also carries its `overlay`: the numbers the Instagram card draws on TradingView's chart (src/card.mjs).
import { checkContentDraft, saneProjection, PROJECTION_MAX_SHARE } from "./guardian.mjs";
import { dateId, clock12, SHORT_DISCLAIMER, CHART_CREDIT } from "./drafts.mjs";
import { CHANNELS, TEXT_LIMITS, initialStatus } from "./channels.mjs";

export const ANALYSIS_DISCLAIMER = "Educational analysis by Cryptophys. Not an invitation to buy or sell, and not financial advice.";
export { HASHTAGS as ANALYSIS_HASHTAGS } from "./channels.mjs";
import { HASHTAGS as ANALYSIS_HASHTAGS } from "./channels.mjs";
/** At most this many pattern drafts a day per channel (the queue stays readable; each still needs approval). */
export const MAX_PATTERN_DRAFTS_PER_DAY = 4;
const TREND_ID = { up: "up", down: "down", range: "sideways" };
const STRENGTH_ID = { strong: "strong", moderate: "moderate", medium: "medium", weak: "weak" };
const f2 = (x) => (Number.isFinite(Number(x)) ? Number(x).toFixed(2) : "?");
/**
 * A zone's price range as posts show it: "low–high", or one price when both round to the same two decimals (owner
 * 2026-11-25: "1. Yes" to showing a zero-width zone as a single price; rendering only, the data is xauusd's).
 */
export const zoneRange = (low, high) => (f2(low) === f2(high) ? f2(low) : `${f2(low)}–${f2(high)}`);
/** "an H4", "a D1". */
const an = (chart) => `${/^[HM]/.test(String(chart)) ? "an" : "a"} ${chart}`;

export function finish(lines, channel) {
  // X: the short disclaimer, so the analysis keeps its lines within 280 characters.
  // Instagram, YouTube, TikTok: the post is the card (or its video) with TradingView's chart, so the caption names it
  // (the guardian's attribution).
  const tail = ["", ...(["instagram", "youtube", "tiktok"].includes(channel) ? [CHART_CREDIT] : []), channel === "x" ? SHORT_DISCLAIMER : ANALYSIS_DISCLAIMER, ...[ANALYSIS_HASHTAGS[channel] ?? ""].filter(Boolean)];
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
  return `• ${zoneRange(z.low, z.high)}${meta ? ` (${meta})` : ""}`;
}

/** Pure: the key-level map text for one channel, or null when there is no zone. */
export function keyLevelsText(analysis, { channel = "threads" } = {}) {
  const zones = analysis?.zones ?? [];
  const supply = zones.filter((z) => z.role === "supply").slice(-3);
  const demand = zones.filter((z) => z.role === "demand").slice(0, 3);
  if (!supply.length && !demand.length) return null;
  const lines = [`Education · XAUUSD key-level map · ${dateId(analysis.at)} ${clock12(analysis.at)} UTC`];
  if (analysis.price != null) lines.push(`Price when read: ${f2(analysis.price)}`);
  const line = (z) => zoneLine(z, { channel });
  if (supply.length) lines.push("", "Supply zones (sell area):", ...supply.map(line));
  const at = zones.find((z) => z.role === "at_price");
  if (at) lines.push("", `Price is inside the zone ${zoneRange(at.low, at.high)}.`);
  if (demand.length) lines.push("", "Demand zones (buy area):", ...demand.map(line));
  const st = Object.entries(analysis.structure ?? {}).filter(([, s]) => s.trend).map(([c, s]) => `${c} ${TREND_ID[s.trend] ?? s.trend}${s.label ? ` (${s.label})` : ""}`);
  if (st.length) lines.push("", `Structure: ${st.join(" · ")}`);
  return finish(lines, channel);
}

// ---- Key-level maps per chart (owner 2026-11-25: "pull keymap dari xauusd per 1h dan 4h dan 1D"; "Jika waktunya sama
// berarti digabung"). From PublicProjection.analysis().zones_by_chart and .closed (xauusd KM1): each chart's map is
// posted once per new close of that chart, and the charts that closed at the same time share one post. A close older than
// MAP_FRESH_MINUTES is not posted (no catch-up after a pause). Without zones_by_chart the daily map of 06:09 UTC stays.
export const MAP_CHARTS = Object.freeze(["D1", "H4", "H1"]);
export const MAP_FRESH_MINUTES = 70;
// Always the full "YYYYMMDDTHHMMSSZ" (orchestrator review of #87: one width, so ids compare as times).
const compactIso = (iso) => { const t = Date.parse(String(iso)); return (Number.isFinite(t) ? new Date(t).toISOString() : String(iso)).replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z"); };
/** A chart map's draft id: "levels:H4+H1:20261125T0400Z:threads". */
export const chartMapId = (charts, closed, channel) => `levels:${charts.join("+")}:${compactIso(closed)}:${channel}`;
/**
 * The charts and close a chart map's id names, or null for another id: `closed` in the full six-digit form (an older
 * "T0900Z" reads as "T090000Z") and `at`, the close as milliseconds, for comparing.
 */
export function chartsOfId(id) {
  const m = /^levels:((?:D1|H4|H1)(?:\+(?:D1|H4|H1))*):(\d{8})T(\d{4}|\d{6})Z:/.exec(String(id ?? ""));
  if (!m) return null;
  const hms = m[3].length === 4 ? `${m[3]}00` : m[3];
  const at = Date.UTC(+m[2].slice(0, 4), +m[2].slice(4, 6) - 1, +m[2].slice(6, 8), +hms.slice(0, 2), +hms.slice(2, 4), +hms.slice(4, 6));
  return { charts: m[1].split("+"), closed: `${m[2]}T${hms}Z`, at };
}
/**
 * The chart maps due now: for each chart with a fresh close not posted yet (`known`: the levels draft ids), grouped by
 * close, so charts that closed together go out as one post. Largest chart first within a post.
 */
export function dueChartMaps(analysis, { now = Date.now(), known = new Set() } = {}) {
  const byChart = analysis?.zones_by_chart, closed = analysis?.closed;
  if (!byChart || !closed) return [];
  const posted = new Set();
  for (const id of known) { const c = chartsOfId(id); if (c) for (const ch of c.charts) posted.add(`${ch}@${c.closed}`); }
  const groups = new Map();
  for (const chart of MAP_CHARTS) {
    const at = closed[chart], t = Date.parse(at ?? "");
    if (!Number.isFinite(t) || now - t > MAP_FRESH_MINUTES * 60_000 || t > now + 60_000) continue;
    if (posted.has(`${chart}@${compactIso(new Date(t).toISOString())}`)) continue;
    if (!(byChart[chart] ?? []).length) continue;
    const key = new Date(t).toISOString();
    groups.set(key, [...(groups.get(key) ?? []), chart]);
  }
  return [...groups.entries()].map(([closedAt, charts]) => ({ charts, closed: closedAt }));
}
/** One chart's zones for a map: the nearest above and below the price, candidates first, `perSide` of each. */
function mapZones(zones, price, perSide) {
  const list = (zones ?? []).filter((z) => Number.isFinite(Number(z.low)) && Number.isFinite(Number(z.high)));
  const rank = (a, b) => (b.candidate === true) - (a.candidate === true);
  const p = Number(price);
  const supply = list.filter((z) => z.role === "supply").sort((a, b) => rank(a, b) || (Number.isFinite(p) ? Math.abs(a.low - p) - Math.abs(b.low - p) : a.low - b.low)).slice(0, perSide);
  const demand = list.filter((z) => z.role === "demand").sort((a, b) => rank(a, b) || (Number.isFinite(p) ? Math.abs(a.high - p) - Math.abs(b.high - p) : b.high - a.high)).slice(0, perSide);
  return { supply: supply.sort((a, b) => b.low - a.low), demand: demand.sort((a, b) => b.high - a.high) };
}
/** Pure: a chart map's text (one chart, or the charts that closed together) for one channel, or null without a zone. */
export function chartMapText(analysis, { charts, closed }, { channel = "threads" } = {}) {
  const perSide = charts.length > 1 ? 1 : 2;
  const line = (z, side) => zoneLine(z, { channel }).replace(/^• /, `• ${side} `);
  const body = [];
  for (const chart of charts) {
    const { supply, demand } = mapZones(analysis?.zones_by_chart?.[chart], analysis?.price, perSide);
    if (!supply.length && !demand.length) continue;
    body.push("", `${chart}:`, ...supply.map((z) => line(z, "Supply (sell area)")), ...demand.map((z) => line(z, "Demand (buy area)")));
  }
  if (!body.length) return null;
  const lines = [`Education · XAUUSD key-level map · ${charts.join(" + ")} close · ${dateId(closed)} ${clock12(closed)} UTC`];
  if (analysis.price != null) lines.push(`Price when read: ${f2(analysis.price)}`);
  return finish([...lines, ...body], channel);
}

// saneProjection and PROJECTION_MAX_SHARE live in the guardian (src/guardian.mjs), so the drafter and the guardian's
// projection_not_sane check use one rule; re-exported here for the drafter's callers.
export { saneProjection, PROJECTION_MAX_SHARE };

/**
 * Pure: whether the price when read already reached a confirmed pattern's measured projection (owner 2026-11-27,
 * "setuju": up, the price at or above it; down, at or below it). Such a pattern is not posted (the move is done; the
 * run logs it as `projection_reached`), and the recap writes "measured projection reached" in place of the number.
 * Only a sane projection counts; one that is not sane is never shown anyway.
 */
export function projectionReached(p, price) {
  const x = saneProjection(p, price), pr = Number(price);
  if (x == null || p?.status !== "confirmed" || !Number.isFinite(pr)) return false;
  return p.direction === "up" ? pr >= x : p.direction === "down" ? pr <= x : false;
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
    const projection = saneProjection(p, analysis?.price);
    if (projection != null) lines.push(`Measured projection: ${f2(projection)} (analysis, not a trade objective).`);
  }
  if (analysis?.price != null) lines.push(`Price when read: ${f2(analysis.price)} · ${clock12(analysis.at)} UTC`);
  return finish(lines, channel);
}

/** The patterns the scheduled run drafts: confirmed only (owner 2026-11-25: "Only confirmed"). */
export const draftedPatterns = (analysis) => postablePatterns(analysis).filter((p) => p.status === "confirmed");
/** Which patterns may be posted (Create's choice too): confirmed on M15, H1, H4, D1; forming on H4 and D1. */
export function postablePatterns(analysis) {
  return (analysis?.patterns ?? []).filter((p) => (p.status === "confirmed" && ["M15", "H1", "H4", "D1"].includes(p.chart)) || (p.status === "forming" && ["H4", "D1"].includes(p.chart)));
}
/** The charts whose confirmed patterns have no daily cap (owner 2026-11-27: "Tanpa batas khusus"): each new one is posted. */
export const UNCAPPED_PATTERN_CHARTS = Object.freeze(["M15"]);
export const patternKey = (p) => `${p.chart}:${p.pattern}:${p.status}:${Math.round(p.upper)}:${Math.round(p.lower)}`;

/**
 * A confirmed pattern is posted once (owner 2026-11-25: "chart pattern kalau sudah dipost jangan dipost ulang, dia
 * ditrigger oleh xauusd ketika ada confirmed jadi tidak mengikuti tiap jam"). xauusd moves a fitted line's end every
 * bar, so the id's rounded upper and lower change while it is the same pattern (H1 rounding top 3690:3571 at 15:15 and
 * 3690:3575 at 17:09). Same pattern = the same chart, catalogue name, status and channel, with an overlapping band,
 * drafted within PATTERN_REPEAT_BARS bars of its chart (the longest xauusd follows a breakout).
 */
export const PATTERN_REPEAT_BARS = 120;
const CHART_HOURS = Object.freeze({ M15: 0.25, H1: 1, H4: 4, D1: 24 });
export const patternLookbackMs = (chart) => PATTERN_REPEAT_BARS * (CHART_HOURS[chart] ?? 24) * 3_600_000;
/** The longest lookback of any chart: how far back the scheduled run reads its pattern drafts. */
export const PATTERN_LOOKBACK_MS = Math.max(...Object.keys(CHART_HOURS).map(patternLookbackMs));
/**
 * A pattern is posted when it becomes confirmed, not again while it stays so (owner 2026-11-25: "dia ditrigger oleh
 * xauusd ketika ada confirmed jadi tidak mengikuti tiap jam"). A rising or falling wedge moves its whole band each bar,
 * so the band check alone missed it (H1 rising wedge on Threads at 06:09, 3618:3606, and 07:09, 3622:3620, on 26 Nov):
 * each run keeps the chart:pattern:status keys it saw (studio setting PATTERN_SEEN_KEY), and a pattern the previous
 * run already saw is not drafted again, whatever its band.
 */
export const PATTERN_SEEN_KEY = "analysis_patterns_seen";
export const patternSeenKey = (p) => `${p.chart}:${p.pattern}:${p.status}`;
/** Pure: the keys of the confirmed patterns this run read on `charts` (all when null): what the next run compares with. */
export const seenPatternKeys = (analysis, charts = null) => [...new Set(draftedPatterns(analysis).filter((p) => !charts || charts.includes(p.chart)).map(patternSeenKey))].sort();
/**
 Every chart's confirmed patterns are read by one pass with one seen set (PATTERN_SEEN_KEY): the hourly run's, or
 * the 5-minute pass's while it is switched on (owner 2026-11-27: "jika bisa ditrigger langsung ketika pattern 15m
 * confirmed tanpa menunggu jadwal 1H", then "berlaku juga untuk 1H/4H/1D"; `fastPassOn` in src/app.mjs).
 */
export const PATTERN_CHARTS = Object.freeze(["M15", "H1", "H4", "D1"]);
/**
 * No duplicate content (owner 2026-11-27: "pastikan tidak duplikasi content", then "berlaku juga untuk 1H/4H/1D"): a
 * pattern of the same chart, catalogue name and status is not posted again on a channel within 16 of its chart's bars
 * of its last draft (PATTERN_COOLDOWN_MS: 4 hours on M15, 16 on H1, 64 on H4, 16 days on D1), whatever its band (a
 * pattern that drops out of one reading and comes back, or slides its lines, is the same post).
 */
export const PATTERN_COOLDOWN_MS = Object.freeze({ M15: 16 * 900_000, H1: 16 * 3_600_000, H4: 16 * 4 * 3_600_000, D1: 16 * 24 * 3_600_000 });
/** Pure: whether `p` (a chart with a cooldown) was drafted for `channel`, under its name and status, within the cooldown. */
export function patternCooling(p, channel, history, now = Date.now()) {
  const ms = PATTERN_COOLDOWN_MS[p?.chart];
  if (!ms) return false;
  return (history ?? []).some((h) => {
    const o = patternOfId(h?.id);
    if (!o || o.channel !== channel || o.chart !== p.chart || o.pattern !== p.pattern || o.status !== p.status) return false;
    const at = Date.parse(h?.created_at);
    return !Number.isFinite(at) || at >= now - ms;
  });
}
/** Pure: a pattern draft id read back (pattern:<chart>:<pattern>:<status>:<upper>:<lower>:<channel>), or null. */
export function patternOfId(id) {
  const m = /^pattern:(M15|H1|H4|D1):([a-z0-9_]+):(forming|confirmed):(-?\d+):(-?\d+):([a-z0-9_]+)$/.exec(String(id ?? ""));
  return m ? { chart: m[1], pattern: m[2], status: m[3], upper: Number(m[4]), lower: Number(m[5]), channel: m[6] } : null;
}
/** Pure: whether `p` was already drafted for `channel`: `history` holds { id, created_at } of earlier pattern drafts. */
export function patternDrafted(p, channel, history, now = Date.now()) {
  const up = Math.round(Number(p?.upper)), low = Math.round(Number(p?.lower));
  const since = now - patternLookbackMs(p?.chart);
  return (history ?? []).some((h) => {
    const o = patternOfId(h?.id);
    if (!o || o.channel !== channel || o.chart !== p.chart || o.pattern !== p.pattern || o.status !== p.status) return false;
    const at = Date.parse(h?.created_at);
    if (Number.isFinite(at) && at < since) return false;
    return Math.max(Math.min(o.lower, o.upper), Math.min(low, up)) <= Math.min(Math.max(o.lower, o.upper), Math.max(low, up));
  });
}

/**
 * One pattern post per chart and breakout band (owner 2026-11-26: "Ya jangan ada duplikasi"; 27 Nov: H4
 * measured_move_up and diamond_bottom, two catalogue names on the same lines 3607.25 / 3552.14, went out on Threads in
 * the same minute). Two confirmed patterns of one chart share a band when their upper lines and their lower lines are
 * each within PATTERN_BAND_SHARE of the pattern's height (at least 1, the id's rounding); the first by catalogue order
 * (`chapter`) is posted, the others are not, in the same run and against the chart's drafts within its lookback.
 */
export const PATTERN_BAND_SHARE = 0.1;
/** Pure: whether two patterns (or a pattern and a draft id read back) sit on the same band of the same chart and status. */
export function sameBand(a, b) {
  if (!a || !b || a.chart !== b.chart || a.status !== b.status) return false;
  const au = Number(a.upper), al = Number(a.lower), bu = Number(b.upper), bl = Number(b.lower);
  if (![au, al, bu, bl].every(Number.isFinite)) return false;
  const tol = Math.max(1, PATTERN_BAND_SHARE * Math.max(Math.abs(au - al), Math.abs(bu - bl)));
  return Math.abs(au - bu) <= tol && Math.abs(al - bl) <= tol;
}
/** Pure: whether a pattern of any catalogue name on `p`'s band was already drafted for `channel` within the chart's lookback. */
export function bandDrafted(p, channel, history, now = Date.now()) {
  const since = now - patternLookbackMs(p?.chart);
  return (history ?? []).some((h) => {
    const o = patternOfId(h?.id);
    if (!o || o.channel !== channel || o.pattern === p?.pattern) return false;
    const at = Date.parse(h?.created_at);
    if (Number.isFinite(at) && at < since) return false;
    return sameBand(o, p);
  });
}
/** Catalogue order: a pattern's chapter, lowest first; a pattern without one after those with one, in its given order. */
const byCatalogue = (list) => list.map((p, i) => ({ p, i })).sort((a, b) => (Number(a.p.chapter) || Infinity) - (Number(b.p.chapter) || Infinity) || a.i - b.i).map((x) => x.p);

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
      upper: num(pattern.upper), lower: num(pattern.lower), projection: pattern.status === "confirmed" && saneProjection(pattern, price) != null ? num(saneProjection(pattern, price)) : null,
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
 * `known` the pattern keys already drafted, `history` the recent pattern drafts ({ id, created_at }), so a confirmed
 * pattern is posted once while xauusd keeps it, even as its lines move (patternDrafted).
 */
export function analysisDrafts(analysis, { now = Date.now(), channels = CHANNELS, levelsRun = false, postedToday = {}, known = new Set(), knownLevels = new Set(), history = [], seenBefore = new Set(), patternCharts = null, maps: withMaps = true, skipped = null } = {}) {
  const day = new Date(now).toISOString().slice(0, 10);
  const out = [];
  const perChart = Boolean(analysis?.zones_by_chart && analysis?.closed);
  const maps = perChart && withMaps ? dueChartMaps(analysis, { now, known: knownLevels }) : [];
  for (const channel of channels.filter((c) => CHANNELS.includes(c))) {
    for (const m of maps) {
      const text = chartMapText(analysis, m, { channel });
      const zones = m.charts.flatMap((c) => analysis.zones_by_chart[c] ?? []);
      if (text) out.push(draft({ id: chartMapId(m.charts, m.closed, channel), kind: "key_levels", channel, text, now, overlay: { ...overlayOf({ ...analysis, zones }, { maxZones: 3 }), chart: m.charts[0] } }));
    }
    if (levelsRun && withMaps && !perChart) {
      const text = keyLevelsText(analysis, { channel });
      if (text) out.push(draft({ id: `levels:${day}:${channel}`, kind: "key_levels", channel, text, now, overlay: overlayOf(analysis, { maxZones: 3 }) }));
    }
    let room = MAX_PATTERN_DRAFTS_PER_DAY - (Number(postedToday[channel]) || 0);
    const bands = [];
    for (const p of byCatalogue(draftedPatterns(analysis).filter((x) => !patternCharts || patternCharts.includes(x.chart)))) {
      const capped = !UNCAPPED_PATTERN_CHARTS.includes(p.chart);
      if (capped && room <= 0) continue;
      const id = `pattern:${patternKey(p)}:${channel}`;
      // one post per chart and band: a pattern earlier in the catalogue on the same lines takes it, this run or before
      if (bands.some((b) => sameBand(b, p))) continue;
      bands.push(p);
      if (known.has(id) || seenBefore.has(patternSeenKey(p)) || patternDrafted(p, channel, history, now) || bandDrafted(p, channel, history, now) || patternCooling(p, channel, history, now)) continue;
      // The move is done before the post would go out: not posted (owner 2026-11-27, "setuju"; 18:09 M15 wedge).
      if (projectionReached(p, analysis?.price)) { skipped?.push({ id, channel, reason: "projection_reached" }); continue; }
      const text = patternText(p, analysis, { channel });
      if (!text) continue;
      out.push(draft({ id, kind: "pattern", channel, text, now, overlay: overlayOf(analysis, { pattern: p }) }));
      if (capped) room -= 1;
    }
  }
  return out;
}

// ---- Live patterns (owner 2026-11-27): every chart read every 5 minutes, an invalidated pattern posted, an hourly recap ----
// "berlaku juga untuk 1H/4H/1D termasuk jika ada pattern invalidated tertrigger, dan setiap jam perlu recap pattern apa
// yang sedang aktif dengan target harganya dan pattern apa yang invalidated. karena recap jadi tidak perlu gambar."
// The two new kinds are text only, in the owner's approved words (the templates of 2026-11-27, "Setuju template"),
// on the text channels; they count as the Chart pattern kind for a channel's kinds and auto-approve ("Ya, auto-approve").

/** The text-only kinds of the pattern family: never a card, whatever the channel's format. */
export const PATTERN_INVALIDATED = "pattern_invalidated";
export const PATTERN_RECAP = "pattern_recap";
export const TEXT_ONLY_KINDS = Object.freeze([PATTERN_RECAP]);
/** The kind a channel's settings (kinds, auto-approve) read for a draft's kind. */
export const KIND_FAMILY = Object.freeze({ [PATTERN_INVALIDATED]: "pattern", [PATTERN_RECAP]: "pattern" });
export const kindFamily = (kind) => KIND_FAMILY[kind] ?? kind;
/** The hourly recap goes to these channels (owner 2026-11-27: "Threads + Telegram"). */
export const PATTERN_RECAP_CHANNELS = Object.freeze(["threads", "telegram"]);
/** The ledger of posted confirmed patterns (studio setting): what an invalidation is checked against. */
export const PATTERN_LEDGER_KEY = "pattern_ledger";
export const PATTERN_RECAP_KEY = "pattern_recap_last";
const CHART_ORDER = ["D1", "H4", "H1", "M15"];

/** Pure: what a confirmed pattern post said fails it: a candle closing back past the other line. */
export function failOf(p) {
  const up = p?.direction === "up";
  return { side: up ? "below" : "above", level: up ? Number(p?.lower) : Number(p?.upper), line: up ? Number(p?.upper) : Number(p?.lower) };
}
/** Pure: a ledger entry for a confirmed pattern as it was drafted (its lines, its fail level, its sane projection). */
export function ledgerEntry(p, analysis, now = Date.now()) {
  const f = failOf(p);
  return { key: `${p.chart}:${p.pattern}`, chart: p.chart, pattern: p.pattern, name: String(p.name ?? p.pattern).slice(0, 60), direction: p.direction,
    upper: num(p.upper), lower: num(p.lower), side: f.side, level: num(f.level), projection: saneProjection(p, analysis?.price), at: new Date(now).toISOString() };
}
/**
 * Pure: the ledger after this reading. A new confirmed draft adds its pattern (one entry per chart and name; a newer
 * one replaces an older); an entry leaves after its chart's lookback. An entry is invalidated, once, when the reading
 * shows its pattern busted, or confirmed the other way: a candle closed back past the line its post named (the
 * post's own words: "The pattern fails if … closes back below …"). Back inside its lines is not a failure; a pattern
 * no longer read (its projection reached, or old) is not one either.
 */
export function updateLedger(ledger, analysis, { drafted = [], now = Date.now() } = {}) {
  const items = new Map((Array.isArray(ledger) ? ledger : []).filter((e) => e?.key && Date.parse(e.at) >= now - patternLookbackMs(e.chart)).map((e) => [e.key, { ...e }]));
  for (const p of drafted) items.set(`${p.chart}:${p.pattern}`, ledgerEntry(p, analysis, now));
  const invalidated = [];
  for (const e of items.values()) {
    if (e.invalidated_at) continue;
    const p = (analysis?.patterns ?? []).find((x) => x.chart === e.chart && x.pattern === e.pattern);
    if (!p) continue;
    if (p.status === "busted" || (p.status === "confirmed" && p.direction && e.direction && p.direction !== e.direction)) {
      e.invalidated_at = new Date(now).toISOString();
      invalidated.push(e);
    }
  }
  return { ledger: [...items.values()], invalidated };
}

/** Pure: the post of an invalidated pattern, text only (owner's approved template of 2026-11-27). */
export function invalidatedText(e, analysis, { channel = "threads" } = {}) {
  const lines = [`Education · Pattern invalidated · XAUUSD ${e.chart}`, `${e.name} · direction ${e.direction === "up" ? "up" : e.direction === "down" ? "down" : "unclear"}`, "",
    `${an(e.chart).replace(/^a/, "A")} candle closed back ${e.side} ${f2(e.level)}: the breakout did not hold.`];
  if (e.projection != null) lines.push(`Its measured projection ${f2(e.projection)} no longer applies.`);
  if (analysis?.price != null) lines.push(`Price when read: ${f2(analysis.price)} · ${clock12(analysis.at)} UTC`);
  return finish(lines, channel);
}
export const invalidatedId = (e, channel) => `pinvalid:${e.chart}:${e.pattern}:${Math.round(e.upper)}:${Math.round(e.lower)}:${channel}`;

/**
 * Pure: the confirmed patterns active in a reading, largest chart first, then catalogue order; one per chart and band,
 * as the posts are (`sameBand`; 27 Nov 16:09, the first recap listed H4 Diamond Bottom and H4 Measured Move Up on the
 * same 3607.25 breakout).
 */
export function activePatterns(analysis) {
  const list = byCatalogue((analysis?.patterns ?? []).filter((p) => p.status === "confirmed" && CHART_ORDER.includes(p.chart)));
  const kept = [];
  for (const p of list) if (!kept.some((k) => sameBand(k, p))) kept.push(p);
  return kept.sort((a, b) => CHART_ORDER.indexOf(a.chart) - CHART_ORDER.indexOf(b.chart));
}
const activeLine = (p, price) => {
  const proj = saneProjection(p, price);
  const shown = proj == null ? "" : projectionReached(p, price) ? " · measured projection reached" : ` · measured projection ${f2(proj)}`;
  return `• ${p.chart} ${p.name} · ${p.direction === "up" ? "up" : p.direction === "down" ? "down" : "unclear"} · breakout ${f2(failOf(p).line)}${shown}`;
};
const invalidLine = (e) => `• ${e.chart} ${e.name} · closed back ${e.side} ${f2(e.level)}`;
/** Pure: what a recap says, for the "nothing changed" check: its charts, the active patterns' lines and the invalidated keys. */
export const recapSignature = (active, invalidated, charts = []) => JSON.stringify([charts, active.map((p) => `${p.chart}:${p.pattern}:${p.direction}:${Math.round(p.upper)}:${Math.round(p.lower)}`), invalidated.map((e) => `${e.key}@${e.invalidated_at}`)]);
const CHART_MS = Object.freeze({ M15: 900_000, H1: 3_600_000, H4: 4 * 3_600_000, D1: 24 * 3_600_000 });
/**
 * Pure: the recap at this reading's close (owner 2026-11-27: "Recap ubah per closing candle sesuai timeframe saja
 * kecuali pattern 15m, tetap mengikuti per 1H"; "1A": the charts that close together in one post, as the key-level
 * map): the H1 close, with M15, every hour; H4 and D1 joined at their own closes. Null when the H1 close is not fresh.
 */
export function recapClose(analysis, now = Date.now()) {
  const h1 = Date.parse(analysis?.closed?.H1 ?? "");
  if (!Number.isFinite(h1) || now - h1 > MAP_FRESH_MINUTES * 60_000 || h1 > now + 60_000) return null;
  const closing = MAP_CHARTS.filter((c) => Date.parse(analysis?.closed?.[c] ?? "") === h1);
  return { closeIso: new Date(h1).toISOString(), title: closing, charts: [...closing, "M15"] };
}
/**
 * Pure: the pattern recap at a close, text only (the owner's approved template of 2026-11-27, per close: "1A", and
 * "2A": the invalidated part always shown, "none" when empty): the close's charts' active confirmed patterns with
 * their measured projection, and those invalidated since the last close. Too long for the channel: the active list
 * loses its last lines (the smallest charts), then the invalidated list; never the title, the price, the closing line
 * or the disclaimer.
 */
export function patternRecapText({ active, invalidated, analysis, closeIso, title = ["H1"] }, { channel = "threads" } = {}) {
  const price = analysis?.price;
  let act = active.map((p) => activeLine(p, price)), inv = invalidated.map(invalidLine);
  const build = () => {
    const lines = [`Education · XAUUSD pattern recap · ${title.join(" + ")} close · ${clock12(closeIso)} UTC`];
    if (price != null) lines.push(`Price when read: ${f2(price)}`);
    if (act.length) lines.push("", "Active (confirmed):", ...act);
    lines.push("", ...(inv.length ? ["Invalidated since the last close:", ...inv] : ["Invalidated since the last close: none"]));
    lines.push("", "Patterns fail often; a measured projection is analysis, not a trade objective.");
    const tail = ["", channel === "x" ? SHORT_DISCLAIMER : ANALYSIS_DISCLAIMER, ...[ANALYSIS_HASHTAGS[channel] ?? ""].filter(Boolean)];
    return [...lines, ...tail].join("\n");
  };
  const max = TEXT_LIMITS[channel] ?? 500;
  let text = build();
  while (text.length > max && (act.length || inv.length)) { if (act.length) act = act.slice(0, -1); else inv = inv.slice(0, -1); text = build(); }
  return text.length <= max && (act.length || inv.length) ? text : null;
}
export const patternRecapId = (closeIso, channel) => `precap:${String(closeIso).slice(0, 13).replace(/[-:]/g, "")}:${channel}`;

/** Pure: the invalidation drafts for the channels where the pattern's confirmed post went out. */
export function invalidationDrafts(invalidated, analysis, { channels = [], now = Date.now() } = {}) {
  const out = [];
  for (const e of invalidated) for (const channel of channels) {
    const text = invalidatedText(e, analysis, { channel });
    // With its card (owner 2026-11-27: "dengan gambarnya dan hanya 1x posting termasuk jika terjadi invalidated"): the
    // pattern's lines as read now, no projection (it no longer applies).
    const p = (analysis?.patterns ?? []).find((x) => x.chart === e.chart && x.pattern === e.pattern) ?? e;
    // Only its own lines (orchestrator review of #115): no zone, no projection, no other level.
    const overlay = { ...overlayOf(analysis, { pattern: { ...p, name: e.name, chart: e.chart, status: "invalidated", direction: e.direction, projection: null } }), zones: [] };
    if (text) out.push(draft({ id: invalidatedId(e, channel), kind: PATTERN_INVALIDATED, channel, text, now, overlay }));
  }
  return out;
}
/**
 * Pure: the recap drafts at this reading's close, or none when there is no fresh H1 close, nothing to list (no active
 * pattern and none invalidated: "Lewati"), or the same as the last one. `ledger`: the ledger's entries; an entry of the
 * close's charts invalidated within its chart's last candle is listed.
 */
export function patternRecapDrafts(analysis, { ledger = [], lastSignature = null, channels = PATTERN_RECAP_CHANNELS, now = Date.now() } = {}) {
  const close = recapClose(analysis, now);
  if (!close) return { drafts: [], skipped: "no_close" };
  const end = Date.parse(close.closeIso);
  const active = activePatterns(analysis).filter((p) => close.charts.includes(p.chart));
  const invalidated = (ledger ?? []).filter((e) => close.charts.includes(e.chart) && e.invalidated_at && Date.parse(e.invalidated_at) > end - (CHART_MS[e.chart] ?? 3_600_000) && Date.parse(e.invalidated_at) <= now);
  const sig = recapSignature(active, invalidated, close.charts);
  if ((!active.length && !invalidated.length) || sig === lastSignature) return { drafts: [], signature: sig, skipped: !active.length && !invalidated.length ? "empty" : "unchanged" };
  const drafts = [];
  for (const channel of channels.filter((c) => PATTERN_RECAP_CHANNELS.includes(c))) {
    const text = patternRecapText({ active, invalidated, analysis, closeIso: close.closeIso, title: close.title }, { channel });
    if (text) drafts.push(draft({ id: patternRecapId(close.closeIso, channel), kind: PATTERN_RECAP, channel, text, now }));
  }
  return { drafts, signature: sig, charts: close.charts };
}

/**
 * Pure: whether a reading would make a pattern draft: a confirmed pattern of a pattern chart not in the seen set, or a
 * ledger entry it shows busted or confirmed the other way. The 5-minute pass reads the price only then.
 */
export function patternsDue(analysis, { seen = [], ledger = [], now = Date.now() } = {}) {
  const was = new Set(seen);
  if (draftedPatterns(analysis).some((p) => PATTERN_CHARTS.includes(p.chart) && !was.has(patternSeenKey(p)))) return true;
  return updateLedger(ledger, analysis, { now }).invalidated.length > 0;
}
