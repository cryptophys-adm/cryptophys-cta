// Daily recap drafts from the xauusd public projection (ported from xauusd-ai-trading-assistant
// workers/xauusd-content; owner 2026-11-14: "persiapan engine post ke Instagram/threads"). Deterministic English templates, no model call: a language model never writes the
// public text, so nothing can slip a price or an instruction into it. All public content is in English (owner
// 2026-11-15: "Semua content in english"). Every draft goes through the content
// guardian (src/content-guardian.mjs) before it can be queued, and again before it is published.
import { checkContentDraft } from "./guardian.mjs";
import { CHANNELS, TEXT_LIMITS, HASHTAGS, initialStatus } from "./channels.mjs";
export { CHANNELS, TEXT_LIMITS, HASHTAGS };

export const DRAFT_VERSION = "cryptophys.content-draft.v1";
/** The caption line of a post whose image carries TradingView's chart (Instagram); the guardian requires it. */
export const CHART_CREDIT = "Chart by TradingView.";
export const DISCLAIMER = "This is an educational recap from our analysis system. Not an invitation to buy or sell, and not financial advice.";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const BIAS_ID = { BULLISH: "leaning up", BEARISH: "leaning down", NEUTRAL: "neutral" };
const SESSION_ID = { asia: "Asian", london: "London", new_york: "New York", late: "closing" };

/** "6:09 AM", "5:27 PM": a UTC clock time in 12-hour form (owner 2026-11-17: "jam UTC seharusnya pakai AM/PM"). */
export function clock12(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "?";
  const h = d.getUTCHours(), m = String(d.getUTCMinutes()).padStart(2, "0");
  return `${h % 12 || 12}:${m} ${h < 12 ? "AM" : "PM"}`;
}

