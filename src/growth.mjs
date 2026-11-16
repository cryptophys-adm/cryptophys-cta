// Growth tools of the studio (owner 2026-11-16: "kerjakan tambahan pro marketing juga", part 2). Pure: from the
// published posts and their metrics (src/insights.mjs, read once a day while publishing is on).
//
//   A/B captions    two texts of one post on one channel (variant A and B), each a draft that waits for approval;
//                   once both are published and measured, the one with the higher engagement per view wins.
//   Best times      per channel, the WIB weekday and hour whose posts got the most views (then engagement), from
//                   at least MIN_PER_BUCKET measured posts in that hour; a suggestion a person may add to the schedule.
//   Evergreen       custom posts (never the analysis kinds: their price levels age) published at least
//                   EVERGREEN_MIN_DAYS ago with the best engagement, not copied lately: a suggestion to duplicate.
import { DAYS } from "./settings.mjs";

export const MIN_PER_BUCKET = 2;
export const EVERGREEN_MIN_DAYS = 30;
const WIB = 7 * 3_600_000;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Likes, comments, shares, saves and reposts together (a missing metric counts 0). */
export function engagement(m) {
  if (!m) return 0;
  return num(m.likes) + num(m.comments) + num(m.shares) + num(m.saves) + num(m.reposts);
}
const measured = (p) => p?.metrics && (p.metrics.views != null || engagement(p.metrics) > 0);

/** Per channel: the best WIB weekday-hours by average views (then engagement), each from MIN_PER_BUCKET posts or more. */
export function bestTimes(posts, { top = 3, minPerBucket = MIN_PER_BUCKET } = {}) {
  const by = {};
  for (const p of posts || []) {
    if (!measured(p) || !p.published_at) continue;
    const t = new Date(Date.parse(p.published_at) + WIB);
    const key = `${DAYS[(t.getUTCDay() + 6) % 7]}@${String(t.getUTCHours()).padStart(2, "0")}`;
    const c = (by[p.channel] ??= { measured: 0, buckets: {} });
    c.measured += 1;
    const b = (c.buckets[key] ??= { n: 0, views: 0, engagement: 0 });
    b.n += 1; b.views += num(p.metrics.views); b.engagement += engagement(p.metrics);
  }
  return Object.fromEntries(Object.entries(by).map(([channel, c]) => [channel, {
    measured: c.measured,
    best: Object.entries(c.buckets).filter(([, b]) => b.n >= minPerBucket)
      .map(([k, b]) => ({ day: k.split("@")[0], time: `${k.split("@")[1]}:00`, posts: b.n, views: Math.round(b.views / b.n), engagement: Math.round((b.engagement / b.n) * 10) / 10 }))
      .sort((a, b) => b.views - a.views || b.engagement - a.engagement).slice(0, top)
  }]));
}

/** An A/B pair's result: both measured, the higher engagement per view (or engagement, without views) wins. */
export function abResult(a, b) {
  const score = (p) => {
    const e = engagement(p?.metrics), v = num(p?.metrics?.views);
    return { engagement: e, views: v, rate: v ? Math.round((e / v) * 10_000) / 100 : null };
  };
  const out = { a: a ? { id: a.id, status: a.status, ...score(a) } : null, b: b ? { id: b.id, status: b.status, ...score(b) } : null, winner: null };
  if (!measured(a) || !measured(b)) return { ...out, state: "waiting" };
  const ka = out.a.rate ?? out.a.engagement, kb = out.b.rate ?? out.b.engagement;
  return { ...out, state: "measured", winner: ka === kb ? "tie" : ka > kb ? "A" : "B" };
}

/** Evergreen suggestions: custom posts published long enough ago, best engagement first, not copied lately. */
export function evergreen(posts, { now = Date.now(), minDays = EVERGREEN_MIN_DAYS, copiedSince = new Set(), top = 5 } = {}) {
  return (posts || [])
    .filter((p) => p.kind === "custom" && p.published_at && now - Date.parse(p.published_at) >= minDays * 86_400_000 && measured(p) && !copiedSince.has(p.id))
    .map((p) => ({ id: p.id, channel: p.channel, published_at: p.published_at, text: String(p.text ?? "").slice(0, 200), views: num(p.metrics.views), engagement: engagement(p.metrics) }))
    .sort((a, b) => b.engagement - a.engagement || b.views - a.views)
    .slice(0, top);
}
