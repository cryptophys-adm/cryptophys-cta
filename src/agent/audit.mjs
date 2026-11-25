// The CTA agent's Audit and Plan skills, for every channel (owner 2026-11-25: "setuju semua"; "Agent jangan
// dedicated ke thread, harus untuk semua channel"; the mockup "CTA Studio: the Agent page"), after instagram-agent-skill's ig-audit and ig-plan (MIT, Copyright (c) 2026 Jake Schincariol:
// src/agent/LICENSE-instagram-agent-skill). Pure: from a channel's published posts and the metrics the CTA already
// reads once a day (src/insights.mjs: views, likes, replies as comments, reposts with quotes, shares).
//
// ig-audit's rule: raw views say little; a post is judged by its outlier multiple, its views over the account's own
// median, and a finding needs enough posts behind it (here MIN_FINDING), or it is said to be too few to call.
// ig-plan's rule: the hour matters far less than what is posted, so the plan names the kinds that travel first and
// suggests posting hours only where the data has at least MIN_PER_HOUR posts in that hour.
// Posts stay the xauusd templates; the plan suggests slots and a mix, it never writes a post.
import { DAYS } from "../settings.mjs";

export const AUDIT_DAYS = 7;
export const BASELINE_DAYS = 28;
export const MIN_FINDING = 3;
export const MIN_PER_HOUR = 2;
const WIB = 7 * 3_600_000;
const DAY = 86_400_000;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const round = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
export const KIND_NAMES = Object.freeze({ key_levels: "Key-level map", pattern: "Chart pattern", daily_recap: "Daily recap", warroom: "War Room", custom: "Custom post" });

/** The first line of a post, as its name in the audit. */
const headOf = (text) => String(text ?? "").split("\n")[0].trim().slice(0, 90);
/** The WIB Monday 00:00 (as a UTC time) of the week holding `t`. */
export function wibWeekStart(t) {
  const w = new Date(t + WIB);
  const back = (w.getUTCDay() + 6) % 7;
  return Date.UTC(w.getUTCFullYear(), w.getUTCMonth(), w.getUTCDate() - back) - WIB;
}

/**
 * The audit of the last complete WIB week (Monday to Sunday) on one channel: each post's views over the median of the
 * BASELINE_DAYS before the week ended, by post and by kind, with findings only where MIN_FINDING posts stand behind them.
 */
export function auditChannel(posts = [], { channel = "threads", now = Date.now() } = {}) {
  const end = wibWeekStart(now), start = end - AUDIT_DAYS * DAY;
  const ours = (posts || []).filter((p) => p?.channel === channel && p.published_at && p.metrics && p.metrics.views != null);
  const at = (p) => Date.parse(p.published_at);
  const baseline = ours.filter((p) => at(p) < end && at(p) >= end - BASELINE_DAYS * DAY);
  const med = median(baseline.map((p) => num(p.metrics.views)));
  const week = ours.filter((p) => at(p) >= start && at(p) < end).map((p) => ({
    id: p.id, kind: p.kind, head: headOf(p.text), published_at: p.published_at,
    views: num(p.metrics.views), replies: num(p.metrics.comments), reposts: num(p.metrics.reposts), likes: num(p.metrics.likes),
    multiple: med ? round(num(p.metrics.views) / med) : null
  })).sort((a, b) => (b.multiple ?? 0) - (a.multiple ?? 0) || b.views - a.views);
  const kinds = Object.entries(Object.groupBy ? Object.groupBy(week, (p) => p.kind) : week.reduce((o, p) => ((o[p.kind] ??= []).push(p), o), {}))
    .map(([kind, list]) => ({ kind, name: KIND_NAMES[kind] ?? kind, posts: list.length, median_multiple: med ? round(median(list.map((p) => p.multiple ?? 0))) : null,
      replies: list.reduce((s, p) => s + p.replies, 0), reposts: list.reduce((s, p) => s + p.reposts, 0) }))
    .sort((a, b) => (b.median_multiple ?? 0) - (a.median_multiple ?? 0));
  const findings = [];
  if (!baseline.length) findings.push("No measured post on this channel yet: the audit starts once the daily metrics have read some.");
  else {
    const enough = kinds.filter((k) => k.posts >= MIN_FINDING), few = kinds.filter((k) => k.posts < MIN_FINDING);
    if (enough.length) {
      const top = enough[0];
      findings.push(`${top.name}: ${top.median_multiple}× the median over ${top.posts} posts, ${top.replies} replies and ${top.reposts} reposts.`);
      if (enough.length > 1) { const low = enough.at(-1); findings.push(`${low.name}: ${low.median_multiple}× the median over ${low.posts} posts.`); }
    }
    for (const k of few) findings.push(`${k.name}: ${k.posts} post${k.posts === 1 ? "" : "s"}, too few to call.`);
    const replies = week.reduce((s, p) => s + p.replies, 0);
    if (week.length) findings.push(`${week.length} posts this week, ${replies} replies in all.`);
  }
  return { channel, week: { from: new Date(start).toISOString(), to: new Date(end).toISOString() }, baseline_days: BASELINE_DAYS, median_views: med, measured: baseline.length, posts: week, kinds, findings };
}

/** The WIB hours of a channel's measured posts of the last BASELINE_DAYS, each with at least MIN_PER_HOUR posts, best views first. */
export function bestHours(posts = [], { channel = "threads", now = Date.now(), top = 3 } = {}) {
  const by = {};
  for (const p of posts || []) {
    if (p?.channel !== channel || !p.published_at || p.metrics?.views == null) continue;
    const t = Date.parse(p.published_at);
    if (!(t >= now - BASELINE_DAYS * DAY && t < now)) continue;
    const h = new Date(t + WIB).getUTCHours();
    (by[h] ??= []).push(num(p.metrics.views));
  }
  return Object.entries(by).filter(([, v]) => v.length >= MIN_PER_HOUR)
    .map(([h, v]) => ({ time: `${String(h).padStart(2, "0")}:00`, posts: v.length, median_views: median(v) }))
    .sort((a, b) => b.median_views - a.median_views).slice(0, top);
}

/**
 * The week's plan for one channel: the kinds in the order the audit ranks them (only kinds with MIN_FINDING posts are
 * ranked; the rest "keep, review when there are more"), and posting slots at the best measured hours, every day.
 * `schedule`: the channel's posting slots already set, so a suggested slot is new.
 */
export function planChannel(audit, posts = [], { now = Date.now(), schedule = [] } = {}) {
  const ranked = (audit?.kinds ?? []).filter((k) => k.posts >= MIN_FINDING);
  const mix = [
    ...ranked.map((k, i) => ({ kind: k.kind, name: k.name, advice: i === 0 ? "post more" : i === ranked.length - 1 && ranked.length > 1 && (k.median_multiple ?? 0) < 1 ? "post less" : "keep", why: `${k.median_multiple}× the median over ${k.posts} posts` })),
    ...(audit?.kinds ?? []).filter((k) => k.posts < MIN_FINDING).map((k) => ({ kind: k.kind, name: k.name, advice: "keep", why: `${k.posts} post${k.posts === 1 ? "" : "s"}: review when there are more` }))
  ];
  const have = new Set((schedule || []).map((s) => s.time));
  const hours = bestHours(posts, { channel: audit?.channel ?? "threads", now });
  const slots = hours.filter((h) => !have.has(h.time)).map((h) => ({ days: [...DAYS], time: h.time, why: `median ${h.median_views} views over ${h.posts} posts at this hour` }));
  return { mix, slots, note: hours.length ? "" : `No hour has ${MIN_PER_HOUR} measured posts yet: no slot suggested.` };
}
