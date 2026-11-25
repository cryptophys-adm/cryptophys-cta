// The CTA agent's Checks skill (owner 2026-11-25: "setuju semua, mulai dari Checks"; the mockup "CTA Studio: the Agent
// page"): the Threads linter and the humanizer ported from instagram-agent-skill (MIT), the topic tag that replaces the
// Threads hashtag line, and the studio's read-only Agent page. Posts still come from the xauusd templates.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SLOP } from "../src/agent/slop.mjs";
import { cleanInvisible, humanScore, jsRegex, HUMAN_CHECKS } from "../src/agent/humanizer.mjs";
import { lintThreads, threadsText, threadsLength, validTopicTag, THREADS_TOPIC_TAG, THREADS_LIMIT } from "../src/agent/lint.mjs";
import { agentChecks, AGENT_SKILLS } from "../src/agent/checks.mjs";
import { auditChannel, planChannel, bestHours, wibWeekStart, MIN_FINDING } from "../src/agent/audit.mjs";
import { rulesOf, agentChannels, AGENT_CHANNELS, TOPIC_TAGS } from "../src/agent/rules.mjs";
import { lintPost, textFor } from "../src/agent/lint.mjs";
import { CHANNELS } from "../src/channels.mjs";
import { askModel, modelConfig, costOf, wibDayStartIso, MODEL_DEFAULTS, AGENT_SECRETS } from "../src/agent/router.mjs";
import { weeklySummary, summaryOk, summaryKey } from "../src/agent/weekly.mjs";
import { publishThreads } from "../src/publishers.mjs";
import { HASHTAGS } from "../src/channels.mjs";
import { keyLevelsText } from "../src/analysis-drafts.mjs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const POST = "Education · XAUUSD key-level map · Wednesday, 25 November 2026 1:41 AM UTC\nPrice when read: 3544.30\n\nSupply zones (sell area):\n• 3595.29–3600.00 (4H swing high)\n\nChart by TradingView.\nEducational analysis by Cryptophys. Not an invitation to buy or sell, and not financial advice.\n#XAUUSD #gold #education";

test("AG1 the humanizer: the lexicon as taken (MIT, credited), every pattern compiles, invisible characters go and words stay", () => {
  assert.equal(SLOP.words.length + SLOP.phrases.length, 154, "the 154 stock words and phrases of slop.json v1.0");
  assert.equal(SLOP.structures.length, 16);
  for (const s of SLOP.structures) assert.ok(jsRegex(s.regex) instanceof RegExp, s.id);
  assert.match(jsRegex("[\\U0001F680\\U0001F525]").source, /\\u\{1F680\}/, "Python's \\U escapes become \\u{...}");
  assert.match(read("src/agent/LICENSE-instagram-agent-skill"), /MIT License[\s\S]*Copyright \(c\) 2026 Jake Schincariol/);
  for (const f of ["src/agent/slop.mjs", "src/agent/humanizer.mjs", "src/agent/lint.mjs"]) assert.match(read(f), /LICENSE-instagram-agent-skill/, `${f} credits the source`);
  assert.deepEqual(cleanInvisible("gold​ held its⁠ range﻿"), { text: "gold held its range", removed: 4 });
  assert.deepEqual(cleanInvisible(POST), { text: POST, removed: 0 }, "a template post is untouched");
  const bad = humanScore("Stop scrolling! In today's video I'm going to show you how to delve into gold — it's not just a metal, it's a robust, seamless and crucial asset.​ #viral #fyp #gold #a #b #c");
  assert.equal(bad.verdict, "FLAGGED");
  assert.match(bad.checks.slop.detail, /delve/);
  assert.match(bad.checks.voice.detail, /not-just/);
  assert.deepEqual(Object.keys(bad.checks), [...HUMAN_CHECKS]);
  const ours = humanScore(POST);
  assert.equal(ours.checks.slop.score, 100, "no stock vocabulary in the template");
  assert.equal(ours.checks.fingerprint.score, 100);
});

