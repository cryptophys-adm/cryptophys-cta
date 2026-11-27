// The content engine (owner 2026-11-14: "persiapan engine post ke Instagram/threads"): drafts from the public
// projection, the approval queue, and the Threads and Instagram publishers (dry run and a faked Meta API).
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { dailyDrafts, dailyRecapText, summarizeDay, dateId, TEXT_LIMITS, recapSpan, recapsCut, RECAPS_OLD_CAP } from "../src/drafts.mjs";
import { addDrafts, listDrafts, decideDraft, recordPublish, deskCounts, getDraft, draftEvents, storeToken, storedToken } from "../src/desk.mjs";
import { publishThreads, publishInstagram, publishingQuota, refreshToken, THREADS_BASE, INSTAGRAM_BASE, FACEBOOK_GRAPH_BASE, THREADS_IMAGE_SETTLE_MS, THREADS_MISSING_RETRY_MS } from "../src/publishers.mjs";
import { identify } from "../src/oauth.mjs";
import { PRICE_LIKE } from "../src/guardian.mjs";

const NOW = Date.parse("2026-11-17T22:17:00Z"); // Tuesday's run: the trading day that ended 24 hours earlier
const recap = (iso, stance, bias, outcome, patterns = []) => ({ bar_close: iso, session: "london", timeframe: "15m", stance, bias, outcome, patterns });
const RECAPS = [
  recap("2026-11-16T09:00:00.000Z", "SELL", "BEARISH", "hit", [{ timeframe: "15", pattern: "wedge_falling", status: "confirmed" }]),
  recap("2026-11-16T09:15:00.000Z", "WAIT", "BEARISH", "hit"),
  recap("2026-11-16T14:30:00.000Z", "BUY", "BULLISH", "miss"),
  recap("2026-11-16T15:00:00.000Z", "WAIT", "NEUTRAL", "hit"),
  recap("2026-11-15T10:00:00.000Z", "SELL", "BEARISH", "hit"), // older than the window
  recap("2026-11-17T10:00:00.000Z", "SELL", "BEARISH", "hit") // inside the delay: never in a draft
];

test("a day's recap: counts, main bias, confirmed patterns, the scored directional reads, disclaimer and hashtags; no price", () => {
  const all = dailyDrafts(RECAPS, { now: NOW });
  assert.deepEqual(all.drafts.map((d) => [d.channel, d.status, d.guardian.pass]), [
    ["threads", "pending", true], ["instagram", "needs_image", true], ["x", "pending", true],
    ["telegram", "pending", true], ["youtube", "needs_video", true], ["tiktok", "needs_video", true]
  ], "every channel; media channels wait for their image or video");
  assert.ok(all.drafts.find((d) => d.channel === "x").text.length <= 280, "X keeps its 280 characters");
  const { summary, drafts } = dailyDrafts(RECAPS, { now: NOW, channels: ["threads", "instagram"] });
  assert.deepEqual([summary.bars, summary.buy, summary.sell, summary.wait, summary.main_bias], [4, 1, 1, 2, "BEARISH"]);
  assert.deepEqual([summary.directional_hits, summary.directional_misses], [1, 1]);
  assert.deepEqual(drafts.map((d) => [d.channel, d.status, d.guardian.pass]), [["threads", "pending", true], ["instagram", "needs_image", true]]);
  const t = drafts[0].text;
  assert.match(t, /^Education · XAUUSD recap · Monday, 16 November 2026/);
  assert.match(t, /read 4 15-minute bars: 1 leaning up, 1 leaning down, 2 choosing to wait/);
  assert.match(t, /Confirmed patterns: wedge falling\./);
  assert.match(t, /Not an invitation to buy or sell, and not financial advice\./);
  assert.ok(t.length <= TEXT_LIMITS.threads, `${t.length} characters`);
  assert.equal(drafts[0].id, "daily:2026-11-16:threads");
  assert.ok(!PRICE_LIKE.test(t.replace(/\b(19|20)\d{2}\b/g, "")), "no price-like number besides the year");
  assert.equal(dailyRecapText(summarizeDay([], { from: "2026-11-16T00:00:00Z", to: "2026-11-17T00:00:00Z" }), { dayIso: "2026-11-17T00:00:00Z" }), null, "no decision, no draft");
  assert.equal(dateId("2026-11-20T10:00:00Z"), "Friday, 20 November 2026");
});

function sqlite() {
  const db = new DatabaseSync(":memory:");
  return { exec(q, ...b) { const s = db.prepare(q); const isRead = /^\s*SELECT/i.test(q); const out = isRead ? s.all(...b) : (s.run(...b), []); return { toArray: () => out.map((r) => ({ ...r })) }; } };
}

