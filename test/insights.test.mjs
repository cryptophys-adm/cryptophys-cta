// Post metrics (src/insights.mjs): each platform's answer normalised, and the report over them.
import test from "node:test";
import assert from "node:assert/strict";
import { postInsights, metaValues, performanceReport, insightChannelsOf, METRIC_KEYS } from "../src/insights.mjs";

const reply = (body, status = 200) => async (url, init) => { reply.last = { url: String(url), init }; return new Response(JSON.stringify(body), { status }); };

test("Threads, Instagram, YouTube and X metrics come back in one shape; Telegram and TikTok are not available", async () => {
  const threads = await postInsights("threads", { account: { access_token: "T" }, remoteId: "111", fetcher: reply({ data: [
    { name: "views", values: [{ value: 1200 }] }, { name: "likes", values: [{ value: 40 }] }, { name: "replies", values: [{ value: 5 }] },
    { name: "reposts", values: [{ value: 3 }] }, { name: "quotes", values: [{ value: 1 }] }, { name: "shares", total_value: { value: 2 } }] }) });
  assert.deepEqual(threads, { views: 1200, reach: null, likes: 40, comments: 5, shares: 2, saves: null, reposts: 4 });
  assert.match(reply.last.url, /\/111\/insights\?metric=views%2Clikes%2Creplies%2Creposts%2Cquotes%2Cshares&access_token=T$/);
  const ig = await postInsights("instagram", { account: { access_token: "I" }, remoteId: "222", fetcher: reply({ data: [{ name: "views", values: [{ value: 900 }] }, { name: "reach", values: [{ value: 700 }] }, { name: "saved", values: [{ value: 9 }] }] }) });
  assert.deepEqual(ig, { views: 900, reach: 700, likes: null, comments: null, shares: null, saves: 9, reposts: null });
  const yt = await postInsights("youtube", { account: {}, token: "ya29", remoteId: "vid1", fetcher: reply({ items: [{ statistics: { viewCount: "3400", likeCount: "120", commentCount: "8" } }] }) });
  assert.deepEqual([yt.views, yt.likes, yt.comments], [3400, 120, 8]);
  assert.equal(reply.last.init.headers.authorization, "Bearer ya29");
  const x = await postInsights("x", { account: { access_token: "X" }, remoteId: "9", fetcher: reply({ data: { public_metrics: { impression_count: 500, like_count: 7, reply_count: 1, repost_count: 2, quote_count: 0, bookmark_count: 3 } } }) });
  assert.deepEqual(x, { views: 500, reach: null, likes: 7, comments: 1, shares: null, saves: 3, reposts: 2 });
  for (const c of ["telegram", "tiktok"]) assert.equal(await postInsights(c, { account: {}, remoteId: "1" }), null);
  await assert.rejects(postInsights("threads", { account: { access_token: "T" }, remoteId: "1", fetcher: reply({ error: { message: "bad" } }, 400) }), /400 bad/);
  await assert.rejects(postInsights("threads", { account: {}, remoteId: "" }), /no post id/);
  assert.deepEqual(Object.keys(threads), [...METRIC_KEYS]);
});

test("the channels read: Threads, Instagram, YouTube by default; X only when listed (X bills reads)", () => {
  assert.deepEqual(insightChannelsOf({}), ["threads", "instagram", "youtube"]);
  assert.deepEqual(insightChannelsOf({ CONTENT_INSIGHTS: "x, threads, telegram, bogus" }), ["x", "threads"]);
  assert.deepEqual(metaValues({ data: [{ name: "a", values: [{ value: "5" }] }, { name: "b" }, null] }), { a: 5 });
});

test("the report: posts, measured posts, sums and the best post per channel, and the totals", () => {
  const r = performanceReport([
    { id: "a", channel: "threads", metrics: { views: 100, likes: 5, comments: 1, shares: 0 } },
    { id: "b", channel: "threads", metrics: { views: 300, likes: 9, comments: null, shares: 2 } },
    { id: "c", channel: "threads", metrics: null },
    { id: "d", channel: "youtube", metrics: { views: 50, likes: 1 } }
  ], { channels: ["threads", "instagram", "youtube"] });
  assert.deepEqual(r.channels.threads, { posts: 3, measured: 2, views: 400, likes: 14, comments: 1, shares: 2, best: { id: "b", views: 300 } });
  assert.deepEqual(r.channels.instagram, { posts: 0, measured: 0, views: 0, likes: 0, comments: 0, shares: 0, best: null });
  assert.deepEqual(r.total, { posts: 4, views: 450, likes: 15, comments: 1, shares: 2 });
});