test("AG2 the Threads linter: 500 characters (an emoji by its bytes), one topic tag, at most 5 links, the first line", () => {
  assert.equal(THREADS_LIMIT, 500);
  assert.equal(threadsLength("ab🔥"), 6, "an emoji counts its UTF-8 bytes");
  assert.equal(THREADS_TOPIC_TAG, "XAUUSD");
  assert.ok(validTopicTag("XAUUSD")); assert.ok(!validTopicTag("")); assert.ok(!validTopicTag("a.b")); assert.ok(!validTopicTag("a&b")); assert.ok(!validTopicTag("x".repeat(51)));
  const ok = lintThreads(threadsText(POST));
  assert.equal(ok.verdict, "READY", JSON.stringify(ok.checks));
  const tagged = lintThreads(POST);
  assert.equal(tagged.checks.find((c) => c.check === "TOPIC TAG").status, "WARN", "in-text hashtags: Threads uses only the first");
  const st = (t, check) => lintThreads(t).checks.find((c) => c.check === check).status;
  assert.equal(st("x".repeat(501), "LENGTH"), "FAIL");
  assert.equal(st("#gold first\nthen", "FIRST LINE"), "FAIL");
  assert.equal(st("Education\n" + Array.from({ length: 6 }, (_, i) => `https://e${i}.com/`).join(" "), "LINKS"), "FAIL");
  assert.equal(st("Education — gold", "EM DASH"), "WARN");
  assert.equal(st("Education​ gold", "INVISIBLE"), "WARN");
  assert.equal(lintThreads("Education", { topicTag: "" }).checks.find((c) => c.check === "TOPIC TAG").status, "FAIL");
});