test("the queue: a draft once, a person approves or rejects with a reason, the guardian runs again, every step an event", () => {
  const sql = sqlite();
  const { drafts } = dailyDrafts(RECAPS, { now: NOW, channels: ["threads", "instagram"] });
  assert.deepEqual(addDrafts(sql, drafts, { now: NOW }), ["daily:2026-11-16:threads", "daily:2026-11-16:instagram"]);
  assert.deepEqual(addDrafts(sql, drafts, { now: NOW }), [], "the next run adds nothing twice");
  assert.deepEqual(deskCounts(sql), { needs_image: 1, pending: 1 });
  assert.equal(decideDraft(sql, { id: "daily:2026-11-16:instagram", decision: "approve", actor: "owner" }).error, "the draft is needs_image, not pending");
  assert.equal(decideDraft(sql, { id: "daily:2026-11-16:threads", decision: "reject", actor: "owner" }).error, "a reason is required to reject");
  assert.equal(decideDraft(sql, { id: "daily:2026-11-16:threads", decision: "approve", actor: "" }).error, "actor is required");
  const ok = decideDraft(sql, { id: "daily:2026-11-16:threads", decision: "approve", actor: "owner@example.com", reason: "ok" }, { now: NOW + 60_000 });
  assert.deepEqual([ok.ok, ok.status, ok.guardian.pass], [true, "approved", true]);
  assert.equal(decideDraft(sql, { id: "daily:2026-11-16:threads", decision: "reject", actor: "owner", reason: "late" }).error, "the draft is approved, not pending");
  recordPublish(sql, { id: "daily:2026-11-16:threads", remoteId: "1789" }, { now: NOW + 120_000 });
  assert.deepEqual([getDraft(sql, "daily:2026-11-16:threads").status, getDraft(sql, "daily:2026-11-16:threads").remote_id], ["published", "1789"]);
  assert.deepEqual(draftEvents(sql, "daily:2026-11-16:threads").map((e) => e.action), ["published", "approved", "drafted"]);
  // A draft whose text breaks a rule is blocked at approval, not published.
  addDrafts(sql, [{ id: "x", channel: "threads", text: "Education only. Not financial advice. Sell now at 3870!", status: "pending", decision_times: [] }], { now: NOW });
  const bad = decideDraft(sql, { id: "x", decision: "approve", actor: "owner" }, { now: NOW });
  assert.equal(bad.status, "blocked");
  assert.deepEqual(bad.guardian.failures.map((f) => f.check).sort(), ["instruction", "price_level"]);
  assert.deepEqual(listDrafts(sql, { status: "blocked" }).map((d) => d.id), ["x"]);
  storeToken(sql, "threads", { access_token: "t2", expires_in: 5_184_000 }, { now: NOW });
  assert.equal(storedToken(sql, "threads").access_token, "t2");
});

/** A fake Meta API: records each call (URL and body), answers containers, statuses and publishes. */
function fakeMeta({ status = "FINISHED", fail = null, meFails = false } = {}) {
  const calls = [];
  const fetcher = async (url, init = {}) => {
    const body = init.body ? Object.fromEntries(new URLSearchParams(String(init.body))) : null;
    calls.push({ method: init.method, url: String(url), body });
    const u = new URL(url);
    if (fail && u.pathname.endsWith(fail)) return new Response(JSON.stringify({ error: { message: "Application request limit reached", code: 4 } }), { status: 400 });
    // /me gives the account's id as a string (the stored id can be a rounded number, 2026-11-17).
    if (u.pathname.endsWith("/me")) return meFails ? new Response("{}", { status: 500 }) : Response.json({ id: "30379158928338151", user_id: "17841400000000001" });
    if (init.method === "POST" && /\/(threads|media)$/.test(u.pathname)) return Response.json({ id: "c1" });
    if (init.method === "POST" && /_publish$/.test(u.pathname)) return Response.json({ id: "p1" });
    if (/\/c1$/.test(u.pathname)) return Response.json({ id: "c1", status, status_code: status });
    if (/publishing_limit$/.test(u.pathname)) return Response.json({ data: [{ quota_usage: 3, config: { quota_total: 250 } }] });
    if (/refresh_access_token$/.test(u.pathname)) return Response.json({ access_token: "new", expires_in: 5_184_000 });
    return new Response("{}", { status: 404 });
  };
  return { calls, fetcher };
}
const account = { user_id: "42", access_token: "SECRET-TOKEN" };
const noSleep = async () => {};

test("Threads: container, ready, publish; the token only in POST bodies; a dry run sends nothing and shows no token", async () => {
  const { calls, fetcher } = fakeMeta();
  const r = await publishThreads({ account, text: "Education only. Not financial advice.", fetcher, sleep: noSleep });
  assert.deepEqual(r, { remote_id: "p1", container_id: "c1" });
  assert.deepEqual(calls.map((c) => [c.method, c.url.split("?")[0]]), [["GET", `${THREADS_BASE}/me`], ["POST", `${THREADS_BASE}/30379158928338151/threads`], ["GET", `${THREADS_BASE}/c1`], ["POST", `${THREADS_BASE}/30379158928338151/threads_publish`]], "the id from /me, not the stored one");
  assert.deepEqual([calls[1].body.media_type, calls[3].body.creation_id], ["TEXT", "c1"]);
  // /me unreadable: the stored id.
  const m = fakeMeta({ meFails: true });
  await publishThreads({ account, text: "x", fetcher: m.fetcher, sleep: noSleep });
  assert.equal(m.calls[1].url.split("?")[0], `${THREADS_BASE}/42/threads`);
  assert.ok(calls.filter((c) => c.method === "POST").every((c) => !c.url.includes("SECRET") && c.body.access_token === "SECRET-TOKEN"));
  const dry = await publishThreads({ account, text: "x", dryRun: true, fetcher: () => { throw new Error("no call in a dry run"); } });
  assert.equal(dry.dry_run, true);
  assert.ok(!JSON.stringify(dry).includes("SECRET"));
  await assert.rejects(publishThreads({ account: { user_id: "42" }, text: "x", fetcher }), /not configured/);
});

test("Instagram: needs a public image; container, ready, publish; a container error or Meta error fails the call", async () => {
  const { calls, fetcher } = fakeMeta();
  await assert.rejects(publishInstagram({ account, caption: "c", imageUrl: null, fetcher, sleep: noSleep }), /public https image/);
  const r = await publishInstagram({ account, caption: "c", imageUrl: "https://img.example/card.jpg", fetcher, sleep: noSleep });
  assert.equal(r.remote_id, "p1");
  assert.deepEqual(calls.map((c) => c.url.split("?")[0]), ["https://graph.instagram.com/me", `${INSTAGRAM_BASE}/17841400000000001/media`, `${INSTAGRAM_BASE}/c1`, `${INSTAGRAM_BASE}/17841400000000001/media_publish`]);
  assert.equal(calls[2].url.includes("fields=status_code"), true);
  await assert.rejects(publishInstagram({ account, caption: "c", imageUrl: "https://img.example/a.jpg", fetcher: fakeMeta({ status: "ERROR" }).fetcher, sleep: noSleep }), /container error/);
  await assert.rejects(publishInstagram({ account, caption: "c", imageUrl: "https://img.example/a.jpg", fetcher: fakeMeta({ fail: "/media_publish" }).fetcher, sleep: noSleep }), /request limit/);
});