/** "Monday, 16 November 2026" (UTC). */
export function dateId(iso) {
  const d = new Date(iso);
  return `${DAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
const patternName = (id) => String(id ?? "").replace(/_/g, " ").trim();

/** Pure: the recaps of the window [from, to) (bar_close as ISO), a day's summary. */
export function summarizeDay(recaps, { from, to }) {
  const lo = Date.parse(from), hi = Date.parse(to);
  const day = (recaps || []).filter((r) => { const t = Date.parse(r?.bar_close ?? ""); return Number.isFinite(t) && t >= lo && t < hi; });
  const count = (f) => day.filter(f).length;
  const biases = ["BULLISH", "BEARISH", "NEUTRAL"].map((b) => [b, count((r) => r.bias === b)]).sort((a, b) => b[1] - a[1]);
  const sessions = {};
  for (const r of day) if (r.session) sessions[r.session] = sessions[r.session] || { BUY: 0, SELL: 0, WAIT: 0 }, sessions[r.session][r.stance] = (sessions[r.session][r.stance] || 0) + 1;
  const patterns = new Map();
  for (const r of day) for (const p of r.patterns || []) if (p.status === "confirmed") patterns.set(p.pattern, (patterns.get(p.pattern) || 0) + 1);
  const directional = day.filter((r) => r.stance === "BUY" || r.stance === "SELL");
  return {
    bars: day.length,
    buy: count((r) => r.stance === "BUY"), sell: count((r) => r.stance === "SELL"), wait: count((r) => r.stance === "WAIT"),
    main_bias: day.length && biases[0][1] > 0 ? biases[0][0] : null,
    sessions,
    confirmed_patterns: [...patterns.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([p]) => patternName(p)),
    directional_hits: directional.filter((r) => r.outcome === "hit").length,
    directional_misses: directional.filter((r) => r.outcome === "miss").length,
    decision_times: day.map((r) => r.bar_close)
  };
}

/** The disclaimer of the short channels (X): the capacity and "not an invitation" in one line. */
export const SHORT_DISCLAIMER = "Education only. Not financial advice.";

/** Pure: X's short recap (280 characters): the counts, the main bias, the disclaimer. */
function shortRecapText(summary, { dayIso }) {
  const d = new Date(dayIso);
  const lines = [`XAUUSD recap ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()].slice(0, 3)}: ${summary.bars} 15m bars, ${summary.buy} leaning up, ${summary.sell} leaning down, ${summary.wait} waiting.`];
  if (summary.main_bias) lines.push(`Dominant read: ${BIAS_ID[summary.main_bias]}.`);
  lines.push(SHORT_DISCLAIMER, HASHTAGS.x);
  return lines.join("\n");
}

/** Pure: the day's recap text for one channel, or null when the day had no decision. */
export function dailyRecapText(summary, { channel = "threads", dayIso }) {
  if (!summary?.bars) return null;
  if (channel === "x") return shortRecapText(summary, { dayIso });
  const lines = [
    `Education · XAUUSD recap · ${dateId(dayIso)}`,
    "",
    `Our analysis system read ${summary.bars} 15-minute bars: ${summary.buy} leaning up, ${summary.sell} leaning down, ${summary.wait} choosing to wait.`
  ];
  if (summary.main_bias) lines.push(`Most frequent read: ${BIAS_ID[summary.main_bias]}.`);
  const busiest = Object.entries(summary.sessions || {}).map(([s, v]) => [s, (v.BUY || 0) + (v.SELL || 0)]).sort((a, b) => b[1] - a[1])[0];
  if (busiest && busiest[1] > 0) lines.push(`Most directional reads came in the ${SESSION_ID[busiest[0]] ?? busiest[0]} session.`);
  if (summary.confirmed_patterns?.length) lines.push(`Confirmed patterns: ${summary.confirmed_patterns.join(", ")}.`);
  const decided = summary.directional_hits + summary.directional_misses;
  if (decided) lines.push(`Of ${decided} directional reads scored one hour later, ${summary.directional_hits} matched the move and ${summary.directional_misses} did not.`);
  lines.push("", ...(["instagram", "youtube", "tiktok"].includes(channel) ? [CHART_CREDIT] : []), DISCLAIMER, ...[HASHTAGS[channel] ?? ""].filter(Boolean));
  const max = TEXT_LIMITS[channel] ?? 500;
  // Too long: drop the optional lines one at a time (the session, then the patterns, then the scored reads),
  // so the disclaimer is never cut.
  let keep = lines;
  for (const prefix of ["Most directional ", "Confirmed ", "Of "]) {
    if (keep.join("\n").length <= max) break;
    keep = keep.filter((l) => !l.startsWith(prefix));
  }
  return keep.join("\n").length <= max ? keep.join("\n") : null;
}

/**
 * Pure: the drafts of one day for the configured channels, each checked by the guardian. Instagram needs an
 * image (it has no text-only post): its draft waits with status "needs_image" until the card image exists.
 */
/** The rows the recaps RPC gave before xauusd RC1 (LIMIT 50): a reply this long that stops short of the window is cut. */
export const RECAPS_OLD_CAP = 50;
/** The recap's window: the 24 hours that end `windowDelayHours` before `now` (the projection's own `delay_hours`). */
export function recapSpan(now, windowDelayHours = 24) {
  const d = Number.isFinite(Number(windowDelayHours)) && Number(windowDelayHours) >= 0 ? Number(windowDelayHours) : 24;
  const to = now - d * 3_600_000;
  return { from: new Date(to - 24 * 3_600_000).toISOString(), to: new Date(to).toISOString() };
}
/** Pure: whether the recaps given stop short of the window's start because the RPC cut them (the old 50-row cap). */
export function recapsCut(recaps, from) {
  const rows = (recaps || []).filter((r) => Number.isFinite(Date.parse(r?.bar_close ?? "")));
  if (rows.length < RECAPS_OLD_CAP) return false;
  const oldest = Math.min(...rows.map((r) => Date.parse(r.bar_close)));
  return oldest > Date.parse(from) + 15 * 60_000;
}
/**
 * The window follows the projection's `delay_hours` (owner 2026-11-26: "1.a", the last 24 hours once the delay is 0):
 * `windowDelayHours` 0 is the 24 hours to now, 24 the 24 hours before that. A reply cut short of the window (the old
 * 50-row cap) drafts nothing and says so (`cut`), never a recap of part of the day.
 */
export function dailyDrafts(recaps, { now = Date.now(), channels = CHANNELS, delayHours = 24, windowDelayHours = 24 } = {}) {
  const { from, to } = recapSpan(now, windowDelayHours);
  if (recapsCut(recaps, from)) return { summary: { ...summarizeDay([], { from, to }), cut: true }, drafts: [] };
  const summary = summarizeDay(recaps, { from, to });
  const out = [];
  for (const channel of channels.filter((c) => CHANNELS.includes(c))) {
    const text = dailyRecapText(summary, { channel, dayIso: to });
    if (!text) continue;
    const guardian = checkContentDraft({ text, chart: false, decisionTimes: summary.decision_times, delayHours, now });
    out.push({
      id: `daily:${to.slice(0, 10)}:${channel}`, version: DRAFT_VERSION, kind: "daily_recap", channel, text,
      image_url: null, window: { from, to }, decision_times: summary.decision_times,
      guardian, status: !guardian.pass ? "blocked" : initialStatus(channel)
    });
  }
  return { summary, drafts: out };
}