test("AG3 the topic tag: Threads drafts carry no hashtag line, and Threads gets topic_tag XAUUSD with the words unchanged", async () => {
  assert.equal(HASHTAGS.threads, "", "owner 2026-11-25: one topic tag instead");
  for (const c of ["instagram", "x", "telegram", "youtube", "tiktok"]) assert.match(HASHTAGS[c], /^#XAUUSD/, `${c} keeps its hashtags`);
  const draft = keyLevelsText({ at: "2026-11-17T07:09:00.000Z", price: 4080.5, zones: [{ role: "supply", low: 4098.2, high: 4102.6, strength: "strong", metrics: ["4H Camarilla H4"] }] }, { channel: "threads" });
  assert.equal(typeof draft, "string");
  assert.doesNotMatch(draft, /#/, "a Threads key-level map has no hashtag line");
  assert.match(draft, /not financial advice\.$/, "it ends on the disclaimer");
  assert.equal(threadsText(POST), POST.replace("\n#XAUUSD #gold #education", ""), "an older draft's hashtag line goes; nothing else changes");
  assert.equal(threadsText("Education\n\n#gold is up"), "Education\n\n#gold is up", "a line with words stays");
  const calls = [];
  const fetcher = async (url, init) => {
    const u = String(url), body = init?.body ? Object.fromEntries(new URLSearchParams(String(init.body))) : {};
    calls.push({ url: u, body });
    if (u.includes("/me")) return Response.json({ id: "77" });
    if (u.endsWith("/threads")) return Response.json({ id: "c1" });
    if (u.includes("/c1")) return Response.json({ status: "FINISHED" });
    return Response.json({ id: "p1" });
  };
  await publishThreads({ account: { user_id: "77", access_token: "T" }, text: POST, fetcher, sleep: async () => {} });
  const create = calls.find((c) => c.url.endsWith("/threads"));
  const body = Object.keys(create.body).length ? create.body : Object.fromEntries(new URL(create.url).searchParams);
  assert.equal(body.topic_tag, "XAUUSD");
  assert.equal(body.text, threadsText(POST));
  const dry = await publishThreads({ account: { user_id: "77", access_token: "T" }, text: POST, dryRun: true });
  assert.equal(dry.requests[0].params.topic_tag, "XAUUSD", "the studio's dry run shows the tag");
  assert.doesNotMatch(dry.requests[0].params.text, /#gold/);
});

test("AG4 the Agent page: Threads drafts only, read only, each with its Threads text, linter and humanizer", () => {
  const drafts = [
    { id: "a", channel: "threads", kind: "key_levels", status: "pending", created_at: "2026-11-25T01:09:00Z", text: POST },
    { id: "b", channel: "telegram", kind: "key_levels", status: "pending", text: POST },
    { id: "c", channel: "threads", kind: "pattern", status: "published", text: "x".repeat(520) }
  ];
  const a = agentChecks(drafts);
  assert.deepEqual(a.checks.map((c) => c.id), ["a", "c"]);
  assert.equal(a.checks[0].text, threadsText(POST));
  assert.deepEqual(a.summary, { checked: 2, ready: 1, review: 0, fix: 1, human_pass: a.checks.filter((c) => c.human.verdict === "PASS").length });
  assert.equal(a.topic_tag, "XAUUSD");
  assert.deepEqual(AGENT_SKILLS.map((s) => [s.id, s.live]), [["linter", true], ["humanizer", true], ["audit", true], ["plan", true], ["replies", false]]);
  const html = read("public/studio/index.html"), js = read("public/studio/studio.js"), app = read("src/app.mjs");
  assert.match(html, /<a href="#agent" data-view="agent">/);
  assert.match(html, /id="view-agent"/);
  assert.match(js, /"performance", "agent", "channels"\]/);
  assert.match(js, /call\(`\/api\/studio\/agent\?channel=\$\{encodeURIComponent\(agentChannel\)\}`\)/);
  assert.match(app, /route === "GET \/api\/studio\/agent"/, "a GET: it changes nothing");
  assert.doesNotMatch(js, /innerHTML/, "text goes in as text");
});

test("AG5 Audit and Plan: the last full WIB week against our own median, findings only from enough posts, slots at measured hours", () => {
  const NOW = Date.parse("2026-11-25T05:00:00Z"); // Wednesday 12:00 WIB
  assert.equal(new Date(wibWeekStart(NOW)).toISOString(), "2026-11-22T17:00:00.000Z", "Monday 23 Nov 00:00 WIB");
  const post = (id, kind, at, views, extra = {}) => ({ id, kind, channel: "threads", text: `Education · ${id}\nmore`, published_at: at, metrics: { views, comments: 1, reposts: 0, likes: 2, ...extra } });
  const posts = [
    // the audited week: Monday 16 to Sunday 22 November (WIB)
    post("w1", "warroom", "2026-11-18T12:30:00Z", 4000, { comments: 9 }), post("w2", "warroom", "2026-11-19T12:30:00Z", 3000), post("w3", "warroom", "2026-11-20T12:30:00Z", 5000),
    post("k1", "key_levels", "2026-11-18T01:15:00Z", 1000), post("k2", "key_levels", "2026-11-19T01:15:00Z", 900), post("k3", "key_levels", "2026-11-20T01:15:00Z", 1100),
    post("r1", "daily_recap", "2026-11-18T22:30:00Z", 300),
    // the weeks before it
    ...Array.from({ length: 6 }, (_, i) => post(`o${i}`, "pattern", `2026-11-0${i + 2}T01:15:00Z`, 1000)),
    // this week, not audited yet; and another channel
    post("now", "warroom", "2026-11-24T12:30:00Z", 99999), { ...post("tg", "warroom", "2026-11-18T12:30:00Z", 50000), channel: "telegram" }
  ];
  const a = auditChannel(posts, { now: NOW });
  assert.deepEqual([a.week.from, a.week.to], ["2026-11-15T17:00:00.000Z", "2026-11-22T17:00:00.000Z"]);
  assert.equal(a.median_views, 1000, "the median of the 28 days before the week ended, Threads only");
  assert.deepEqual(a.posts.map((p) => p.id), ["w3", "w1", "w2", "k3", "k1", "k2", "r1"], "by multiple; this week's and Telegram's left out");
  assert.equal(a.posts[0].multiple, 5);
  assert.deepEqual(a.kinds.map((k) => [k.kind, k.posts, k.median_multiple]), [["warroom", 3, 4], ["key_levels", 3, 1], ["daily_recap", 1, 0.3]]);
  assert.equal(MIN_FINDING, 3);
  assert.deepEqual(a.findings, ["War Room: 4× the median over 3 posts, 11 replies and 0 reposts.", "Key-level map: 1× the median over 3 posts.", "Daily recap: 1 post, too few to call.", "7 posts this week, 15 replies in all."]);
  assert.deepEqual(auditChannel([], { now: NOW }).findings, ["No measured post on this channel yet: the audit starts once the daily metrics have read some."]);
  assert.deepEqual(auditChannel(posts, { channel: "telegram", now: NOW }).posts.map((p) => p.id), ["tg"], "the same audit for another channel");
  assert.deepEqual(bestHours(posts, { now: NOW }).map((h) => [h.time, h.posts]), [["19:00", 4], ["08:00", 9]], "WIB hours with 2 or more posts in the last 28 days, by median views");
  const p = planChannel(a, posts, { now: NOW, schedule: [{ days: ["mon"], time: "08:00" }] });
  assert.deepEqual(p.mix.map((m) => [m.kind, m.advice]), [["warroom", "post more"], ["key_levels", "keep"], ["daily_recap", "keep"]]);
  assert.deepEqual(p.slots.map((s) => [s.time, s.days.length]), [["19:00", 7]], "08:00 is already a slot");
  assert.match(planChannel(auditChannel([], { now: NOW }), [], { now: NOW }).note, /No hour has 2 measured posts/);
  const js = read("public/studio/studio.js");
  assert.match(js, /call\("\/api\/studio\/settings", "POST", \{ channel, settings: \{ \.\.\.cur, schedule \} \}\)/, "a slot is added to the shown channel through the settings route (approver, same origin)");
});

test("AG6 the model router: the key, the switch, the daily cap, Reflection's refusals, retention, and a log without text", async () => {
  const store = () => {
    const s = { settings: {}, calls: [] };
    return { s, setting: async (k) => (s.settings[k] ? { value: s.settings[k], updated_by: "x", updated_at: "t" } : null), saveSetting: async (i) => { s.settings[i.key] = i.value; return true; },
      record: async (c) => { s.calls.push(c); return true; }, spendSince: async () => ({ calls: s.calls.length, tokens_in: 0, tokens_out: 0, cost_usd: s.calls.reduce((a, c) => a + (c.cost_usd || 0), 0) }), recent: async () => s.calls };
  };
  const env = { REFLECTION_API_KEY: "rk-test" };
  const msgs = [{ role: "user", content: "hi" }];
  const answer = (status, body, retention = "zero") => async (url, init) => { answer.last = { url, init }; return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "reflection-data-retention": retention } }); };
  assert.deepEqual(MODEL_DEFAULTS, { base: "https://api.reflection.ai/openai/v1", model: "Beam-1.0-501B-A23B", daily_usd: 1, price_in: 0.4, price_out: 1.2 });
  assert.deepEqual(AGENT_SECRETS, ["REFLECTION_API_KEY"]);
  assert.deepEqual(await askModel({}, store(), { purpose: "t", messages: msgs, fetcher: () => { throw new Error("no call"); } }), { ok: false, skipped: "no_key" });
  const fresh = store();
  assert.deepEqual(await askModel(env, fresh, { purpose: "t", messages: msgs, fetcher: () => { throw new Error("no call"); } }), { ok: false, skipped: "off", reason: "not turned on yet" }, "off until an approver turns it on");
  const on = () => { const x = store(); x.s.settings.agent_model = { enabled: true }; return x; };
  const ok = on();
  const r = await askModel(env, ok, { purpose: "audit_summary", messages: msgs, fetcher: answer(200, { choices: [{ message: { content: " Fine. " } }], usage: { prompt_tokens: 1000, completion_tokens: 500 } }) });
  assert.deepEqual([r.ok, r.text, r.cost_usd, r.retention], [true, "Fine.", 0.001, "zero"], "$0.40 and $1.20 a million");
  const sent = JSON.parse(answer.last.init.body);
  assert.equal(answer.last.url, "https://api.reflection.ai/openai/v1/chat/completions");
  assert.equal(answer.last.init.headers.authorization, "Bearer rk-test");
  assert.deepEqual([sent.model, sent.reasoning_effort, sent.max_completion_tokens], ["Beam-1.0-501B-A23B", "low", 2000]);
  assert.deepEqual(ok.s.calls[0], { purpose: "audit_summary", model: "Beam-1.0-501B-A23B", status: "ok", retention: "zero", tokens_in: 1000, tokens_out: 500, cost_usd: 0.001 });
  assert.ok(!JSON.stringify(ok.s.calls).includes("Fine") && !JSON.stringify(ok.s.calls).includes("hi"), "the log keeps no text");
  const off = store(); off.s.settings.agent_model = { enabled: false, reason: "turned off in the studio" };
  assert.equal((await askModel(env, off, { purpose: "t", messages: msgs, fetcher: () => { throw new Error("no call"); } })).skipped, "off");
  const spent = on(); spent.s.calls.push({ cost_usd: 1 });
  assert.equal((await askModel(env, spent, { purpose: "t", messages: msgs, fetcher: () => { throw new Error("no call"); } })).skipped, "budget", "the daily cap");
  const train = on();
  assert.equal((await askModel(env, train, { purpose: "t", messages: msgs, fetcher: answer(200, { choices: [{ message: { content: "x" } }] }, "contributor") })).skipped, "retention");
  assert.equal(train.s.settings.agent_model.enabled, false, "contributor terms turn the model off");
  const broke = on();
  const b = await askModel(env, broke, { purpose: "t", messages: msgs, fetcher: answer(403, { error: { code: "prepaid_balance_exhausted" } }) });
  assert.deepEqual([b.ok, b.status, broke.s.calls[0].status, broke.s.calls[0].detail], [false, 403, "http_403", "prepaid_balance_exhausted"]);
  assert.equal(costOf(modelConfig({ MODEL_PRICE_IN: "0.25", MODEL_PRICE_OUT: "1" }), 2_000_000, 1_000_000), 1.5);
  assert.equal(modelConfig({ MODEL_BASE_URL: "http://plain" }).base, MODEL_DEFAULTS.base, "https only");
  assert.equal(wibDayStartIso(Date.parse("2026-11-25T05:00:00Z")), "2026-11-24T17:00:00.000Z");
});