test("Instagram with a Meta business token (EAA...): graph.facebook.com, the entered account id, no /me", async () => {
  const biz = { user_id: "17841466030747958", access_token: "EAA-SECRET-TOKEN" };
  const { calls, fetcher } = fakeMeta();
  const r = await publishInstagram({ account: biz, caption: "c", imageUrl: "https://img.example/card.jpg", fetcher, sleep: noSleep });
  assert.equal(r.remote_id, "p1");
  assert.deepEqual(calls.map((c) => c.url.split("?")[0]), [`${FACEBOOK_GRAPH_BASE}/17841466030747958/media`, `${FACEBOOK_GRAPH_BASE}/c1`, `${FACEBOOK_GRAPH_BASE}/17841466030747958/media_publish`], "the system user's /me is never asked");
  const dry = await publishInstagram({ account: biz, caption: "c", imageUrl: "https://img.example/card.jpg", dryRun: true, fetcher: () => { throw new Error("no call in a dry run"); } });
  assert.ok(dry.requests.every((q) => q.url.startsWith(FACEBOOK_GRAPH_BASE)) && !JSON.stringify(dry).includes("SECRET"));
  const q = fakeMeta();
  await publishingQuota({ channel: "instagram", account: biz, fetcher: q.fetcher });
  assert.equal(q.calls[0].url.split("?")[0], `${FACEBOOK_GRAPH_BASE}/17841466030747958/content_publishing_limit`);
  // The paste check: the account id is required with such a token, and read from graph.facebook.com.
  await assert.rejects(identify("instagram", { access_token: "EAA-SECRET-TOKEN" }, { fetcher }), /needs the Instagram account id/);
  const seen = [];
  const who = await identify("instagram", biz, { fetcher: async (url) => { seen.push(url.split("?")[0]); return new Response(JSON.stringify({ id: "17841466030747958", username: "cryptophys.adm" }), { status: 200 }); } });
  assert.deepEqual([seen, who], [[`${FACEBOOK_GRAPH_BASE}/17841466030747958`], { id: "17841466030747958", name: "@cryptophys.adm" }]);
});

test("the quota is read from Meta, never assumed; a token is refreshed through its own endpoint", async () => {
  const { fetcher } = fakeMeta();
  assert.deepEqual(await publishingQuota({ channel: "threads", account, fetcher }), { used: 3, total: 250 });
  assert.equal(await publishingQuota({ channel: "threads", account: null, fetcher }), null);
  assert.deepEqual(await refreshToken({ channel: "instagram", token: "old", fetcher }), { access_token: "new", expires_in: 5_184_000 });
});

// Real-time analysis (owner 2026-11-14: "fokus pada hasil analytics dan key level ... kecuali info buy/sell zone";
// "Real-time, hanya analisa").
import { analysisDrafts as analysisDraftsRaw, keyLevelsText, patternText, postablePatterns, MAX_PATTERN_DRAFTS_PER_DAY, PATTERN_LOOKBACK_MS, patternDrafted, patternOfId, saneProjection, PROJECTION_MAX_SHARE, overlayOf, sameBand, bandDrafted, PATTERN_BAND_SHARE, patternLookbackMs, UNCAPPED_PATTERN_CHARTS } from "../src/analysis-drafts.mjs";
import { fresh } from "./fresh.mjs";
const analysisDrafts = (a, o) => analysisDraftsRaw(fresh(a), o);
import { draftIdsWithPrefix, kindCountsSince, draftsWithPrefixSince } from "../src/desk.mjs";


// The analysis as the xauusd AI Worker's PublicProjection.analysis() returns it (src/public-analysis.mjs there).
function publicAnalysis(kl, { structure = null, now = Date.now() } = {}) {
  const ROLE = { support: "demand", resistance: "supply", "at price": "at_price" };
  const NAMES = { three_falling_peaks: ["Three Falling Peaks", 45], broadening_wedge_descending: ["Descending Broadening Wedge", 6], flag: ["Flag", 23] };
  const CH = { "60": "H1", "240": "H4", D: "D1" };
  return {
    at: new Date(now).toISOString(), price: kl.price,
    zones: kl.candidates.map((z) => ({ role: ROLE[z.role], low: z.low, high: z.high, strength: z.strength, sources: z.sources, metrics: z.metrics })).sort((a, b) => b.high - a.high),
    patterns: kl.patterns.filter((p) => CH[p.tf]).map((p) => ({ chart: CH[p.tf], pattern: p.id, name: NAMES[p.id]?.[0] ?? p.id, chapter: NAMES[p.id]?.[1] ?? null, status: p.status, direction: p.direction > 0 ? "up" : p.direction < 0 ? "down" : "undetermined", upper: p.upper, lower: p.lower, projection: p.status === "confirmed" ? p.target ?? null : null })),
    structure: structure ? { H4: structure.h4, H1: structure.h1, "15m": structure.m15 } : {}
  };
}
const KEY_LEVELS = {
  price: 3887.6, atr_h1: 8.2,
  candidates: [
    { role: "resistance", low: 3918.33, high: 3923.09, price: 3920, strength: "strong", sources: 5, label: "4H flag line", candidate: true, metrics: ["4H Camarilla H4", "weekly pivot", "4H Flag: upper breakout line"] },
    { role: "resistance", low: 3898.09, high: 3901.12, price: 3900, strength: "moderate", sources: 3, label: "1H swing high", candidate: true, metrics: ["1H swing high", "round number"] },
    { role: "support", low: 3864.14, high: 3867.8, price: 3866, strength: "strong", sources: 4, label: "4H Camarilla L4", candidate: true, metrics: ["4H Camarilla L4", "daily CPR bottom", "previous day low"] },
    { role: "support", low: 3846.49, high: 3850, price: 3848, strength: "weak", sources: 3, label: "daily low", candidate: true }
  ],
  patterns: [
    { tf: "240", chart: "H4", id: "three_falling_peaks", status: "forming", direction: 0, upper: 3927.2, lower: 3856.7, target: null },
    { tf: "240", chart: "H4", id: "broadening_wedge_descending", status: "confirmed", direction: 1, upper: 3886.1, lower: 3719.57, target: 4020.5 },
    { tf: "60", chart: "H1", id: "flag", status: "forming", direction: 0, upper: 3890, lower: 3880 },
    { tf: "15", chart: "15m", id: "wedge_falling", status: "confirmed", direction: 1, upper: 3866, lower: 3864, target: 3906 }
  ],
  trade: { entry: 3887 }, strategy_plans: { short: { entry: 1 } }
};
const STRUCTURE = { h4: { label: "LH/LL", trend: "down" }, h1: { label: "LH/LL", trend: "down" }, m15: { label: "HH/HL", trend: "up" } };
const AT = Date.parse("2026-11-16T06:09:00Z");

