// How each published post is doing (owner 2026-11-15: "lanjutkan semua"; the studio's performance report). Read
// from each platform's own metrics, once a day for the posts of the last INSIGHTS_DAYS days, and kept in the Desk:
//   - Threads: GET /{media}/insights?metric=views,likes,replies,reposts,quotes,shares (threads_manage_insights);
//   - Instagram: GET /{media}/insights?metric=views,reach,likes,comments,saved,shares (FEED posts; up to 48 h late);
//   - YouTube: videos.list?part=statistics (viewCount, likeCount, commentCount);
//   - X: GET /2/tweets/{id}?tweet.fields=public_metrics, only when CONTENT_INSIGHTS lists "x" (X bills reads);
//   - Telegram (the Bot API has no post views) and TikTok (needs the video id, not the publish id, and video.list):
//     not read, shown as "not available".
// Shapes from the platforms' reference pages read on 2026-11-15. Every metric is normalised to one shape:
// { views, reach, likes, comments, shares, saves, reposts }, a missing one null. Never a token in a result.
import { THREADS_BASE, instagramBase, X_BASE, googleAccessToken } from "./publishers.mjs";

export const INSIGHTS_DAYS = 14;
export const INSIGHT_CHANNELS = Object.freeze(["threads", "instagram", "youtube", "x"]);
export const DEFAULT_INSIGHTS = "threads,instagram,youtube";
export const METRIC_KEYS = Object.freeze(["views", "reach", "likes", "comments", "shares", "saves", "reposts"]);
const empty = () => Object.fromEntries(METRIC_KEYS.map((k) => [k, null]));
const n = (v) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);
/** The sum of the values present, or null when none is. */
const sum = (...xs) => { const v = xs.map(n).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) : null; };

/** The channels whose metrics are read (CONTENT_INSIGHTS, comma separated; X only when listed). */
export const insightChannelsOf = (env) => String(env?.CONTENT_INSIGHTS ?? DEFAULT_INSIGHTS).split(",").map((c) => c.trim()).filter((c) => INSIGHT_CHANNELS.includes(c));

/** Meta's insights answer ({ data: [{ name, values: [{ value }] } or { total_value: { value } }] }) as name → number. */
export function metaValues(body) {
  const out = {};
  for (const m of Array.isArray(body?.data) ? body.data : []) {
    const v = m?.total_value?.value ?? m?.values?.[0]?.value;
    if (typeof m?.name === "string" && n(v) != null) out[m.name] = n(v);
  }
  return out;
}

async function getJson(fetcher, url, headers = {}) {
  const res = await fetcher(url, { method: "GET", headers });
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  if (!res.ok || body?.error) throw new Error(`${res.status} ${String(body?.error?.message ?? body?.title ?? "request failed").slice(0, 160)}`);
  return body;
}

/**
 * One post's metrics. `account` is the channel's account (tokens never leave this function); `token` a fresh
 * access token where the channel needs one (YouTube). Returns the normalised metrics, or null for a channel whose
 * metrics are not available.
 */
export async function postInsights(channel, { account, remoteId, token = null, fetcher = (...a) => fetch(...a) }) {
  const id = encodeURIComponent(String(remoteId ?? ""));
  if (!id) throw new Error("no post id");
  const m = empty();
  switch (channel) {
    case "threads": {
      const v = metaValues(await getJson(fetcher, `${THREADS_BASE}/${id}/insights?${new URLSearchParams({ metric: "views,likes,replies,reposts,quotes,shares", access_token: account.access_token })}`));
      return { ...m, views: v.views ?? null, likes: v.likes ?? null, comments: v.replies ?? null, shares: v.shares ?? null, reposts: sum(v.reposts, v.quotes) };
    }
    case "instagram": {
      const v = metaValues(await getJson(fetcher, `${instagramBase(account.access_token)}/${id}/insights?${new URLSearchParams({ metric: "views,reach,likes,comments,saved,shares", access_token: account.access_token })}`));
      return { ...m, views: v.views ?? null, reach: v.reach ?? null, likes: v.likes ?? null, comments: v.comments ?? null, shares: v.shares ?? null, saves: v.saved ?? null };
    }
    case "youtube": {
      const body = await getJson(fetcher, `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${id}`, { authorization: `Bearer ${token}` });
      const s = body?.items?.[0]?.statistics ?? {};
      return { ...m, views: n(s.viewCount), likes: n(s.likeCount), comments: n(s.commentCount) };
    }
    case "x": {
      const body = await getJson(fetcher, `${X_BASE}/tweets/${id}?tweet.fields=public_metrics`, { authorization: `Bearer ${account.access_token}` });
      const p = body?.data?.public_metrics ?? {};
      return { ...m, views: n(p.impression_count), likes: n(p.like_count), comments: n(p.reply_count), reposts: sum(p.repost_count, p.quote_count), saves: n(p.bookmark_count) };
    }
    default: return null;
  }
}

/**
 * Pure: the report over posts with metrics ([{ channel, published_at, metrics }]): per channel the posts, their
 * summed views, likes, comments and shares, and the best post by views; the totals.
 */
export function performanceReport(posts, { channels = [] } = {}) {
  const by = {};
  for (const c of channels) by[c] = { posts: 0, measured: 0, views: 0, likes: 0, comments: 0, shares: 0, best: null };
  for (const p of posts ?? []) {
    const r = by[p.channel] ??= { posts: 0, measured: 0, views: 0, likes: 0, comments: 0, shares: 0, best: null };
    r.posts += 1;
    if (!p.metrics) continue;
    r.measured += 1;
    for (const k of ["views", "likes", "comments", "shares"]) r[k] += n(p.metrics[k]) ?? 0;
    if (n(p.metrics.views) != null && (!r.best || p.metrics.views > r.best.views)) r.best = { id: p.id, views: p.metrics.views };
  }
  const total = Object.values(by).reduce((t, r) => ({ posts: t.posts + r.posts, views: t.views + r.views, likes: t.likes + r.likes, comments: t.comments + r.comments, shares: t.shares + r.shares }), { posts: 0, views: 0, likes: 0, comments: 0, shares: 0 });
  return { days: INSIGHTS_DAYS, channels: by, total };
}