test("AG7 the weekly summary: once a week, only the audit's facts, no added number and no trading words", async () => {
  assert.ok(summaryOk("War Room did best at 4× the median over 3 posts.", { kinds: [{ median_multiple: 4, posts: 3 }] }));
  assert.ok(!summaryOk("War Room did best at 5× the median.", { kinds: [{ median_multiple: 4 }] }), "a number not in the facts");
  assert.ok(!summaryOk("Buy more War Room posts.", {}), "a trading word");
  const NOW = Date.parse("2026-11-25T05:00:00Z");
  const posts = ["2026-11-18T12:30:00Z", "2026-11-19T12:30:00Z", "2026-11-20T12:30:00Z"].map((at, i) => ({ id: `w${i}`, kind: "warroom", channel: "threads", text: "Education · x", published_at: at, metrics: { views: 1000, comments: 1, reposts: 0 } }));
  const saved = { agent_model: { enabled: true } }, calls = [];
  const store = { setting: async (k) => (saved[k] ? { value: saved[k] } : null), saveSetting: async (i) => { saved[i.key] = i.value; }, record: async (c) => calls.push(c), spendSince: async () => ({ cost_usd: 0 }), recent: async () => [] };
  const fetcher = async () => new Response(JSON.stringify({ choices: [{ message: { content: "War Room held the median over 3 posts." } }], usage: { prompt_tokens: 10, completion_tokens: 10 } }), { headers: { "reflection-data-retention": "zero" } });
  const env = { REFLECTION_API_KEY: "rk" };
  assert.equal((await weeklySummary(env, store, posts, { now: NOW, fetcher })).status, "written");
  assert.deepEqual(saved[summaryKey("threads")], { week: "2026-11-15T17:00:00.000Z", text: "War Room held the median over 3 posts.", model: "beam" });
  assert.equal((await weeklySummary(env, store, posts, { now: NOW, fetcher: () => { throw new Error("no second call"); } })).status, "done_already");
  const bad = async () => new Response(JSON.stringify({ choices: [{ message: { content: "Sell gold now, 9× better." } }] }), { headers: { "reflection-data-retention": "zero" } });
  const other = { agent_model: { enabled: true } };
  const store2 = { ...store, setting: async (k) => (other[k] ? { value: other[k] } : null), saveSetting: async (i) => { other[i.key] = i.value; } };
  assert.equal((await weeklySummary(env, store2, posts, { now: NOW, fetcher: bad })).status, "summary_refused");
  assert.equal(other[summaryKey("threads")], undefined, "nothing kept");
  assert.equal((await weeklySummary(env, store2, [], { now: NOW, fetcher: bad })).status, "nothing_to_sum_up");
});