test("the key-level map and the pattern posts pass the guardian with levels allowed, and carry no signal word", () => {
  const a = publicAnalysis(KEY_LEVELS, { structure: STRUCTURE, now: AT });
  const map = keyLevelsText(a, { channel: "threads" });
  assert.match(map, /^Education · XAUUSD key-level map · Monday, 16 November 2026 6:09 AM UTC/);
  assert.match(map, /Supply zones \(sell area\):\n• 3918\.33–3923\.09 \(strong: 4H Camarilla H4\)\n• 3898\.09–3901\.12 \(moderate: 1H swing high\)/);
  assert.doesNotMatch(map, /sources|Bulkowski|catalogue/);
  assert.match(keyLevelsText(a, { channel: "instagram" }), /3918\.33–3923\.09 \(strong: 4H Camarilla H4, weekly pivot, 4H Flag: upper breakout line\)/);
  assert.match(map, /Demand zones \(buy area\):\n• 3864\.14–3867\.80 \(strong: 4H Camarilla L4\)/);
  assert.match(map, /• 3846\.49–3850\.00 \(weak\)/, "no metric names (an older analysis): the strength alone");
  assert.match(map, /Structure: H4 down \(LH\/LL\) · H1 down \(LH\/LL\) · 15m up \(HH\/HL\)/);
  assert.ok(map.length <= 500, `${map.length}`);
  assert.ok(!/\n\n\n/.test(map), "no double blank line where an optional line was dropped");
  const [forming, confirmed] = postablePatterns(a);
  const f = patternText(forming, a), c = patternText(confirmed, a);
  assert.match(f, /Pattern forming · XAUUSD H4\nThree Falling Peaks\n/);
  assert.doesNotMatch(f + c, /Bulkowski|catalogue|ch\. \d/);
  assert.match(f, /confirms upward on an H4 close above 3927\.20, or downward on a close below 3856\.70/);
  assert.match(c, /Pattern breakout · XAUUSD H4\nDescending Broadening Wedge .* direction up/);
  assert.match(c, /The pattern fails if an H4 candle closes back below 3719\.57/);
  assert.match(c, /Measured projection: 4020\.50 \(analysis, not a trade objective\)/);
  const drafts = analysisDrafts(a, { now: AT, levelsRun: true, channels: ["threads"] });
  assert.deepEqual(drafts.map((d) => [d.kind, d.status, d.guardian.pass]), [["key_levels", "pending", true], ["pattern", "pending", true]], "confirmed patterns only (owner 2026-11-25: \"Only confirmed\"); a forming one, H1 or H4, is not drafted");
  assert.match(drafts[1].text, /Pattern breakout/);
  for (const d of drafts) assert.ok(!/\b(entry|SL|TP\d?|BUY|SELL|stop loss|take profit)\b/.test(d.text), d.text);
});

test("pattern posts: once per pattern and status, at most four a day per channel; the desk answers both", () => {
  const a = publicAnalysis({ ...KEY_LEVELS, patterns: Array.from({ length: 6 }, (_, i) => ({ tf: "240", id: "flag", status: "confirmed", direction: 1, upper: 3900 + i * 10, lower: 3880 + i * 10, target: 3950 })) }, { now: AT });
  const first = analysisDrafts(a, { now: AT, channels: ["threads"] });
  assert.equal(first.length, MAX_PATTERN_DRAFTS_PER_DAY);
  const known = new Set(first.map((d) => d.id));
  assert.equal(analysisDrafts(a, { now: AT, channels: ["threads"], known, postedToday: { threads: 4 } }).length, 0);
  assert.equal(analysisDrafts(a, { now: AT, channels: ["threads"], known, postedToday: { threads: 2 } }).length, 2, "the two not yet drafted");
  const sql = sqlite();
  addDrafts(sql, first, { now: AT });
  assert.equal(draftIdsWithPrefix(sql, "pattern:").length, 4);
  assert.deepEqual(kindCountsSince(sql, "pattern", "2026-11-16"), { threads: 4 });
  assert.deepEqual(kindCountsSince(sql, "pattern", "2026-11-17"), {});
});

