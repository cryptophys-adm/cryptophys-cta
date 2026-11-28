// Test helper: a reading whose confirmed and busted patterns carry xauusd's `confirmed_at_ms` (xauusd #655): the close
// of the chart's latest closed candle at the reading, unless a test sets it, so the fresh-breakout rule (owner
// 2026-11-27: "setuju aturan breakout maksimal 2 candle") lets them through as the readings before that rule did.
import { latestClose } from "../src/analysis-drafts.mjs";
export function fresh(analysis, atMs = Date.parse(analysis?.at)) {
  if (!analysis || !Array.isArray(analysis.patterns)) return analysis;
  return { ...analysis, patterns: analysis.patterns.map((p) => (["confirmed", "busted"].includes(p?.status) && !("confirmed_at_ms" in p) && Number.isFinite(atMs) ? { ...p, confirmed_at_ms: latestClose(p.chart, atMs, analysis.closed?.[p.chart]) } : p)) };
}
/** The same for xauusd's patterns() value (its closes, no `at`). */
export const freshValue = (v) => (v && Array.isArray(v.patterns) ? fresh(v, Number.isFinite(Date.parse(v.price_at)) ? Date.parse(v.price_at) : Number(v.price_at ?? v.at_close_ms)) : v);