test("AG8 one agent for every channel (owner 2026-11-25): each channel's own rules, phase 1 manages Threads only", () => {
  assert.deepEqual(AGENT_CHANNELS, ["threads"], "phase 1: Threads; a channel joins in its own owner PR");
  assert.deepEqual(agentChannels().map((c) => [c.id, c.active]), CHANNELS.map((c) => [c, c === "threads"]));
  for (const c of CHANNELS) assert.ok(rulesOf(c)?.limit > 0, `${c} has rules`);
  assert.equal(rulesOf("nope"), null);
  assert.deepEqual(TOPIC_TAGS, { threads: "XAUUSD" });
  assert.deepEqual([rulesOf("threads").limit, rulesOf("instagram").limit, rulesOf("x").limit, rulesOf("telegram").limit], [500, 2200, 280, 4096], "from src/channels.mjs");
  const st = (c, t, check) => lintPost(c, t).checks.find((k) => k.check === check)?.status;
  assert.equal(st("instagram", "Education\n#a #b #c #d #e #f", "HASHTAGS"), "FAIL", "Instagram's cap of 5");
  assert.equal(st("instagram", "Education\n#a #b #c #d #e", "HASHTAGS"), "PASS");
  assert.equal(st("instagram", "x".repeat(130), "FIRST LINE"), "WARN", "Instagram's feed cuts the first line at 125");
  assert.equal(st("instagram", "Education https://cta.cryptophys.work/archive", "LINKS"), "WARN", "an Instagram caption shows links as text");
  assert.equal(st("x", "x".repeat(281), "LENGTH"), "FAIL");
  assert.equal(st("telegram", "Education\n#XAUUSD #gold", "HASHTAGS"), "PASS");
  assert.equal(st("threads", "Education\n#XAUUSD", "TOPIC TAG"), "WARN");
  assert.equal(lintPost("telegram", "x").topic_tag, undefined, "only Threads takes a topic tag");
  assert.equal(textFor("telegram", "a\n#XAUUSD #gold"), "a\n#XAUUSD #gold", "the other channels' text as drafted");
  assert.equal(textFor("threads", "a\n#XAUUSD #gold"), "a");
  const c = agentChecks([{ id: "t", channel: "telegram", kind: "custom", status: "pending", text: "Education\n#XAUUSD #gold" }], { channel: "telegram" });
  assert.deepEqual([c.channel, c.topic_tag, c.checks.length, c.checks[0].lint.verdict], ["telegram", null, 1, "READY"]);
  assert.match(read("public/studio/studio.js"), /inactive\.appendChild\(make\("p", null, `The agent does not manage/);
});
