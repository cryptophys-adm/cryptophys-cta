// The CTA agent's Checks skill (owner 2026-11-25: "setuju semua, mulai dari Checks"; the mockup "CTA Studio: the Agent
// page"): the Threads linter and the humanizer ported from instagram-agent-skill (MIT), the topic tag that replaces the
// Threads hashtag line, and the studio's read-only Agent page. Posts still come from the xauusd templates.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SLOP } from "../src/agent/slop.mjs";
import { cleanInvisible, humanScore, jsRegex, HUMAN_CHECKS } from "../src/agent/humanizer.mjs";
import { lintThreads, threadsText, threadsLength, validTopicTag, THREADS_TOPIC_TAG, THREADS_LIMIT } from "../src/agent/threads-lint.mjs";
import { agentChecks, AGENT_SKILLS } from "../src/agent/checks.mjs";
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
  for (const f of ["src/agent/slop.mjs", "src/agent/humanizer.mjs", "src/agent/threads-lint.mjs"]) assert.match(read(f), /LICENSE-instagram-agent-skill/, `${f} credits the source`);
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
  assert.deepEqual(AGENT_SKILLS.map((s) => [s.id, s.live]), [["linter", true], ["humanizer", true], ["audit", false], ["plan", false], ["replies", false]]);
  const html = read("public/studio/index.html"), js = read("public/studio/studio.js"), app = read("src/app.mjs");
  assert.match(html, /<a href="#agent" data-view="agent">/);
  assert.match(html, /id="view-agent"/);
  assert.match(js, /"performance", "agent", "channels"\]/);
  assert.match(js, /call\("\/api\/studio\/agent"\)/);
  assert.match(app, /route === "GET \/api\/studio\/agent"/, "a GET: it changes nothing");
  assert.doesNotMatch(js, /innerHTML/, "text goes in as text");
});