test("UTC clock times read in 12-hour form (owner 2026-11-17: AM/PM)", async () => {
  const { clock12 } = await import("../src/drafts.mjs");
  assert.deepEqual(["2026-11-17T00:05:00Z", "2026-11-17T06:09:00Z", "2026-11-17T12:00:00Z", "2026-11-17T17:27:00Z", "bad"].map(clock12), ["12:05 AM", "6:09 AM", "12:00 PM", "5:27 PM", "?"]);
});

test("RT1 posts without a delay (owner 2026-11-25: \"Posts juga realtime\"): PUBLIC_DELAY_HOURS 0 lets a fresh decision through too_recent; every other check stays", async () => {
  const { checkContentDraft } = await import("../src/guardian.mjs");
  const { delayOf } = await import("../src/app.mjs");
  const now = Date.parse("2026-11-25T12:00:00Z");
  const fresh = ["2026-11-25T11:59:00Z"]; // a decision closed a minute ago
  const ok = "Education · XAUUSD recap\n\nThe room read the 15-minute chart as bearish.\n\nNot financial advice.";
  const fails = (o) => checkContentDraft({ text: ok, now, decisionTimes: fresh, ...o }).failures.map((f) => f.check);
  assert.deepEqual(fails({ delayHours: 0 }), [], "delay 0: a decision a minute old passes");
  assert.deepEqual(fails({ delayHours: 24 }), ["too_recent"], "24 restores the old hold");
  for (const bad of [undefined, null, "", "x", -1, NaN]) assert.deepEqual(fails({ delayHours: bad }), ["too_recent"], `invalid ${String(bad)}: 24`);
  assert.deepEqual(fails({ delayHours: 0, decisionTimes: ["2026-11-25T12:30:00Z"] }), ["too_recent"], "a decision from the future still fails");
  assert.deepEqual(fails({ delayHours: 0, decisionTimes: ["not a time"] }), ["too_recent"], "an unreadable time still fails");
  // With no delay, the price, signal-word, instruction and account checks still fail as before.
  const at0 = (text) => checkContentDraft({ text: `Education · ${text}\n\nNot financial advice.`, now, decisionTimes: fresh, delayHours: 0 }).failures.map((f) => f.check);
  assert.ok(at0("Gold closed near 4021.5 today.").includes("price_level"));
  assert.ok(at0("Entry at the zone, SL below it.").includes("signal_words"));
  assert.ok(at0("BUY gold now.").includes("signal_words"));
  assert.ok(at0("Buy now before it runs.").includes("instruction"));
  assert.ok(at0("Our account balance grew.").includes("account_data"));
  // The var: "0" is 0, "24" is 24, unset, empty or invalid is 24.
  assert.equal(delayOf({ PUBLIC_DELAY_HOURS: "0" }), 0);
  assert.equal(delayOf({ PUBLIC_DELAY_HOURS: "24" }), 24);
  for (const v of [undefined, null, "", " ", "x", "-1"]) assert.equal(delayOf({ PUBLIC_DELAY_HOURS: v }), 24, `"${v}"`);
  assert.equal(delayOf(undefined), 24);
  const cfg = JSON.parse((await import("node:fs")).readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8").replace(/^\s*\/\/.*$/gm, ""));
  assert.equal(cfg.vars.PUBLIC_DELAY_HOURS, "0", "the deployed var: no delay");
});

test("a confirmed pattern is posted once while xauusd keeps it, even as its lines move (owner 2026-11-25)", () => {
  // The 15:15 and 17:09 UTC runs of 25 Nov: the same H1 rounding top read 3690:3571, then 3690:3575, and was posted twice.
  const p = (upper, lower, extra = {}) => ({ tf: "60", id: "rounding_top", status: "confirmed", direction: -1, upper, lower, target: 3500, ...extra });
  const at1 = Date.parse("2026-11-25T15:09:30Z"), at2 = Date.parse("2026-11-25T17:09:30Z");
  const first = analysisDrafts(publicAnalysis({ ...KEY_LEVELS, patterns: [p(3690.2, 3571.4)] }, { now: at1 }), { now: at1, channels: ["threads", "telegram"] }).filter((d) => d.kind === "pattern");
  assert.deepEqual(first.map((d) => d.id), ["pattern:H1:rounding_top:confirmed:3690:3571:threads", "pattern:H1:rounding_top:confirmed:3690:3571:telegram"]);
  const sql = sqlite();
  addDrafts(sql, first, { now: at1 });
  const history = draftsWithPrefixSince(sql, "pattern:", new Date(at2 - PATTERN_LOOKBACK_MS).toISOString());
  assert.equal(history.length, 2);
  const later = publicAnalysis({ ...KEY_LEVELS, patterns: [p(3690.4, 3575.2), p(3602, 3479, { id: "broadening_right_angled_descending" })] }, { now: at2 });
  const again = analysisDrafts(later, { now: at2, channels: ["threads", "telegram"], history }).filter((d) => d.kind === "pattern");
  assert.deepEqual(again.map((d) => d.id), ["pattern:H1:broadening_right_angled_descending:confirmed:3602:3479:threads", "pattern:H1:broadening_right_angled_descending:confirmed:3602:3479:telegram"], "the moved rounding top is not posted again; a different pattern is");
  // A channel that never had it still gets it; a band that does not overlap is a new pattern; a forming one is another status.
  assert.equal(patternDrafted({ chart: "H1", pattern: "rounding_top", status: "confirmed", upper: 3690, lower: 3575 }, "instagram", history, at2), false);
  assert.equal(patternDrafted({ chart: "H1", pattern: "rounding_top", status: "confirmed", upper: 3420, lower: 3300 }, "threads", history, at2), false);
  assert.equal(patternDrafted({ chart: "H1", pattern: "rounding_top", status: "forming", upper: 3690, lower: 3575 }, "threads", history, at2), false);
  assert.equal(patternDrafted({ chart: "H4", pattern: "rounding_top", status: "confirmed", upper: 3690, lower: 3575 }, "threads", history, at2), false);
  // After 120 bars of its chart (5 days on H1) the same band may be posted again.
  assert.equal(patternDrafted({ chart: "H1", pattern: "rounding_top", status: "confirmed", upper: 3690, lower: 3575 }, "threads", history, at1 + 121 * 3_600_000), false);
  assert.equal(patternDrafted({ chart: "H1", pattern: "rounding_top", status: "confirmed", upper: 3690, lower: 3575 }, "threads", history, at1 + 119 * 3_600_000), true);
  assert.deepEqual(patternOfId("pattern:D1:flag:confirmed:4020:3980:threads"), { chart: "D1", pattern: "flag", status: "confirmed", upper: 4020, lower: 3980, channel: "threads" });
  assert.equal(patternOfId("manual:2026-11-24:b50daba1:threads"), null);
});

test("Threads: the failing step is named; an image settles 10 s; \"does not exist\" is retried on the same container; never posted twice", async () => {
  // 26 Nov, 00:10 and 09:10 UTC: "400 The requested resource does not exist" about 4 s after Meta fetched the card.
  const missing = () => new Response(JSON.stringify({ error: { message: "The requested resource does not exist", code: 100, error_subcode: 33 } }), { status: 400 });
  const meta = ({ status = [], publish = [], state = "FINISHED", list = [], create = null } = {}) => {
    const calls = [];
    const fetcher = async (url, init) => {
      const u = new URL(url); const body = init.body ? Object.fromEntries(new URLSearchParams(init.body)) : {};
      calls.push({ method: init.method, path: u.pathname, fields: u.searchParams.get("fields"), body });
      if (u.pathname.endsWith("/me")) return Response.json({ id: "9" });
      if (init.method === "POST" && u.pathname.endsWith("/9/threads")) return create ? create() : Response.json({ id: "c1" });
      if (init.method === "POST" && u.pathname.endsWith("/threads_publish")) { const f = publish.shift(); return f ? f() : Response.json({ id: "p1" }); }
      if (u.pathname.endsWith("/c1") && u.searchParams.get("fields") === "status,error_message") { const f = status.shift(); return f ? f() : Response.json({ status: "FINISHED" }); }
      if (u.pathname.endsWith("/c1")) return Response.json({ status: state });
      if (init.method === "GET" && u.pathname.endsWith("/9/threads")) return Response.json({ data: list });
      return new Response("{}", { status: 404 });
    };
    return { calls, fetcher, publishes: () => calls.filter((c) => c.path.endsWith("/threads_publish")).length };
  };
  const acct = { user_id: "9", access_token: "T" };
  const card = "https://cta.cryptophys.work/media/0123456789abcdef0123456789abcdef.jpg";
  let clock = Date.parse("2026-11-26T09:10:00Z");
  const now = () => clock;
  const slept = [];
  const sleep = async (ms) => { slept.push(ms); clock += ms; };
  // An image: published no sooner than 10 s after its create, even when the status already reads FINISHED.
  const a = meta();
  assert.deepEqual(await publishThreads({ account: acct, text: "x", imageUrl: card, fetcher: a.fetcher, sleep, now }), { remote_id: "p1", container_id: "c1" });
  assert.deepEqual(slept, [THREADS_IMAGE_SETTLE_MS]);
  assert.equal(THREADS_IMAGE_SETTLE_MS, 10_000);
  slept.length = 0;
  // The status poll answers "does not exist" once: polled again after 10 s on the same container.
  const b = meta({ status: [missing] });
  assert.equal((await publishThreads({ account: acct, text: "x", fetcher: b.fetcher, sleep, now })).remote_id, "p1");
  assert.deepEqual([slept, b.calls.filter((c) => c.path.endsWith("/9/threads") && c.method === "POST").length], [[10_000], 1], "one container");
  slept.length = 0;
  // The publish answers "does not exist" once while the container reads FINISHED: published again, once.
  const c = meta({ publish: [missing] });
  assert.equal((await publishThreads({ account: acct, text: "x", fetcher: c.fetcher, sleep, now })).remote_id, "p1");
  assert.deepEqual([c.publishes(), slept], [2, [10_000]]);
  slept.length = 0;
  // Meta took the publish but answered an error: the container reads PUBLISHED, so no second publish; the post is found.
  const d = meta({ publish: [() => new Response("{}", { status: 500 })], state: "PUBLISHED", list: [{ id: "111", text: "y", timestamp: "2026-11-26T09:10:00+0000" }, { id: "222", text: "x", timestamp: new Date(clock).toISOString() }] });
  assert.deepEqual(await publishThreads({ account: acct, text: "x", fetcher: d.fetcher, sleep, now }), { remote_id: "222", container_id: "c1", recovered: true });
  assert.deepEqual([d.publishes(), slept], [1, []], "never posted twice");
  // Another error, or a container that is not FINISHED: no retry. Three "does not exist" in a row: the publish step fails.
  const e = meta({ publish: [() => new Response(JSON.stringify({ error: { message: "Invalid parameter", code: 100 } }), { status: 400 })] });
  await assert.rejects(publishThreads({ account: acct, text: "x", fetcher: e.fetcher, sleep, now }), (err) => err.step === "publish" && /^threads publish: 400 Invalid parameter/.test(err.message));
  assert.equal(e.publishes(), 1);
  const f = meta({ publish: [missing], state: "IN_PROGRESS" });
  await assert.rejects(publishThreads({ account: acct, text: "x", fetcher: f.fetcher, sleep, now }), /threads publish/);
  assert.equal(f.publishes(), 1, "no retry unless the container reads FINISHED");
  slept.length = 0;
  const g = meta({ publish: [missing, missing, missing] });
  await assert.rejects(publishThreads({ account: acct, text: "x", fetcher: g.fetcher, sleep, now }), (err) => err.step === "publish" && err.code === 100 && err.subcode === 33);
  assert.deepEqual([g.publishes(), slept], [3, THREADS_MISSING_RETRY_MS]);
  // The create step is named too.
  const h = meta({ create: () => new Response(JSON.stringify({ error: { message: "Bad image", code: 9004 } }), { status: 400 }) });
  await assert.rejects(publishThreads({ account: acct, text: "x", imageUrl: card, fetcher: h.fetcher, sleep, now }), (err) => err.step === "create" && /^threads create: 400 Bad image/.test(err.message));
});

test("the recap window follows the projection's delay: the last 24 hours at 0 (owner 2026-11-26: \"1.a\"); a reply cut at 50 rows drafts nothing", () => {
  const now = Date.parse("2026-11-26T22:17:00Z");
  assert.deepEqual(recapSpan(now, 0), { from: "2026-11-25T22:17:00.000Z", to: "2026-11-26T22:17:00.000Z" });
  assert.deepEqual(recapSpan(now, 24), { from: "2026-11-24T22:17:00.000Z", to: "2026-11-25T22:17:00.000Z" });
  for (const d of [0, 24, 6]) { const w = recapSpan(now, d); assert.equal(Date.parse(w.to) - Date.parse(w.from), 24 * 3_600_000, "exactly 24 hours"); }
  assert.deepEqual(recapSpan(now, "x"), recapSpan(now, 24), "an unreadable delay keeps 24");
  const bars = (endMs, n) => Array.from({ length: n }, (_, i) => ({ bar_close: new Date(endMs - i * 15 * 60_000).toISOString(), stance: i % 3 ? "WAIT" : "BUY", bias: "NEUTRAL", session: "london" }));
  // Delay 0: the 96 bars of the last 24 hours.
  const live = dailyDrafts(bars(now - 60_000, 96), { now, channels: ["threads"], delayHours: 0, windowDelayHours: 0 });
  assert.equal(live.summary.bars, 96);
  assert.equal(live.drafts.length, 1);
  assert.equal(live.drafts[0].id, "daily:2026-11-26:threads");
  assert.equal(live.drafts[0].guardian.pass, true, JSON.stringify(live.drafts[0].guardian));
  // Delay 24: the bars 48 to 24 hours ago, as before.
  const held = dailyDrafts(bars(now - 24 * 3_600_000 - 60_000, 96), { now, channels: ["threads"], windowDelayHours: 24 });
  assert.equal(held.summary.bars, 96);
  // The old 50-row cap (before xauusd RC1): 50 bars that stop 12.5 hours short of the window's start draft nothing.
  const cut = dailyDrafts(bars(now - 60_000, RECAPS_OLD_CAP), { now, channels: ["threads"], windowDelayHours: 0 });
  assert.deepEqual([cut.drafts.length, cut.summary.cut, cut.summary.bars], [0, true, 0]);
  assert.equal(recapsCut(bars(now - 60_000, 40), recapSpan(now, 0).from), false, "a short day is not a cut reply");
});

test("a measured projection that is not sane is left out of the post and the card (2026-11-27: a gap went out with \"Measured projection: 0.00\")", () => {
  const at = Date.parse("2026-11-27T07:09:30Z");
  const gap = (projection, extra = {}) => ({ chart: "H1", pattern: "gap", name: "Gap", status: "confirmed", direction: "up", upper: 3631.57, lower: 3627.36, projection, ...extra });
  const analysis = (p) => ({ at: "2026-11-27T07:09:00.000Z", price: 3662.35, zones: [], patterns: [p], structure: {} });
  // The 07:09 post: projection 0 → no projection line, no arrow on the card; the breakout and its undo stay.
  const t0 = patternText(gap(0), analysis(gap(0)), { channel: "threads" });
  assert.doesNotMatch(t0, /Measured projection/);
  assert.match(t0, /Breakout line 3631\.57/);
  assert.match(t0, /closes back below 3627\.36/);
  assert.equal(overlayOf(analysis(gap(0)), { pattern: gap(0) }).pattern.projection, null);
  // Not sane: below 0, not a number, more than 50% from the price, or on the wrong side of the breakout.
  for (const bad of [-5, NaN, null, undefined, 6000, 1500, 3600]) assert.equal(saneProjection(gap(bad), 3662.35), null, String(bad));
  assert.equal(saneProjection({ ...gap(3700), direction: "down", lower: 3627.36 }, 3662.35), null, "down but above the lower line");
  // Sane: kept, in the text and on the card.
  assert.equal(saneProjection(gap(3720.5), 3662.35), 3720.5);
  assert.match(patternText(gap(3720.5), analysis(gap(3720.5)), { channel: "threads" }), /Measured projection: 3720\.50 \(analysis, not a trade objective\)\./);
  assert.equal(overlayOf(analysis(gap(3720.5)), { pattern: gap(3720.5) }).pattern.projection, 3720.5);
  assert.equal(saneProjection({ ...gap(3500), direction: "down", upper: 3631.57, lower: 3600 }, 3590), 3500);
  assert.equal(PROJECTION_MAX_SHARE, 0.5);
  // The head-and-shoulders bottom of 02:09 (3776.67 from 3600.59) stays.
  assert.equal(saneProjection({ direction: "up", upper: 3579.71, lower: 3426.81, projection: 3776.67 }, 3600.59), 3776.67);
  void at;
});

test("one pattern post per chart and breakout band: two catalogue names on the same lines post once, the first by catalogue order", () => {
  // 27 Nov 08:10Z: H4 measured_move_up and diamond_bottom, both 3607.25 / 3552.14, both went out on Threads.
  const at = Date.parse("2026-11-27T07:09:30Z");
  const pat = (pattern, name, chapter, upper, lower, extra = {}) => ({ chart: "H4", pattern, name, chapter, status: "confirmed", direction: "up", upper, lower, projection: 3732.58, ...extra });
  const analysis = (patterns) => ({ at: new Date(at).toISOString(), price: 3662.35, zones: [], patterns });
  const both = [pat("measured_move_up", "Measured Move Up", 30, 3607.25, 3552.14), pat("diamond_bottom", "Diamond Bottom", 12, 3607.25, 3552.14)];
  const ids = (a, opts = {}) => analysisDrafts(a, { now: at, channels: ["threads", "telegram"], ...opts }).filter((d) => d.kind === "pattern").map((d) => d.id);
  assert.deepEqual(ids(analysis(both)), ["pattern:H4:diamond_bottom:confirmed:3607:3552:threads", "pattern:H4:diamond_bottom:confirmed:3607:3552:telegram"], "the lower chapter takes the band, on each channel");
  // within the tolerance (a tenth of the height, at least 1): the same band; outside it, another pattern
  assert.equal(PATTERN_BAND_SHARE, 0.1);
  assert.equal(sameBand(both[0], { ...both[1], upper: 3610.5, lower: 3549 }), true);
  assert.equal(sameBand(both[0], { ...both[1], upper: 3640, lower: 3552.14 }), false);
  assert.equal(sameBand(both[0], { ...both[1], chart: "H1" }), false, "another chart");
  assert.equal(sameBand(both[0], { ...both[1], status: "forming" }), false, "another status");
  assert.deepEqual(ids(analysis([both[0], pat("flag", "Flag", 23, 3700, 3680)])).filter((x) => x.endsWith(":threads")), ["pattern:H4:flag:confirmed:3700:3680:threads", "pattern:H4:measured_move_up:confirmed:3607:3552:threads"], "different bands both post, in catalogue order");
  // a later run: the band was posted under one name; another name on it is not posted
  const history = [{ id: "pattern:H4:diamond_bottom:confirmed:3607:3552:threads", created_at: new Date(at).toISOString() }];
  const later = at + 3_600_000;
  assert.equal(bandDrafted(both[0], "threads", history, later), true);
  assert.equal(bandDrafted(both[0], "telegram", history, later), false, "per channel");
  assert.deepEqual(analysisDrafts(analysis([both[0]]), { now: later, channels: ["threads"], history }).filter((d) => d.kind === "pattern"), []);
  // past the chart's lookback the band is free again
  assert.equal(bandDrafted(both[0], "threads", history, at + PATTERN_LOOKBACK_MS + 1), false);
});

test("M15 confirmed patterns are posted at the hourly run with no daily cap (owner 2026-11-27); H1, H4, D1 keep theirs", () => {
  // "tambah content per 1h jika ada pattern 15m confirmed juga diposting"; cap: "Tanpa batas khusus".
  const at = Date.parse("2026-11-27T09:09:30Z");
  const pat = (chart, pattern, upper, lower, extra = {}) => ({ chart, pattern, name: pattern, chapter: null, status: "confirmed", direction: "up", upper, lower, projection: upper + (upper - lower), ...extra });
  const analysis = { at: new Date(at).toISOString(), price: 3662.35, zones: [], patterns: [pat("M15", "flag", 3660.5, 3655.2), pat("M15", "pennant", 3670, 3664), pat("H1", "rectangle", 3640, 3620, { projection: 3680 }), pat("M15", "wedge_falling", 3655, 3640, { status: "forming" })] };
  assert.deepEqual(UNCAPPED_PATTERN_CHARTS, ["M15"]);
  const ids = (opts = {}) => analysisDrafts(analysis, { now: at, channels: ["threads"], ...opts }).filter((d) => d.kind === "pattern").map((d) => d.id);
  assert.deepEqual(ids(), ["pattern:M15:flag:confirmed:3661:3655:threads", "pattern:M15:pennant:confirmed:3670:3664:threads", "pattern:H1:rectangle:confirmed:3640:3620:threads"], "a forming M15 is not drafted");
  // the day's cap of the other charts is spent: M15 still posts, H1 does not
  assert.deepEqual(ids({ postedToday: { threads: MAX_PATTERN_DRAFTS_PER_DAY } }), ["pattern:M15:flag:confirmed:3661:3655:threads", "pattern:M15:pennant:confirmed:3670:3664:threads"]);
  const text = analysisDrafts(analysis, { now: at, channels: ["threads"] }).find((d) => d.id.startsWith("pattern:M15:flag")).text;
  assert.match(text, /XAUUSD M15/);
  assert.match(text, /fails if an M15 candle closes back below 3655\.20/);
  // read back, and posted once: 120 M15 bars (30 hours) of history
  assert.deepEqual(patternOfId("pattern:M15:flag:confirmed:3661:3655:threads"), { chart: "M15", pattern: "flag", status: "confirmed", upper: 3661, lower: 3655, channel: "threads" });
  assert.equal(patternLookbackMs("M15"), 30 * 3_600_000);
  const history = [{ id: "pattern:M15:flag:confirmed:3661:3655:threads", created_at: new Date(at - 3_600_000).toISOString() }];
  assert.ok(!ids({ history }).some((x) => x.startsWith("pattern:M15:flag")), "not posted again while xauusd keeps it");
  // the desk's daily count leaves M15 out, so it never takes the other charts' room
  const sql = sqlite();
  addDrafts(sql, analysisDrafts(analysis, { now: at, channels: ["threads"] }).filter((d) => d.kind === "pattern"), { now: at });
  assert.deepEqual(kindCountsSince(sql, "pattern", "2026-11-27", "pattern:M15:"), { threads: 1 });
  assert.deepEqual(kindCountsSince(sql, "pattern", "2026-11-27"), { threads: 3 });
});
