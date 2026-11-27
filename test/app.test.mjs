// The CTA app's HTTP face: the public page's API, the studio behind Access (the JWT checked here, fail closed),
// a person's decision, the dry run, publishing held while CONTENT_PUBLISH is off; the X and Telegram publishers;
// the organ's DNA within the platform's external ceiling.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { handle, accountOf, accountFor, publishDraft, SECRETS, STUDIO_SECRETS, roleOf, channelsOf, renderImages, collectInsights, runSchedule, cardPathOf, agentReplies, aboutLedeLive, agentWrite, PUBLIC_MEDIA, draftAnalysis } from "../src/app.mjs";
import { PATTERN_SEEN_KEY } from "../src/analysis-drafts.mjs";
import { ABOUT_LEDE } from "../src/agent/write.mjs";
import { resetKeyCacheForTests } from "../src/access.mjs";
import { CONNECT_SECRETS } from "../src/oauth.mjs";
import { AGENT_SECRETS, KERNEL_AGENT, KERNEL_CAPABILITIES } from "../src/agent/router.mjs";
import { expireStale, addDrafts, listDrafts, getDraft, draftEvents, decideDraft, recordPublish, requeueFailed, deskCounts, channelStatusCounts, storedToken, storeToken, draftIdsWithPrefix, kindCountsSince, publishedPosts, draftsNeedingImage, attachImage, mediaOf, noteDraft, publishedSince, saveMetrics, storedSettings, saveChannelSettings, channelCountsSince, searchDrafts, editDraft, duplicateDraft, calendarMonth, listMedia, nextApproved, approvedCounts, claimSlot, slotOutcome, recentSlots, addLink, getLink, countClick, listLinks, listHashtagSets, saveHashtagSet, studioSetting, saveStudioSetting, kindMixSince, addAbTest, listAbTests, measuredPosts, copiedSince, putOAuthState, takeOAuthState, saveConnection, connectionsOf, removeConnection, saveCreds, credsOf, credsStatus, recordModelCall, modelSpendSince, recentModelCalls, replySeen, answeredInThread, repliesSentSince, recordReply, recentReplies, forgetReplies, autoCandidates, writeCandidates, recordWrite, recentWrites, claimPublish, failStuckPublishing, STUCK_NOTE, draftsWithPrefixSince, ARCHIVE_LAST_CHANNELS, postKey, onePatternPost } from "../src/desk.mjs";
import { editCheck } from "../src/compose.mjs";
import { publishX, publishTelegram, publishTo } from "../src/publishers.mjs";
import { CHANNELS, CHANNEL_SPECS } from "../src/channels.mjs";

const TEAM = "cryptophys.cloudflareaccess.com";
const AUD = "a".repeat(64);
const b64url = (bytes) => Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const enc = (obj) => b64url(new TextEncoder().encode(JSON.stringify(obj)));
const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const jwk = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid: "k1" };
const certsFetch = async () => new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
const NOW = Math.floor(Date.now() / 1000); // seconds
async function jwt(claims) {
  const head = enc({ alg: "RS256", kid: "k1" }), body = enc({ iss: `https://${TEAM}`, aud: [AUD], exp: NOW + 600, ...claims });
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(new Uint8Array(sig))}`;
}

function sqlite() {
  const db = new DatabaseSync(":memory:");
  return { exec(q, ...b) { const s = db.prepare(q); const out = /^\s*SELECT|\bRETURNING\b/i.test(q) ? s.all(...b) : (s.run(...b), []); return { toArray: () => out.map((r) => ({ ...r })) }; } };
}
/** The ContentDesk Durable Object's RPC surface over node:sqlite. */
function deskStub() {
  const sql = sqlite();
  const api = {
    add: async (d, now, actor) => addDrafts(sql, d, { now, ...(actor ? { actor } : {}) }), list: async (i) => listDrafts(sql, i ?? {}),
    get: async (id) => { const d = getDraft(sql, id); return d ? { ...d, events: draftEvents(sql, id) } : null; },
    decide: async (i, now) => decideDraft(sql, i, { now }), published: async (i, now) => recordPublish(sql, i, { now }), claimPublish: async (i, now) => claimPublish(sql, i, { now }), requeue: async (i, now) => requeueFailed(sql, i, { now }),
    counts: async () => deskCounts(sql), channelCountsByStatus: async () => channelStatusCounts(sql), token: async (c) => storedToken(sql, c), saveToken: async (c, t, now) => { storeToken(sql, c, t, { now }); return true; },
    idsWithPrefix: async (p) => draftIdsWithPrefix(sql, p), draftsSince: async (p, s) => draftsWithPrefixSince(sql, p, s), kindCounts: async (k, s) => kindCountsSince(sql, k, s), archive: async (n) => publishedPosts(sql, { limit: n }),
    needingImage: async (n, retry) => draftsNeedingImage(sql, { limit: n, retry }), attachImage: async (i, now) => attachImage(sql, i, { now }),
    media: async (id) => mediaOf(sql, id), note: async (i, now) => noteDraft(sql, i, { now }),
    publishedSince: async (s, n) => publishedSince(sql, s, { limit: n }), saveMetrics: async (i, now) => saveMetrics(sql, i, { now }),
    settings: async () => storedSettings(sql), saveSettings: async (i, now) => saveChannelSettings(sql, i, { now }), channelCounts: async (s) => channelCountsSince(sql, s),
    library: async (i) => searchDrafts(sql, i ?? {}), calendar: async (m) => calendarMonth(sql, m), mediaList: async (i) => listMedia(sql, i ?? {}),
    edit: async (i, now) => editDraft(sql, { ...i, check: (x) => editCheck(x, i.checkOptions ?? {}) }, { now }),
    duplicate: async (i, now) => duplicateDraft(sql, { ...i, check: (x) => editCheck(x, i.checkOptions ?? {}) }, { now }),
    nextApproved: async (c, now) => nextApproved(sql, c, { now: now ?? Date.now() }), expireStale: async (now) => expireStale(sql, { now: now ?? Date.now() }), approvedCounts: async () => approvedCounts(sql), claimSlot: async (i, now) => claimSlot(sql, i, { now }),
    slotOutcome: async (i) => { slotOutcome(sql, i); return true; }, recentSlots: async (n) => recentSlots(sql, { limit: n }),
    addLink: async (i, now) => addLink(sql, i, { now }), link: async (s) => getLink(sql, s), click: async (i, now) => { countClick(sql, i, { now }); return true; },
    links: async () => listLinks(sql), hashtagSets: async () => listHashtagSets(sql), saveHashtagSet: async (i, now) => saveHashtagSet(sql, i, { now }),
    autoCandidates: async (i) => autoCandidates(sql, i),
    writeCandidates: async (i) => writeCandidates(sql, i), recordWrite: async (i, now) => recordWrite(sql, i, { now }), recentWrites: async (n) => recentWrites(sql, { limit: n }),
    replySeen: async (id) => replySeen(sql, id), answeredInThread: async (p, a) => answeredInThread(sql, p, a), repliesSentSince: async (s) => repliesSentSince(sql, s), recordReply: async (r) => recordReply(sql, r), recentReplies: async (n) => recentReplies(sql, { limit: n }), forgetReplies: async (b) => forgetReplies(sql, b),
    recordModelCall: async (i, now) => recordModelCall(sql, i, { now }), modelSpendSince: async (s) => modelSpendSince(sql, s), recentModelCalls: async (n) => recentModelCalls(sql, { limit: n }),
    studioSetting: async (k) => studioSetting(sql, k), saveStudioSetting: async (i, now) => saveStudioSetting(sql, i, { now }), kindMix: async (f, t) => kindMixSince(sql, f, t),
    addAbTest: async (i, now) => { addAbTest(sql, i, { now }); return true; }, abTests: async () => listAbTests(sql), measuredPosts: async () => measuredPosts(sql), copiedSince: async (s) => copiedSince(sql, s),
    putOAuthState: async (i, now) => putOAuthState(sql, i, { now }), takeOAuthState: async (i, now) => takeOAuthState(sql, i, { now }),
    saveConnection: async (i, now) => saveConnection(sql, i, { now }), connections: async () => connectionsOf(sql), removeConnection: async (i, now) => removeConnection(sql, i, { now }),
    saveCreds: async (i, now) => saveCreds(sql, i, { now }), creds: async (i) => credsOf(sql, i), credsStatus: async () => credsStatus(sql)
  };
  return { sql, api, ns: { idFromName: () => "desk", get: () => api } };
}
// The static files: /about is the real page (the about_lede_ok gate reads it); any other path names itself.
const ASSETS = { fetch: async (req) => new URL(req.url).pathname === "/about" ? new Response(readFileSync("public/about.html", "utf8"), { status: 200, headers: { "content-type": "text/html" } })
  : new Response(`asset ${new URL(req.url).pathname}`, { status: 200, headers: { "content-type": "text/html" } }) };
// Two decisions inside the window the recap covers (between 48 and 24 hours before the run).
const ago = (h) => new Date(Math.floor((Date.now() - h * 3_600_000) / 900_000) * 900_000).toISOString();
const RECAPS = [
  { bar_close: ago(30), session: "london", stance: "SELL", bias: "BEARISH", outcome: "hit", patterns: [] },
  { bar_close: ago(31), session: "london", stance: "WAIT", bias: "BEARISH", outcome: "hit", patterns: [] }
];
function env(extra = {}) {
  const d = deskStub();
  return { d, env: { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, CONTENT_DESK: d.ns, ASSETS, PROJECTION: { recaps: async () => ({ recaps: RECAPS }), analysis: async () => ({ at: "2026-11-17T22:09:00.000Z", price: 3887.6, zones: [], patterns: [], structure: {} }) }, ...extra } };
}
const opts = { fetchImpl: certsFetch, now: NOW };
const req = (path, { token, method = "GET", body, origin = "https://cta.cryptophys.work" } = {}) => new Request(`https://cta.cryptophys.work${path}`, {
  method, body: body == null ? undefined : JSON.stringify(body),
  headers: { ...(token ? { "cf-access-jwt-assertion": token } : {}), ...(origin ? { origin } : {}), ...(body != null ? { "content-type": "application/json" } : {}) }
});

test("the public face: health, the brand's profile and links, the empty archive, the page; no studio data", async () => {
  resetKeyCacheForTests();
  const { env: e } = env();
  assert.deepEqual(await (await handle(req("/health"), e, opts)).json(), { ok: true, service: "cryptophys-cta", publish: "off", publish_channels: [] });
  const p = await (await handle(req("/api/public/profile"), e, opts)).json();
  assert.equal(p.brand.id, "xauusd-ai-cta");
  assert.match(p.brand.disclaimer, /not an invitation to buy or sell and not financial advice/);
  assert.deepEqual(p.links, [{ channel: "threads", label: "Threads", url: "https://www.threads.net/@cryptophys.adm" }], "the account the token posts as (owner 2026-11-20)");
  assert.deepEqual(await (await handle(req("/api/public/archive"), e, opts)).json(), { posts: [] });
  const page = await handle(req("/"), e, opts);
  assert.equal(await page.text(), "asset /index.html");
  assert.match(page.headers.get("content-security-policy"), /script-src 'self'/);
});

test("the studio: 403 without a valid Access JWT, the page and API with one; a service token reads but never decides", async () => {
  resetKeyCacheForTests();
  const { env: e } = env();
  for (const p of ["/studio", "/studio/", "/api/studio/drafts", "/api/studio/status"]) assert.equal((await handle(req(p), e, opts)).status, 403, p);
  // A person opening the studio page without a sign-in gets the sign-in page (still 403, no-store); the API keeps JSON.
  const page = await handle(req("/studio"), e, opts);
  assert.equal(await page.text(), "asset /signin");
  assert.equal(page.headers.get("cache-control"), "no-store");
  assert.match(page.headers.get("content-security-policy"), /script-src 'self'/);
  assert.equal((await (await handle(req("/api/studio/drafts"), e, opts)).json()).error, "access_denied");
  assert.equal((await handle(req("/studio/studio.js"), e, opts)).status, 403, "a studio asset is never served without a sign-in");
  assert.equal((await handle(req("/api/studio/drafts", { token: "a.b.c" }), e, opts)).status, 403);
  const person = await jwt({ email: "Owner@Example.com" });
  assert.equal(await (await handle(req("/studio", { token: person }), e, opts)).text(), "asset /studio/");
  // The studio's script is served as itself, never as the page (2026-11-16: it came back as HTML and nothing ran).
  assert.equal(await (await handle(req("/studio/studio.js", { token: person }), e, opts)).text(), "asset /studio/studio.js");
  assert.equal(await (await handle(req("/studio/", { token: person }), e, opts)).text(), "asset /studio/");
  assert.deepEqual(await (await handle(req("/api/studio/whoami", { token: person }), e, opts)).json(), { subject: "owner@example.com", type: "user", role: "approver", can_decide: true, can_write: true, roles_set: false });
  const st = await (await handle(req("/api/studio/status", { token: person }), e, opts)).json();
  assert.equal(st.publish, "off");
  assert.deepEqual(Object.keys(st.channels), CHANNELS);
  assert.ok(Object.values(st.channels).every((c) => c.configured === false), "no account secret yet");
  const svc = await jwt({ common_name: "ci.access" });
  assert.equal((await handle(req("/api/studio/drafts", { token: svc }), e, opts)).status, 200);
  assert.equal((await handle(req("/api/studio/decide", { token: svc, method: "POST", body: { id: "x", decision: "approve" } }), e, opts)).status, 403);
});

test("drafting and deciding: drafts from the projection, an approval held while publishing is off, a rejection needs a reason", async () => {
  resetKeyCacheForTests();
  const { env: e, d } = env({ CONTENT_CHANNELS: "threads,x" });
  const person = await jwt({ email: "owner@example.com" });
  const made = await (await handle(req("/api/studio/draft-now", { token: person, method: "POST", body: {} }), e, opts)).json();
  assert.ok(made.recap.added.length >= 1, JSON.stringify(made));
  assert.deepEqual(made.cards, { status: "no_browser" }, "Draft now makes the cards too (here: no browser bound)");
  const list = await (await handle(req("/api/studio/drafts?status=pending", { token: person }), e, opts)).json();
  assert.ok(list.drafts.length >= 1);
  const id = list.drafts[0].id;
  const post = (body, extra = {}) => handle(req("/api/studio/decide", { token: person, method: "POST", body, ...extra }), e, opts);
  assert.equal((await post({ id, decision: "reject" })).status, 400, "a rejection needs a reason");
  assert.equal((await post({ id, decision: "publish" })).status, 400);
  assert.equal((await post({ id, decision: "approve" }, { origin: "https://evil.example" })).status, 403, "cross-origin refused");
  const ok = await (await post({ id, decision: "approve" })).json();
  assert.deepEqual([ok.status, ok.publish.held], ["approved", "publishing_off"]);
  const dry = await (await handle(req(`/api/studio/preview?id=${encodeURIComponent(id)}`, { token: person }), e, opts)).json();
  assert.equal(dry.dry_run, true);
  assert.ok(!JSON.stringify(dry).includes("SECRET"));
  assert.equal(getDraft(d.sql, id).decided_by, "owner@example.com");
});

test("publishing on: an approved Telegram draft goes out with the channel's secrets; a channel without a built publisher waits", async () => {
  const { env: e, d } = env({ CONTENT_PUBLISH: "on", PUBLISH_CHANNELS: "telegram,youtube", TELEGRAM_BOT_TOKEN: "123:SECRET", TELEGRAM_CHAT_ID: "@xauusd_ai_cta" });
  assert.deepEqual(await accountOf(e, "telegram"), { bot_token: "123:SECRET", chat_id: "@xauusd_ai_cta", refreshed_at: null });
  assert.equal(await accountOf(e, "threads"), null);
  assert.equal(await accountOf(e, "youtube"), null);
  addDrafts(d.sql, [{ id: "t1", channel: "telegram", kind: "daily_recap", text: "Education only — moreover, a robust day. Not financial advice.", status: "pending" }, { id: "y1", channel: "youtube", kind: "daily_recap", text: "Education only. Not financial advice.", status: "pending" }]);
  for (const id of ["t1", "y1"]) decideDraft(d.sql, { id, decision: "approve", actor: "owner" });
  const calls = [];
  const fetcher = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return Response.json({ ok: true, result: { message_id: 77 } }); };
  const r = await publishDraft(e, getDraft(d.sql, "t1"), { fetcher });
  assert.equal(r.status, "published");
  assert.deepEqual(calls[0].body, { chat_id: "@xauusd_ai_cta", text: "Education only. Also, a solid day. Not financial advice.", disable_web_page_preview: true }, "humanized before it goes out (owner: \"Everything, templates too\")");
  assert.equal(getDraft(d.sql, "t1").remote_id, "77");
  assert.equal(getDraft(d.sql, "t1").text, "Education only. Also, a solid day. Not financial advice.", "the archive keeps the text that went out");
  assert.deepEqual(await publishDraft(e, getDraft(d.sql, "y1"), { fetcher }), { status: "approved", held: "account_not_configured" }, "YouTube is built; without its OAuth app it waits");
  assert.deepEqual(await (await handle(req("/api/public/archive"), e, opts)).json().then((a) => a.posts.map((p) => p.id)), ["t1"], "the archive shows what was published (a Telegram-only post, once)");
  // the digest (owner 2026-11-23): each post carries its card's path, or null; never the stored URL
  const one = (await (await handle(req("/api/public/archive"), e, opts)).json()).posts[0];
  assert.equal(one.image, null, "a post without a card");
  assert.equal("image_url" in one, false, "the stored URL is not passed on");
  assert.equal(cardPathOf("https://cta.cryptophys.work/media/0123456789abcdef0123456789abcdef.jpg"), "/media/0123456789abcdef0123456789abcdef.jpg");
  assert.equal(cardPathOf("https://cta.cryptophys.work/media/0123456789abcdef0123456789abcdef.webm"), null, "a video has no card here");
  for (const bad of [null, "", "https://evil.example/x.jpg", "/media/../secret.jpg", "javascript:alert(1)"]) assert.equal(cardPathOf(bad), null, String(bad));
});

test("X and Telegram publishers: the token only in the header (X), a dry run shows no secret; planned channels refuse", async () => {
  const calls = [];
  const fx = async (url, init) => { calls.push({ url, init }); return Response.json({ data: { id: "1857" } }, { status: 201 }); };
  assert.deepEqual(await publishX({ account: { access_token: "XSECRET" }, text: "hi", fetcher: fx }), { remote_id: "1857" });
  assert.equal(calls[0].url, "https://api.x.com/2/tweets");
  assert.equal(calls[0].init.headers.authorization, "Bearer XSECRET");
  assert.ok(!calls[0].url.includes("XSECRET"));
  for (const p of [publishX({ account: { access_token: "XSECRET" }, text: "x", dryRun: true }), publishTelegram({ account: { bot_token: "TSECRET", chat_id: "@c" }, text: "x", dryRun: true })]) assert.ok(!JSON.stringify(await p).includes("SECRET"));
  await assert.rejects(publishX({ account: {}, text: "x", fetcher: fx }), /not configured/);
  await assert.rejects(publishTelegram({ account: { bot_token: "t" }, text: "x", fetcher: fx }), /not configured/);
  await assert.rejects(publishTo("tiktok", { draft: { text: "x" }, media: async () => ({ bytes: new Uint8Array(10), mime: "video/webm" }) }), /tiktok account not configured/);
  await assert.rejects(publishTo("myspace", { draft: { text: "x" } }), /not built yet/);
  assert.deepEqual(Object.keys(SECRETS), CHANNELS);
  assert.deepEqual(CHANNELS.filter((c) => CHANNEL_SPECS[c].publisher === "built"), ["threads", "instagram", "x", "telegram", "youtube", "tiktok"]);
  assert.deepEqual(channelsOf({ CONTENT_CHANNELS: "threads, bogus, x" }), ["threads", "x"]);
});

test("the organ's DNA: one portal organ within the platform's external ceiling, no AI task", () => {
  const dna = JSON.parse(readFileSync(new URL("../organism.json", import.meta.url), "utf8"));
  assert.equal(dna.schema, "cta-organism.v1");
  assert.equal(dna.organs.length, 1);
  const o = dna.organs[0];
  assert.equal(o.service, JSON.parse(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8").replace(/^\s*\/\/.*$/gm, "")).name);
  assert.deepEqual([o.$schema_version, o.access, o.rollback, o.deploy_unit, o.drift.via], [1, false, false, null, "rpc"]);
  const CEILING = new Set(["signals.observe", "reports.publish", "memory.recall", "memory.remember"]);
  for (const a of o.agents) {
    assert.equal(a.voter, false);
    assert.ok(a.tier_max <= 1);
    if (a.id === "cta-model-router") continue;
    assert.ok(a.capabilities.every((c) => CEILING.has(c)), a.id);
  }
  // The platform's CTA_CEILING (ADR-0007 amendment; owner 2026-11-27: "usulan saya"): exactly one named agent with exactly
  // the two router capabilities; anything more and the census refuses the agent whole.
  assert.deepEqual(o.agents.find((a) => a.id === "cta-model-router"), { id: "cta-model-router", display_name: "CTA model router client", capabilities: ["model_router.status", "model_router.report_paid"], tier_max: 1, voter: false });
  assert.deepEqual([...KERNEL_CAPABILITIES], ["model_router.status", "model_router.report_paid"]);
  assert.equal(KERNEL_AGENT, "cta-model-router");
  const cfgServices = JSON.parse(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8").replace(/^\s*\/\/.*$/gm, "")).services;
  assert.deepEqual(cfgServices.find((s) => s.binding === "AGENTS"), { binding: "AGENTS", service: "cryptophys-ai-kernel", entrypoint: "AgentRpc", props: { host_worker: "cryptophys-cta" } }, "host-pinned to this Worker");
  assert.deepEqual(o.engines, [], "no model writes public text");
});

test("the native deploy block in organism.json equals wrangler.jsonc, and the organ claims no platform unit", () => {
  const dna = JSON.parse(readFileSync(new URL("../organism.json", import.meta.url), "utf8"));
  const cfg = JSON.parse(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8").replace(/^\s*\/\/.*$/gm, ""));
  const d = dna.deploy;
  assert.equal(dna.organs[0].deploy_unit, null, "the census refuses an external organ that claims a platform deploy unit");
  assert.deepEqual([d.unit, d.script, d.config, d.entry], [cfg.name, cfg.name, "wrangler.jsonc", cfg.main]);
  assert.deepEqual(d.custom_domains, cfg.routes.filter((r) => r.custom_domain).map((r) => r.pattern));
  assert.equal(d.workers_dev, cfg.workers_dev);
  assert.deepEqual(d.assets, cfg.assets);
  assert.deepEqual(d.durable_objects, cfg.durable_objects.bindings.map(({ name, class_name }) => ({ binding: name, class_name })));
  assert.deepEqual(d.do_migrations, cfg.migrations);
  assert.deepEqual(d.services, cfg.services);
  assert.deepEqual(d.browser, cfg.browser);
  assert.deepEqual(d.compatibility_flags, cfg.compatibility_flags);
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.deepEqual(Object.keys(pkg.dependencies ?? {}), ["@cloudflare/puppeteer"], "one runtime dependency, declared in the deploy block");
  assert.deepEqual(d.crons, cfg.triggers.crons);
  assert.deepEqual(d.secrets_kept, [...Object.values(SECRETS).flatMap((s) => Object.values(s)), ...STUDIO_SECRETS, ...CONNECT_SECRETS, ...AGENT_SECRETS]);
  const src = readFileSync(new URL("../src/index.mjs", import.meta.url), "utf8");
  for (const e of [...d.entrypoints, ...d.durable_objects.map((o) => o.class_name)]) assert.match(src, new RegExp(`export class ${e}\\b`));
  assert.equal(d.via, "forge");
  assert.deepEqual(d.vars, Object.keys(cfg.vars), "every var is declared, and every non-secret value is a plain var");
  assert.match(cfg.vars.ACCESS_AUD, /^[0-9a-f]{64}$/, "the Access audience is a plain var, not resolved at deploy");
  assert.ok(d.secrets_kept.every((s) => !(s in cfg.vars)), "a secret is never a var");
});


test("Instagram cards: rendered for drafts that need one, then served publicly only once the draft is approved", async () => {
  resetKeyCacheForTests();
  const { d, env: e } = env({ PUBLIC_ORIGIN: "https://cta.cryptophys.work" });
  const text = "Education · Pattern forming · XAUUSD H4\nAscending Triangle\n\nUpper line 4098.20 · lower line 4071.60\n\nChart by TradingView.\nEducational analysis by Cryptophys. Not an invitation to buy or sell, and not financial advice.\n#XAUUSD";
  addDrafts(d.sql, [
    { id: "pattern:H4:asc:forming:4098:4072:instagram", kind: "pattern", channel: "instagram", text, status: "needs_image" },
    { id: "pattern:H4:bad:forming:4098:4072:instagram", kind: "pattern", channel: "instagram", text: text + "\nx", status: "needs_image" }
  ], { now: Date.now() - 1000 });
  const jpeg = new Uint8Array(30_000); jpeg[0] = 0xff; jpeg[1] = 0xd8;
  let rendered = 0;
  const render = async (draft) => { rendered += 1; if (draft.id.includes(":bad:")) throw new Error("the TradingView chart did not load"); return jpeg; };
  assert.deepEqual(await renderImages(e, {}), { status: "no_browser" });
  const r = await renderImages(e, { launch: () => ({}), render });
  assert.equal(rendered, 2);
  assert.deepEqual(r.rendered.map((x) => x.status), ["pending", "render_failed"]);
  const ok = getDraft(d.sql, "pattern:H4:asc:forming:4098:4072:instagram");
  assert.equal(ok.status, "pending");
  assert.ok(ok.guardian.pass, JSON.stringify(ok.guardian));
  const m = /^https:\/\/cta\.cryptophys\.work\/media\/([0-9a-f]{32})\.jpg$/.exec(ok.image_url);
  assert.ok(m, ok.image_url);
  const failed = getDraft(d.sql, "pattern:H4:bad:forming:4098:4072:instagram");
  assert.equal(failed.status, "needs_image", "a failed card leaves its draft waiting");
  assert.equal(draftEvents(d.sql, failed.id)[0].action, "render_failed");
  // A card is tried three times by the schedule; then only the studio's "render now" (retry) tries it again.
  await renderImages(e, { launch: () => ({}), render }); await renderImages(e, { launch: () => ({}), render });
  assert.equal(rendered, 4);
  assert.deepEqual(await renderImages(e, { launch: () => ({}), render }), { waiting: 0, rendered: [] });
  assert.equal((await renderImages(e, { launch: () => ({}), render, retry: true })).waiting, 1);

  // Before approval: not public; the studio sees it.
  assert.equal((await handle(req(`/media/${m[1]}.jpg`), e, opts)).status, 404);
  assert.equal((await handle(req(`/api/studio/media?id=${m[1]}`), e, opts)).status, 403);
  const studio = await handle(req(`/api/studio/media?id=${m[1]}`, { token: await jwt({ email: "owner@example.com", sub: "u1" }) }), e, opts);
  assert.equal(studio.status, 200);
  assert.equal(studio.headers.get("content-type"), "image/jpeg");
  assert.equal(studio.headers.get("cache-control"), "private, no-store");
  // Approved (with levels: an analysis draft is not blocked for its price levels): public.
  const approved = decideDraft(d.sql, { id: ok.id, decision: "approve", actor: "owner@example.com" });
  assert.equal(approved.status, "approved", JSON.stringify(approved.guardian));
  const pub = await handle(req(`/media/${m[1]}.jpg`), e, opts);
  assert.equal(pub.status, 200);
  assert.deepEqual([...new Uint8Array(await pub.arrayBuffer())].slice(0, 2), [0xff, 0xd8]);
  assert.equal((await handle(req(`/media/${"0".repeat(32)}.jpg`), e, opts)).status, 404);
  // While the post goes out (status publishing, the claim): still served, because Threads and Instagram fetch the card
  // during the publish call (regression: 2026-11-25 15:15 and 16:10, Threads "400 An unknown error occurred").
  assert.equal(claimPublish(d.sql, { id: ok.id }).ok, true);
  assert.equal(getDraft(d.sql, ok.id).status, "publishing");
  assert.equal((await handle(req(`/media/${m[1]}.jpg`), e, opts)).status, 200, "served while publishing");
  assert.deepEqual(PUBLIC_MEDIA, ["approved", "publishing", "published"]);
  // Published, the Archive names its card by path (the digest, owner 2026-11-23; orchestrator review of #73), never the stored URL.
  recordPublish(d.sql, { id: ok.id, remoteId: "ig1" });
  const [post] = (await (await handle(req("/api/public/archive"), e, opts)).json()).posts;
  assert.equal(post.id, ok.id);
  assert.equal(post.image, `/media/${m[1]}.jpg`, "the published post's own JPEG card");
  assert.equal("image_url" in post, false, "the stored URL is not passed on");
  assert.equal((await handle(req(post.image), e, opts)).status, 200, "the path the page fetches is served");
});

test("the studio's render-now: a person only, same origin", async () => {
  resetKeyCacheForTests();
  const { env: e } = env();
  const person = await jwt({ email: "owner@example.com", sub: "u1" });
  const service = await jwt({ common_name: "svc.access", sub: "" });
  assert.equal((await handle(req("/api/studio/render-now", { token: service, method: "POST", body: {} }), e, opts)).status, 403);
  assert.equal((await handle(req("/api/studio/render-now", { token: person, method: "POST", body: {}, origin: "https://evil.example" }), e, opts)).status, 403);
  const r = await handle(req("/api/studio/render-now", { token: person, method: "POST", body: {} }), e, { ...opts, launch: null });
  assert.deepEqual(await r.json(), { status: "no_browser" });
});

test("video drafts: rendered as a WebM after their card, served as video only once approved, never as a .jpg", async () => {
  resetKeyCacheForTests();
  const { d, env: e } = env({ PUBLIC_ORIGIN: "https://cta.cryptophys.work" });
  const text = "Education · Pattern forming · XAUUSD H4\nAscending Triangle\n\nChart by TradingView.\nEducational analysis by Cryptophys. Not an invitation to buy or sell, and not financial advice.\n#XAUUSD";
  addDrafts(d.sql, [{ id: "pattern:H4:asc:forming:4098:4072:youtube", kind: "pattern", channel: "youtube", text, status: "needs_video" }], { now: Date.now() - 1000 });
  const webm = new Uint8Array(1_200_000); webm.set([0x1a, 0x45, 0xdf, 0xa3]);
  const calls = [];
  const r = await renderImages(e, { launch: () => ({}), render: async () => { calls.push("card"); return new Uint8Array(1); }, renderMovie: async () => { calls.push("video"); return { bytes: webm, mime: "video/webm" }; } });
  assert.deepEqual(calls, ["video"], "a video channel renders the video (which makes its own card)");
  assert.equal(r.rendered[0].status, "pending");
  const draft = getDraft(d.sql, "pattern:H4:asc:forming:4098:4072:youtube");
  const id = /\/media\/([0-9a-f]{32})\.webm$/.exec(draft.image_url)?.[1];
  assert.ok(id, draft.image_url);
  assert.equal((await handle(req(`/media/${id}.webm`), e, opts)).status, 404, "not before approval");
  decideDraft(d.sql, { id: draft.id, decision: "approve", actor: "owner@example.com" });
  const res = await handle(req(`/media/${id}.webm`), e, opts);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "video/webm");
  assert.equal(new Uint8Array(await res.arrayBuffer()).length, webm.length, "the chunks come back whole");
  assert.equal((await handle(req(`/media/${id}.jpg`), e, opts)).status, 404, "a video is never served as an image");
});


test("the performance report: metrics read for the last two weeks' posts, shown to the studio; a person asks for a read now", async () => {
  resetKeyCacheForTests();
  const { d, env: e } = env({ THREADS_ACCESS_TOKEN: "T", THREADS_USER_ID: "U", TELEGRAM_BOT_TOKEN: "B", TELEGRAM_CHAT_ID: "@c", CONTENT_INSIGHTS: "threads" });
  const at = Date.now();
  addDrafts(d.sql, [
    { id: "p1", channel: "threads", kind: "pattern", text: "Education only. Not financial advice.", status: "pending" },
    { id: "p2", channel: "telegram", kind: "pattern", text: "Education only. Not financial advice.", status: "pending" },
    { id: "p3", channel: "threads", kind: "pattern", text: "Education only. Not financial advice.", status: "pending" }
  ], { now: at - 40 * 86_400_000 });
  // Approved within the hour (an analysis older than 2 hours expires instead of being approved).
  for (const id of ["p1", "p2", "p3"]) decideDraft(d.sql, { id, decision: "approve", actor: "owner" }, { now: at - 40 * 86_400_000 + 3_600_000 });
  recordPublish(d.sql, { id: "p1", remoteId: "th1" }, { now: at - 86_400_000 });
  recordPublish(d.sql, { id: "p2", remoteId: "tg1" }, { now: at - 86_400_000 });
  recordPublish(d.sql, { id: "p3", remoteId: "th-old" }, { now: at - 20 * 86_400_000 });
  const fetcher = async (url) => { assert.match(String(url), /\/th1\/insights/); return new Response(JSON.stringify({ data: [{ name: "views", values: [{ value: 640 }] }, { name: "likes", values: [{ value: 12 }] }] })); };
  const r = await collectInsights(e, { now: at, fetcher });
  assert.deepEqual([r.posts, r.read, r.skipped, r.failed], [2, 1, { telegram: "not_read" }, []], "the old post is past the window; Telegram has no metrics");
  const person = await jwt({ email: "owner@example.com", sub: "u1" });
  const perf = await (await handle(req("/api/studio/performance", { token: person }), e, opts)).json();
  assert.deepEqual([perf.channels.threads.views, perf.channels.threads.likes, perf.channels.telegram.posts], [640, 12, 1]);
  assert.equal(perf.posts.find((p) => p.id === "p1").metrics.views, 640);
  assert.equal((await handle(req("/api/studio/performance"), e, opts)).status, 403);
  const drafts = await (await handle(req("/api/studio/drafts?status=published", { token: person }), e, opts)).json();
  assert.equal(drafts.drafts.find((x) => x.id === "p1").metrics.likes, 12, "the queue shows each post's metrics");
  const service = await jwt({ common_name: "svc.access", sub: "" });
  assert.equal((await handle(req("/api/studio/insights-now", { token: service, method: "POST", body: {} }), e, opts)).status, 403);
  const now2 = await (await handle(req("/api/studio/insights-now", { token: person, method: "POST", body: {} }), e, { ...opts, fetchImpl: fetcher })).json();
  assert.equal(now2.read, 1);
});

test("the bridge deploy workflow: main or by hand, no Worker secret, no delete, publishing off, the Forge's checks", () => {
  const wf = readFileSync(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8");
  const ci = readFileSync(new URL("../.github/workflows/test.yml", import.meta.url), "utf8");
  const code = wf.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
  assert.match(code, /on:\n  push:\n    branches: \[main\]\n  workflow_dispatch:/);
  assert.match(code, /permissions:\n  contents: read/);
  assert.doesNotMatch(code, /secret put|secret bulk|wrangler@[\d.]+ delete|pull_request/, "no Worker secret, no delete, never from a pull request");
  const pinned = (s) => [...s.matchAll(/wrangler@([\d.]+)/g)].map((m) => m[1]);
  assert.ok(pinned(code).length >= 2 && new Set([...pinned(code), ...pinned(ci)]).size === 1, "one wrangler version, the same as test.yml");
  assert.match(code, /if: needs\.credentials\.outputs\.ready == 'true'/, "skipped, not red, without the token");
  assert.match(code, /CONTENT_PUBLISH/);
  const deploys = [...code.matchAll(/wrangler@[\d.]+ deploy([^\n]*)/g)].map((m) => m[1].trim());
  assert.deepEqual(deploys, ["--dry-run", '--tag "${GITHUB_SHA:0:12}" --message "commit ${GITHUB_SHA}"'], "the deploy runs what the dry run validated, its version named by the commit (owner 2026-11-24)");
  assert.doesNotMatch(code, /--var/, "no variable is set from the workflow: wrangler.jsonc is the Worker's whole config");
  assert.match(code, /deploy\.health/);
  assert.match(code, /deploy\.smoke/);
  const cfg = JSON.parse(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8").replace(/^\s*\/\/.*$/gm, ""));
  // Owner 2026-11-17: publishing on for Telegram only, other channels after it works ("setelah sukses baru ke channel lain").
  // Then Threads (owner 2026-11-17 "ya lanjutkan", after Telegram's first post and the Threads account connected).
  assert.deepEqual([cfg.vars.CONTENT_PUBLISH, cfg.vars.PUBLISH_CHANNELS], ["on", "telegram,threads,instagram,tiktok,youtube"]);
  assert.match(code, /PUBLISH_CHANNELS/, "the deploy refuses publishing on without a named channel list");
  assert.doesNotMatch(code, /health\.publish !== "off"/, "the post-deploy check compares the live Worker with the config, not with off");
  assert.match(code, /j\?\.publish === want\.CONTENT_PUBLISH/, "health must match the configured publish mode and channels");
  assert.match(code, /mismatches < 12/, "a publish mismatch is retried for a bounded time, then fails the run");
  assert.match(code, /if \(!health && last\)[^\n]*process\.exit\(1\)/);
});

test("the pages: no inline script or style (CSP 'self'), the studio's four views, and no other company's name", () => {
  const read = (p) => readFileSync(new URL(`../public/${p}`, import.meta.url), "utf8");
  for (const page of ["index.html", "performance.html", "archive.html", "about.html", "disclaimer.html", "privacy.html", "terms.html", "signin.html", "studio/index.html"]) {
    const html = read(page);
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>|<style\b|\sstyle=|\son[a-z]+=/i, `${page}: inline script, style or handler`);
  }
  const studio = read("studio/index.html");
  for (const v of ["dashboard", "queue", "performance", "channels"]) assert.match(studio, new RegExp(`id="view-${v}"`));
  for (const id of ["publish", "who", "tabs", "queue", "channels", "perf", "draftnow", "rendernow", "insightsnow", "err"]) assert.match(studio, new RegExp(`id="${id}"`), id);
  // Every public page, Sign in (also the studio's 403 page) and Performance included (review of #70): the whole file, head
  // and footer too, never names Nexus or Omega and gives no advice. Performance carries its own disclaimer in <main>
  // ("Not advice and not an invitation to trade"; no © line in its footer, owner decision 2).
  const publicPages = ["index.html", "performance.html", "archive.html", "about.html", "disclaimer.html", "privacy.html", "terms.html", "signin.html"];
  const disclaimer = { "performance.html": /\bnot advice and not an invitation to trade\b/i };
  for (const page of publicPages) {
    const html = read(page);
    for (const href of ["/", "/archive", "/about", "/disclaimer", "/privacy", "/terms", "/studio"]) assert.match(html, new RegExp(`href="${href}"`), `${page} links ${href}`);
    assert.match(html, disclaimer[page] ?? /not financial advice/i, `${page} carries the disclaimer`);
    assert.doesNotMatch(html, /\b(nexus|omega)\b/i, `${page}: never Nexus or Omega publicly`);
    assert.doesNotMatch(html, /\b(buy now|sell now|entry at|take profit at|stop loss at|guaranteed)\b/i, `${page}: no advice`);
  }
  const all = [...publicPages, "studio/index.html", "cta.css", "studio/studio.js"].map(read).join("\n");
  assert.doesNotMatch(all, /\b(meta platforms|facebook)\b|\bmeta for developers\b/i, "our own brand only");
  assert.doesNotMatch(all, /\binnerHTML\b/, "text goes in as text");
});

test("channel settings through the studio API: a person saves, a service token only reads; the drafting honours them", async () => {
  resetKeyCacheForTests();
  const { env: e, d } = env({ CONTENT_CHANNELS: "threads,x" });
  const person = await jwt({ email: "owner@example.com" });
  const svc = await jwt({ common_name: "ci.access" });
  const get = async (token) => (await handle(req("/api/studio/settings", { token }), e, opts)).json();
  const post = (body, extra = {}) => handle(req("/api/studio/settings", { token: person, method: "POST", body, ...extra }), e, opts);
  assert.equal((await handle(req("/api/studio/settings"), e, opts)).status, 403, "behind Access");
  const first = await get(person);
  assert.deepEqual([first.can_edit, first.timezone, first.formats.instagram, first.settings.x.enabled], [true, "Asia/Jakarta", ["image"], true]);
  assert.equal((await get(svc)).can_edit, false);
  assert.equal((await handle(req("/api/studio/settings", { token: svc, method: "POST", body: { channel: "x", settings: { enabled: false } } }), e, opts)).status, 403);
  assert.equal((await post({ channel: "x", settings: { enabled: false } }, { origin: "https://evil.example" })).status, 403);
  assert.equal((await post({ channel: "x", settings: { format: "video" } })).status, 400);
  assert.equal((await post({ channel: "myspace", settings: {} })).status, 400);
  const saved = await (await post({ channel: "x", settings: { enabled: false, schedule: [{ days: ["mon"], time: "19:00" }] } })).json();
  assert.deepEqual([saved.ok, saved.settings.enabled, saved.settings.schedule], [true, false, [{ days: ["mon"], time: "19:00" }]]);
  const after = await get(person);
  assert.deepEqual([after.settings.x.enabled, after.meta.x.updated_by], [false, "owner@example.com"]);
  assert.ok(!JSON.stringify(after).match(/token|secret/i), "never a token");
  assert.equal((await handle(req("/api/studio/settings", { token: person, method: "DELETE" }), e, opts)).status, 405);
  // A desk that cannot be read: the page gets an error, never the defaults to save over the stored settings.
  const broken = env({ CONTENT_CHANNELS: "threads,x" });
  const api = broken.d.ns.get();
  api.settings = async () => { throw new Error("desk down"); };
  assert.equal((await handle(req("/api/studio/settings", { token: person }), broken.env, opts)).status, 502);
  // X is off: the next drafting run makes Threads drafts only.
  const made = await (await handle(req("/api/studio/draft-now", { token: person, method: "POST", body: {} }), e, opts)).json();
  assert.ok(made.recap.added.length >= 1);
  assert.ok(listDrafts(d.sql, {}).every((x) => x.channel === "threads"), JSON.stringify(listDrafts(d.sql, {}).map((x) => x.channel)));
});

test("Create through the studio API: templates, the live check, and a composed post queued by a person", async () => {
  resetKeyCacheForTests();
  const { env: e, d } = env({ CONTENT_CHANNELS: "threads,x,instagram" });
  const person = await jwt({ email: "owner@example.com" });
  const svc = await jwt({ common_name: "ci.access" });
  const t = await (await handle(req("/api/studio/templates?kind=custom&channels=threads,x,tiktok", { token: person }), e, opts)).json();
  assert.deepEqual(Object.keys(t.texts), ["threads", "x"], "only the Worker's channels");
  assert.equal((await handle(req("/api/studio/templates?kind=meme", { token: person }), e, opts)).status, 400);
  const text = "Education · XAUUSD\n\nGold held its range through London.\n\nEducational analysis by Cryptophys. Not an invitation to buy or sell, and not financial advice.\n#XAUUSD";
  const post = (path, body, token = person, extra = {}) => handle(req(path, { token, method: "POST", body, ...extra }), e, opts);
  const c = await (await post("/api/studio/check", { kind: "custom", channel: "threads", text })).json();
  assert.deepEqual([c.guardian.pass, c.length, c.limit], [true, text.length, 500]);
  assert.equal((await post("/api/studio/check", { kind: "custom", channel: "threads", text }, svc)).status, 403);
  assert.equal((await post("/api/studio/compose", { kind: "custom", posts: [{ channel: "threads", text }] }, svc)).status, 403, "a service token never writes");
  assert.equal((await post("/api/studio/compose", { kind: "custom", posts: [{ channel: "threads", text }] }, person, { origin: "https://evil.example" })).status, 403);
  const no = await post("/api/studio/compose", { kind: "custom", posts: [{ channel: "threads", text: text.replace("Gold held", "Buy now, gold held") }, { channel: "x", text }] });
  assert.equal(no.status, 400);
  assert.equal((await no.json()).results.threads.guardian.pass, false);
  assert.equal(listDrafts(d.sql, {}).length, 0, "nothing saved when one channel fails");
  const yes = await (await post("/api/studio/compose", { kind: "custom", posts: [{ channel: "threads", text }] })).json();
  assert.equal(yes.ok, true);
  assert.match(yes.added[0], /^manual:\d{4}-\d{2}-\d{2}:[0-9a-f]{8}:threads$/);
  const saved = getDraft(d.sql, yes.added[0]);
  assert.deepEqual([saved.status, saved.kind], ["pending", "custom"]);
  assert.deepEqual(draftEvents(d.sql, yes.added[0]).map((x) => [x.action, x.actor]), [["composed", "owner@example.com"]]);
  assert.equal((await post("/api/studio/compose", { kind: "custom", posts: [{ channel: "tiktok", text }] })).status, 400, "a channel the Worker does not serve");
  assert.equal((await handle(req("/api/studio/compose", { token: person }), e, opts)).status, 405);
});

test("content management through the studio API: library, edit, duplicate, calendar, media; writes by a person only", async () => {
  resetKeyCacheForTests();
  const { env: e, d } = env({ CONTENT_CHANNELS: "threads,x" });
  const person = await jwt({ email: "owner@example.com" });
  const svc = await jwt({ common_name: "ci.access" });
  const text = "Education · XAUUSD\n\nGold held its range through London.\n\nEducational analysis by Cryptophys. Not an invitation to buy or sell, and not financial advice.\n#XAUUSD";
  addDrafts(d.sql, [{ id: "m:threads", kind: "custom", channel: "threads", text, status: "pending" }]);
  const get = async (p, token = person) => (await handle(req(p, { token }), e, opts)).json();
  const post = (p, body, token = person) => handle(req(p, { token, method: "POST", body }), e, opts);
  const lib = await get("/api/studio/library?q=london&channel=threads");
  assert.deepEqual([lib.total, lib.drafts[0].id, lib.can_edit], [1, "m:threads", true]);
  assert.equal((await get("/api/studio/library", svc)).can_edit, false);
  assert.equal((await post("/api/studio/edit", { id: "m:threads", text: text.replace("London", "Asia") }, svc)).status, 403);
  const refused = await post("/api/studio/edit", { id: "m:threads", text: text.replace("Gold held", "Nexus: gold held") });
  assert.equal(refused.status, 400);
  assert.ok((await refused.json()).guardian.failures.some((f) => f.check === "internal"));
  const ok = await (await post("/api/studio/edit", { id: "m:threads", text: text.replace("London", "Asia") })).json();
  assert.deepEqual([ok.ok, ok.status], [true, "pending"]);
  assert.match(getDraft(d.sql, "m:threads").text, /Asia/);
  const dup = await (await post("/api/studio/duplicate", { id: "m:threads" })).json();
  assert.match(dup.id, /^manual:\d{4}-\d{2}-\d{2}:[0-9a-f]{8}:threads$/);
  assert.equal((await post("/api/studio/duplicate", {})).status, 400);
  const month = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 7);
  const cal = await get("/api/studio/calendar");
  assert.equal(cal.month, month);
  assert.equal(Object.values(cal.days).reduce((n, x) => n + x.created, 0), 2);
  assert.equal((await handle(req("/api/studio/calendar?month=nope", { token: person }), e, opts)).status, 400);
  assert.deepEqual(await get("/api/studio/media-library"), { media: [], total: 0, offset: 0, limit: 24 });
});

test("the per-channel scheduler: a scheduled channel posts in its slots only, one post per slot, never twice, never late", async () => {
  resetKeyCacheForTests();
  const { env: e, d } = env({ CONTENT_PUBLISH: "on", PUBLISH_CHANNELS: "telegram,x", CONTENT_CHANNELS: "telegram,x", TELEGRAM_BOT_TOKEN: "123:SECRET", TELEGRAM_CHAT_ID: "@c" });
  const text = "Education only. Not financial advice.";
  addDrafts(d.sql, [1, 2, 3].map((n) => ({ id: `t${n}:telegram`, channel: "telegram", kind: "custom", text: `${text} ${n}`, status: "pending" })));
  saveChannelSettings(d.sql, { channel: "telegram", settings: { ...JSON.parse(JSON.stringify((await import("../src/settings.mjs")).defaultSettings("telegram"))), schedule: [{ days: ["mon"], time: "19:00" }] }, actor: "owner" });
  const MON_1900 = Date.parse("2026-11-16T12:00:00Z"); // Monday 19:00 WIB
  for (const n of [2, 1, 3]) decideDraft(d.sql, { id: `t${n}:telegram`, decision: "approve", actor: "owner" }, { now: MON_1900 - (4 - n) * 3_600_000 });
  // An approval of a scheduled channel's draft waits for the slot, even with publishing on.
  const held = await publishDraft(e, getDraft(d.sql, "t1:telegram"), { now: MON_1900 - 60_000 });
  assert.deepEqual([held.held, held.next.wib], ["waiting_for_slot", "2026-11-16T19:00"]);
  const calls = [];
  const fetcher = async (url, init) => { calls.push(JSON.parse(init.body)); return Response.json({ ok: true, result: { message_id: 90 + calls.length } }); };
  assert.deepEqual((await runSchedule(e, { now: MON_1900 - 60_000, fetcher })).slots, [], "before the slot: nothing");
  const r = await runSchedule(e, { now: MON_1900 + 4 * 60_000, fetcher });
  assert.deepEqual(r.slots.map((x) => [x.channel, x.slot, x.id, x.outcome]), [["telegram", "2026-11-16T19:00", "t1:telegram", "published"]], "the oldest approved first");
  assert.equal(calls.length, 1);
  assert.deepEqual((await runSchedule(e, { now: MON_1900 + 9 * 60_000, fetcher })).slots, [], "a slot is used once");
  assert.equal(getDraft(d.sql, "t2:telegram").status, "approved", "the next one waits for the next slot");
  // A missed slot (the Worker did not run for over 30 minutes) is skipped, never posted late.
  const NEXT = MON_1900 + 7 * 86_400_000;
  assert.deepEqual((await runSchedule(e, { now: NEXT + 31 * 60_000, fetcher })).slots, []);
  assert.equal(calls.length, 1);
  // Publishing off: nothing at all, not even a Desk read.
  const off = env({ CONTENT_CHANNELS: "telegram" });
  off.env.CONTENT_DESK = { idFromName: () => { throw new Error("no desk call while publishing is off"); } };
  assert.deepEqual(await runSchedule(off.env, { now: MON_1900 }), { status: "publishing_off" });
  // An empty slot is recorded; the studio shows the schedule.
  addDrafts(d.sql, []);
  const person = await jwt({ email: "owner@example.com" });
  const sch = await (await handle(req("/api/studio/schedule", { token: person }), e, opts)).json();
  assert.equal(sch.channels.telegram.scheduled, true);
  assert.equal(sch.channels.telegram.waiting, 2);
  assert.equal(sch.channels.telegram.next_draft.id, "t2:telegram");
  assert.equal(sch.channels.x.scheduled, false);
  assert.deepEqual(sch.recent.map((x) => [x.key, x.outcome, x.draft_id]), [["telegram@2026-11-16T19:00", "published", "t1:telegram"]]);
  assert.ok(!JSON.stringify(sch).includes("SECRET"));
});

test("marketing through the HTTP face: a tracked link redirects with UTM tags and counts; sets and the mix by a person", async () => {
  resetKeyCacheForTests();
  const { env: e } = env({ CONTENT_CHANNELS: "threads,x" });
  const person = await jwt({ email: "owner@example.com" });
  const svc = await jwt({ common_name: "ci.access" });
  const post = (p, body, token = person) => handle(req(p, { token, method: "POST", body }), e, opts);
  assert.equal((await post("/api/studio/links", { target: "https://cta.cryptophys.work/archive", campaign: "launch" }, svc)).status, 403);
  assert.equal((await post("/api/studio/links", { target: "https://evil.example/", campaign: "launch" })).status, 400, "never an open redirect");
  const made = await (await post("/api/studio/links", { target: "https://cta.cryptophys.work/archive", campaign: "launch", label: "Archive" })).json();
  assert.match(made.slug, /^[a-z]{8}$/);
  const go = await handle(req(`/go/${made.slug}/threads`), e, opts);
  assert.equal(go.status, 302);
  assert.equal(go.headers.get("location"), "https://cta.cryptophys.work/archive?utm_source=threads&utm_medium=social&utm_campaign=launch");
  assert.equal((await handle(req("/go/zzzzzzzz/threads"), e, opts)).status, 404);
  const list = await (await handle(req("/api/studio/links", { token: person }), e, opts)).json();
  assert.deepEqual([list.links[0].total, list.links[0].short.x], [1, `https://cta.cryptophys.work/go/${made.slug}/x`]);
  assert.equal((await post("/api/studio/hashtag-sets", { name: "core", tags: "#XAUUSD #gold" })).status, 200);
  assert.deepEqual((await (await handle(req("/api/studio/hashtag-sets", { token: person }), e, opts)).json()).sets.map((x) => x.tags), ["#XAUUSD #gold"]);
  assert.equal((await post("/api/studio/hashtag-sets", { name: "core", remove: true })).status, 200);
  assert.equal((await post("/api/studio/mix", { targets: { key_levels: 50 } })).status, 400);
  assert.equal((await post("/api/studio/mix", { targets: { key_levels: 20, pattern: 30, daily_recap: 30, custom: 20 } })).status, 200);
  const mix = await (await handle(req("/api/studio/mix", { token: person }), e, opts)).json();
  assert.deepEqual([mix.targets.custom, mix.updated_by, mix.total], [20, "owner@example.com", 0]);
});

test("growth through the studio API: an A/B pair from Create, its result once measured, best times, evergreen", async () => {
  resetKeyCacheForTests();
  const { env: e, d } = env({ CONTENT_CHANNELS: "threads" });
  const person = await jwt({ email: "owner@example.com" });
  const text = "Education · XAUUSD\n\nGold held its range through London.\n\nEducational analysis by Cryptophys. Not an invitation to buy or sell, and not financial advice.\n#XAUUSD";
  const made = await (await handle(req("/api/studio/compose", { token: person, method: "POST", body: { kind: "custom", posts: [{ channel: "threads", text, text_b: text.replace("held", "kept") }] } }), e, opts)).json();
  assert.equal(made.ok, true, JSON.stringify(made));
  assert.equal(made.added.length, 2);
  for (const id of made.added) { decideDraft(d.sql, { id, decision: "approve", actor: "owner" }); recordPublish(d.sql, { id, remoteId: id }); }
  saveMetrics(d.sql, { id: made.added[0], channel: "threads", metrics: { views: 1000, likes: 10 } });
  saveMetrics(d.sql, { id: made.added[1], channel: "threads", metrics: { views: 1000, likes: 30 } });
  const g = await (await handle(req("/api/studio/growth", { token: person }), e, opts)).json();
  assert.deepEqual([g.ab.length, g.ab[0].state, g.ab[0].winner, g.measured], [1, "measured", "B", 2]);
  assert.ok("threads" in g.best_times);
  assert.deepEqual(g.evergreen, [], "not old enough yet");
});

test("team roles: unset, every person approves; set, approvers decide and set channels and the mix, editors write only", async () => {
  resetKeyCacheForTests();
  assert.equal(roleOf({}, { type: "user", subject: "a@x.com" }), "approver");
  assert.equal(roleOf({ STUDIO_APPROVERS: " Owner@Example.com , boss@x.com" }, { type: "user", subject: "owner@example.com" }), "approver");
  assert.equal(roleOf({ STUDIO_APPROVERS: "owner@example.com" }, { type: "user", subject: "writer@example.com" }), "editor");
  assert.equal(roleOf({}, { type: "service", subject: "ci" }), "service");
  const { env: e, d } = env({ CONTENT_CHANNELS: "threads", STUDIO_APPROVERS: "owner@example.com" });
  const owner = await jwt({ email: "owner@example.com" });
  const writer = await jwt({ email: "writer@example.com" });
  const who = await (await handle(req("/api/studio/whoami", { token: writer }), e, opts)).json();
  assert.deepEqual([who.role, who.can_decide, who.can_write, who.roles_set], ["editor", false, true, true]);
  const text = "Education · XAUUSD\n\nGold held its range through London.\n\nEducational analysis by Cryptophys. Not an invitation to buy or sell, and not financial advice.\n#XAUUSD";
  const post = (p, body, token) => handle(req(p, { token, method: "POST", body }), e, opts);
  const made = await (await post("/api/studio/compose", { kind: "custom", posts: [{ channel: "threads", text }] }, writer)).json();
  assert.equal(made.ok, true, "an editor writes");
  const id = made.added[0];
  const denied = await post("/api/studio/decide", { id, decision: "approve" }, writer);
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).error, "approver_only");
  assert.equal((await post("/api/studio/settings", { channel: "threads", settings: { enabled: false } }, writer)).status, 403);
  assert.equal((await post("/api/studio/mix", { targets: { key_levels: 25, pattern: 25, daily_recap: 25, custom: 25 } }, writer)).status, 403);
  assert.equal((await (await handle(req("/api/studio/settings", { token: writer }), e, opts)).json()).can_edit, false);
  assert.equal((await post("/api/studio/hashtag-sets", { name: "core", tags: "#XAUUSD" }, writer)).status, 200, "an editor manages hashtag sets");
  const ok = await (await post("/api/studio/decide", { id, decision: "approve" }, owner)).json();
  assert.equal(ok.status, "approved", "the approver decides");
  assert.deepEqual(draftEvents(d.sql, id).map((x) => [x.action, x.actor]).sort(), [["approved", "owner@example.com"], ["composed", "writer@example.com"]], "who wrote and who approved, in the history");
});

test("connecting an account through the studio: approver only, the state round trip, tokens sealed and never shown", async () => {
  resetKeyCacheForTests();
  const KEY = Buffer.alloc(32, 9).toString("base64");
  const { env: e, d } = env({ CONTENT_CHANNELS: "threads,x,telegram", THREADS_APP_ID: "app", THREADS_APP_SECRET: "APPSECRET", TOKEN_ENC_KEY: KEY, STUDIO_APPROVERS: "owner@example.com" });
  const owner = await jwt({ email: "owner@example.com" });
  const writer = await jwt({ email: "writer@example.com" });
  const provider = async (url, init) => {
    const u = String(url);
    if (u.includes("cloudflareaccess.com")) return certsFetch(url, init);
    if (u.startsWith("https://graph.threads.net/oauth/access_token")) return Response.json({ access_token: "SHORT-TOKEN", user_id: 42 });
    if (u.startsWith("https://graph.threads.net/access_token")) return Response.json({ access_token: "LONG-TOKEN", expires_in: 5184000 });
    if (u.startsWith("https://graph.threads.net/v1.0/me")) return Response.json({ id: "42", username: "xauusd-ai-cta" });
    return Response.json({ error: "unexpected " + u }, { status: 500 });
  };
  const o = { fetchImpl: provider, now: NOW };
  const post = (p, body, token) => handle(req(p, { token, method: "POST", body }), e, o);
  assert.equal((await post("/api/studio/connect/start", { channel: "threads" }, writer)).status, 403, "an editor never connects");
  assert.equal((await post("/api/studio/connect/start", { channel: "x" }, owner)).status, 400, "X's app is not set up");
  assert.equal((await post("/api/studio/connect/start", { channel: "telegram" }, owner)).status, 400, "Telegram is a bot");
  const start = await (await post("/api/studio/connect/start", { channel: "threads" }, owner)).json();
  const auth = new URL(start.url);
  assert.equal(auth.origin + auth.pathname, "https://threads.net/oauth/authorize");
  assert.equal(auth.searchParams.get("redirect_uri"), "https://cta.cryptophys.work/studio/oauth/callback");
  const state = auth.searchParams.get("state");
  // Someone else's sign-in cannot finish it; an unknown state neither.
  const cb = (q, token) => handle(req(`/studio/oauth/callback?${new URLSearchParams(q)}`, { token }), e, o);
  assert.match((await cb({ state: "f".repeat(48), code: "c" }, owner)).headers.get("location"), /oauth=error/);
  assert.match((await cb({ state, code: "c" }, writer)).headers.get("location"), /only\+an\+approver/);
  const ok = await cb({ state, code: "c0de" }, owner);
  assert.equal(ok.status, 302);
  assert.equal(ok.headers.get("location"), "/studio?oauth=ok&channel=threads#channels");
  assert.match((await cb({ state, code: "c0de" }, owner)).headers.get("location"), /unknown\+or\+used/, "a state works once");
  const stored = storedToken(d.sql, "threads");
  assert.match(stored.access_token, /^enc1:/, "sealed at rest");
  assert.ok(!stored.access_token.includes("LONG-TOKEN"));
  const acct = await accountOf(e, "threads", { stored: { access_token: "LONG-TOKEN" }, connection: { account_id: "42" } });
  assert.deepEqual([acct.access_token, acct.user_id], ["LONG-TOKEN", "42"]);
  const conns = await (await handle(req("/api/studio/connections", { token: owner }), e, o)).json();
  assert.deepEqual([conns.channels.threads.connected, conns.channels.threads.via, conns.channels.threads.account_name, conns.can_connect], [true, "oauth", "@xauusd-ai-cta", true]);
  assert.equal(conns.role, "approver", "the page can say who is signed in and as what");
  assert.equal(typeof conns.who, "string");
  assert.equal(conns.channels.x.app_configured, false);
  const text = JSON.stringify(conns);
  for (const secret of ["LONG-TOKEN", "SHORT-TOKEN", "APPSECRET", KEY, "enc1:"]) assert.ok(!text.includes(secret), `never ${secret}`);
  const check = await (await post("/api/studio/connect/check", { channel: "threads" }, owner)).json();
  assert.deepEqual(check.check, { id: "42", name: "@xauusd-ai-cta" });
  assert.equal((await post("/api/studio/connect/disconnect", { channel: "threads" }, owner)).status, 200);
  assert.equal(storedToken(d.sql, "threads"), null);
});


test("entered in the studio (owner 2026-11-17): Set up app, Paste token, Set bot; sealed, checked first, approver only, never echoed", async () => {
  resetKeyCacheForTests();
  const KEY = Buffer.alloc(32, 7).toString("base64");
  const owner = await jwt({ email: "owner@example.com" });
  const writer = await jwt({ email: "writer@example.com" });
  const provider = async (url, init) => {
    const u = String(url);
    if (u.includes("cloudflareaccess.com")) return certsFetch(url, init);
    if (u.startsWith("https://graph.threads.net/v1.0/me")) return new URL(u).searchParams.get("access_token") === "PASTED-TOKEN-123456" ? Response.json({ id: "77", username: "cta" }) : Response.json({ error: { message: "Invalid OAuth access token" } }, { status: 400 });
    if (u.startsWith("https://api.telegram.org/botBOT:TOKEN-abcdef/getMe")) return Response.json({ ok: true, result: { id: 5, username: "cta_bot" } });
    if (u.startsWith("https://api.telegram.org/botBOT:TOKEN-abcdef/getChat?")) return Response.json({ ok: true, result: { title: "CTA" } });
    if (u.startsWith("https://api.telegram.org/botBOT:TOKEN-abcdef/getChatMember")) return Response.json({ ok: true, result: { status: "administrator", can_post_messages: true } });
    return Response.json({ error: "unexpected " + u }, { status: 500 });
  };
  const o = { fetchImpl: provider, now: NOW };

  // Without the token key nothing is stored (never in the clear).
  const bare = env({ CONTENT_CHANNELS: "threads,x,telegram", STUDIO_APPROVERS: "owner@example.com" });
  const postBare = (p, body, token) => handle(req(p, { token, method: "POST", body }), bare.env, o);
  assert.equal((await postBare("/api/studio/connect/app", { channel: "x", app_id: "client-id-1", app_secret: "client-secret-xyz" }, owner)).status, 409);

  const { env: e, d } = env({ CONTENT_CHANNELS: "threads,x,telegram", TOKEN_ENC_KEY: KEY, STUDIO_APPROVERS: "owner@example.com" });
  const post = (p, body, token) => handle(req(p, { token, method: "POST", body }), e, o);
  assert.equal((await post("/api/studio/connect/app", { channel: "x", app_id: "client-id-1", app_secret: "client-secret-xyz" }, writer)).status, 403, "an editor never sets an app");
  assert.equal((await handle(req("/api/studio/connect/app", { token: owner }), e, o)).status, 405, "POST only");
  // Set up app → Connect works with the app entered in the studio.
  const app = await (await post("/api/studio/connect/app", { channel: "x", app_id: "client-id-1", app_secret: "client-secret-xyz" }, owner)).json();
  assert.deepEqual([app.ok, app.hint], [true, "…id-1"]);
  assert.match(credsOf(d.sql, { channel: "x", kind: "app" }), /^enc1:/, "sealed at rest");
  const start = await (await post("/api/studio/connect/start", { channel: "x" }, owner)).json();
  assert.equal(new URL(start.url).searchParams.get("client_id"), "client-id-1");
  // Paste token: checked with the provider first; a bad one is never stored.
  assert.equal((await post("/api/studio/connect/token", { channel: "threads", access_token: "WRONG-TOKEN-0000" }, owner)).status, 400);
  assert.equal(credsOf(d.sql, { channel: "threads", kind: "manual" }), null);
  const pasted = await (await post("/api/studio/connect/token", { channel: "threads", access_token: "PASTED-TOKEN-123456" }, owner)).json();
  assert.deepEqual([pasted.ok, pasted.hint, pasted.check.name], [true, "…3456", "@cta"]);
  const acct = await accountFor(e, "threads");
  assert.deepEqual([acct.access_token, acct.user_id], ["PASTED-TOKEN-123456", "77"], "the account id comes from the provider");
  // Set bot (Telegram): the bot must be able to post.
  const bot = await (await post("/api/studio/connect/token", { channel: "telegram", bot_token: "BOT:TOKEN-abcdef", chat_id: "@cta_channel" }, owner)).json();
  assert.deepEqual([bot.ok, bot.check.can_post], [true, true]);
  // The page sees what is set, never a secret.
  const conns = await (await handle(req("/api/studio/connections", { token: owner }), e, o)).json();
  assert.deepEqual([conns.channels.x.app_configured, conns.channels.x.app_source, conns.channels.x.app_hint], [true, "studio", "…id-1"]);
  assert.deepEqual([conns.channels.threads.connected, conns.channels.threads.via, conns.channels.telegram.connected], [true, "studio", true]);
  const text = JSON.stringify(conns) + JSON.stringify(app) + JSON.stringify(pasted) + JSON.stringify(bot);
  for (const secret of ["client-secret-xyz", "PASTED-TOKEN-123456", "BOT:TOKEN-abcdef", KEY, "enc1:"]) assert.ok(!text.includes(secret), `never ${secret}`);
  // Disconnect deletes the pasted token; Remove app deletes the app.
  assert.equal((await post("/api/studio/connect/disconnect", { channel: "threads" }, owner)).status, 200);
  assert.equal(credsOf(d.sql, { channel: "threads", kind: "manual" }), null);
  assert.equal(await accountFor(e, "threads"), null);
  assert.equal((await post("/api/studio/connect/app", { channel: "x", clear: true }, owner)).status, 200);
  assert.equal(credsOf(d.sql, { channel: "x", kind: "app" }), null);
});

test("publishing per channel (owner 2026-11-17: Telegram first, the others after it works): PUBLISH_CHANNELS names them; unset publishes nothing", async () => {
  const { publishChannels, publishesTo } = await import("../src/app.mjs");
  assert.deepEqual(publishChannels({ CONTENT_PUBLISH: "on" }), [], "on without a list: no channel (fail closed)");
  assert.deepEqual(publishChannels({ CONTENT_PUBLISH: "off", PUBLISH_CHANNELS: "telegram" }), [], "off wins");
  assert.deepEqual(publishChannels({ CONTENT_PUBLISH: "on", PUBLISH_CHANNELS: " telegram , nope ,x" }), ["telegram", "x"], "unknown names dropped");
  assert.equal(publishesTo({ CONTENT_PUBLISH: "on", PUBLISH_CHANNELS: "telegram" }, "threads"), false);
  const { env: e, d } = env({ CONTENT_PUBLISH: "on", PUBLISH_CHANNELS: "telegram", TELEGRAM_BOT_TOKEN: "123:SECRET", TELEGRAM_CHAT_ID: "@xauusd_ai_cta", X_ACCESS_TOKEN: "XSECRET" });
  addDrafts(d.sql, [{ id: "x1", channel: "x", kind: "daily_recap", text: "Education only. Not financial advice.", status: "pending" }]);
  decideDraft(d.sql, { id: "x1", decision: "approve", actor: "owner" });
  const calls = [];
  const r = await publishDraft(e, getDraft(d.sql, "x1"), { fetcher: async (url) => { calls.push(url); return Response.json({}); } });
  assert.deepEqual([r.status, r.held, calls.length], ["approved", "channel_not_publishing", 0], "an approved X draft waits: X is not named yet");
  assert.deepEqual((await (await handle(req("/health"), e, opts)).json()).publish_channels, ["telegram"]);
});

test("Publish now (owner 2026-11-17: approved while publishing was off, then no way out): an approver sends an approved or failed post on a publishing channel", async () => {
  resetKeyCacheForTests();
  const owner = await jwt({ email: "owner@example.com" });
  const writer = await jwt({ email: "writer@example.com" });
  const sent = [];
  let fail = true;
  const fetchImpl = async (url, init) => {
    const u = String(url);
    if (u.includes("cloudflareaccess.com")) return certsFetch(url, init);
    if (u.includes("api.telegram.org/bot123:SECRET/sendMessage")) { sent.push(JSON.parse(init.body)); return fail ? Response.json({ ok: false, description: "Bad Request: chat not found" }, { status: 400 }) : Response.json({ ok: true, result: { message_id: 9 } }); }
    return Response.json({ error: "unexpected " + u }, { status: 500 });
  };
  const o = { fetchImpl, now: NOW };
  const { env: e, d } = env({ CONTENT_PUBLISH: "on", PUBLISH_CHANNELS: "telegram", CONTENT_CHANNELS: "telegram,x", STUDIO_APPROVERS: "owner@example.com", TELEGRAM_BOT_TOKEN: "123:SECRET", TELEGRAM_CHAT_ID: "-1001234567890" });
  const text = "Education only. Not financial advice.";
  addDrafts(d.sql, [{ id: "t1", channel: "telegram", kind: "custom", text, status: "pending" }, { id: "x1", channel: "x", kind: "custom", text, status: "pending" }, { id: "t2", channel: "telegram", kind: "custom", text, status: "pending" }]);
  for (const id of ["t1", "x1"]) decideDraft(d.sql, { id, decision: "approve", actor: "owner" }); // approved while publishing was off: waiting
  const post = (body, token) => handle(req("/api/studio/publish-now", { token, method: "POST", body }), e, o);
  assert.equal((await post({ id: "t1" }, writer)).status, 403, "an editor never publishes");
  assert.match((await (await post({ id: "x1" }, owner)).json()).error, /does not publish yet/);
  assert.match((await (await post({ id: "t2" }, owner)).json()).error, /only an approved or failed draft/, "a pending draft is approved first");
  const first = await (await post({ id: "t1" }, owner)).json();
  assert.deepEqual([first.ok, first.status, getDraft(d.sql, "t1").status], [false, "failed", "failed"], "Telegram refused: recorded as failed");
  assert.match(first.error, /chat not found/, "the platform's refusal comes back in the answer, not only HTTP 400");
  fail = false;
  const again = await (await post({ id: "t1" }, owner)).json();
  assert.deepEqual([again.ok, again.status, getDraft(d.sql, "t1").status, getDraft(d.sql, "t1").remote_id], [true, "published", "published", "9"], "tried again: requeued, then sent");
  assert.ok(draftEvents(d.sql, "t1").some((ev) => ev.action === "requeued"), "the retry is in the draft's history");
  assert.equal(sent.length, 2);
  assert.match((await (await post({ id: "t1" }, owner)).json()).error, /only an approved or failed draft/, "never twice");
});

test("Telegram with the card: sendPhoto (multipart) with the caption when it fits, else the photo then the text", async () => {
  const calls = [];
  const fetcher = async (url, init) => { calls.push({ url: String(url), form: init.body instanceof FormData ? init.body : null, json: typeof init.body === "string" ? JSON.parse(init.body) : null }); return Response.json({ ok: true, result: { message_id: calls.length } }); };
  const image = async () => ({ bytes: new Uint8Array([255, 216, 255]), mime: "image/jpeg" });
  const account = { bot_token: "123:SECRET", chat_id: "-1001234567890" };
  const short = await publishTelegram({ account, text: "Education · XAUUSD\nChart by TradingView.", image, fetcher });
  assert.deepEqual([calls.length, /sendPhoto$/.test(calls[0].url), calls[0].form.get("caption"), calls[0].form.get("photo").type, short.remote_id], [1, true, "Education · XAUUSD\nChart by TradingView.", "image/jpeg", "1"]);
  calls.length = 0;
  const long = await publishTelegram({ account, text: "x".repeat(1500), image, fetcher });
  assert.deepEqual([calls.length, /sendPhoto$/.test(calls[0].url), calls[0].form.get("caption"), /sendMessage$/.test(calls[1].url), long.remote_id], [2, true, null, true, "2"], "over 1024: the photo, then the text");
  const dry = await publishTo("telegram", { account, draft: { text: "t", image_url: "https://cta.cryptophys.work/media/0123456789abcdef0123456789abcdef.jpg" }, dryRun: true, media: image });
  assert.match(dry.requests[0].url, /sendPhoto/);
  assert.ok(!JSON.stringify(dry).includes("SECRET"));
  const text = await publishTo("telegram", { account, draft: { text: "t", image_url: null }, dryRun: true });
  assert.match(text.requests[0].url, /sendMessage/, "a text post stays a message");
});

test("Create: the format chosen per channel before the post is made; an edit keeps the post's media", async () => {
  resetKeyCacheForTests();
  const { env: e, d } = env({ CONTENT_CHANNELS: "telegram,x" });
  const person = await jwt({ email: "owner@example.com" });
  const post = (body) => handle(req("/api/studio/compose", { token: person, method: "POST", body }), e, opts);
  const text = "Education · XAUUSD\n\nGold held its range through London.\n\nEducational analysis by Cryptophys. Not an invitation to buy or sell, and not financial advice.\n#XAUUSD";
  assert.equal((await post({ kind: "custom", posts: [{ channel: "x", text, format: "video" }] })).status, 400, "X cannot post a video yet");
  const r = await (await post({ kind: "custom", posts: [{ channel: "telegram", text, format: "image" }] })).json();
  assert.equal(r.ok, true, JSON.stringify(r));
  const made = getDraft(d.sql, r.added[0]);
  assert.deepEqual([made.status, /Chart by TradingView/.test(made.text)], ["needs_image", true]);
  const edited = editDraft(d.sql, { id: made.id, text: made.text.replace("London", "Asia"), actor: "owner@example.com", check: (x) => editCheck(x) });
  assert.equal(edited.status, "needs_image", "an edit keeps the card it was made with");
  const st = await (await handle(req("/api/studio/status", { token: person }), e, opts)).json();
  assert.deepEqual([st.channels.telegram.formats, st.channels.telegram.format], [["text", "image"], "text"], "the Create page's choices and default");
});

test("the queue by channel (owner 2026-11-17): one tab per channel, the status tabs within it", async () => {
  resetKeyCacheForTests();
  const { env: e, d } = env({ CONTENT_CHANNELS: "telegram,x" });
  const text = "Education only. Not financial advice.";
  addDrafts(d.sql, [{ id: "t1", channel: "telegram", kind: "custom", text, status: "pending" }, { id: "t2", channel: "telegram", kind: "custom", text, status: "needs_image" }, { id: "x1", channel: "x", kind: "custom", text, status: "pending" }]);
  assert.deepEqual(listDrafts(d.sql, { channel: "telegram" }).map((x) => x.id).sort(), ["t1", "t2"]);
  assert.deepEqual(listDrafts(d.sql, { channel: "telegram", status: "pending" }).map((x) => x.id), ["t1"]);
  assert.deepEqual(channelStatusCounts(d.sql), { telegram: { pending: 1, needs_image: 1 }, x: { pending: 1 } });
  const person = await jwt({ email: "owner@example.com" });
  const q = await (await handle(req("/api/studio/drafts?channel=x&status=pending", { token: person }), e, opts)).json();
  assert.deepEqual([q.drafts.map((x) => x.id), q.by_channel.telegram.needs_image], [["x1"], 1]);
  const js = readFileSync(new URL("../public/studio/studio.js", import.meta.url), "utf8");
  assert.match(js, /function renderChannelTabs/);
  assert.match(js, /"All channels"/);
});

test("Threads and X with the card (owner 2026-11-17 \"Ok\"): Threads IMAGE from the public card URL; X uploads the card, then posts with its media id", async () => {
  const card = "https://cta.cryptophys.work/media/0123456789abcdef0123456789abcdef.jpg";
  const image = async () => ({ bytes: new Uint8Array([255, 216, 255]), mime: "image/jpeg" });
  // Threads: the container is an IMAGE with the card's URL; a text draft stays TEXT.
  const th = await publishTo("threads", { account: { user_id: "7", access_token: "TSECRET" }, draft: { text: "t", image_url: card }, dryRun: true });
  assert.deepEqual([th.requests[0].params.media_type, th.requests[0].params.image_url], ["IMAGE", card]);
  assert.equal((await publishTo("threads", { account: { user_id: "7", access_token: "TSECRET" }, draft: { text: "t", image_url: null }, dryRun: true })).requests[0].params.media_type, "TEXT");
  assert.ok(!JSON.stringify(th).includes("TSECRET"));
  // X: media upload (multipart, tweet_image), then the post with the media id.
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url: String(url), form: init.body instanceof FormData ? init.body : null, json: typeof init.body === "string" ? JSON.parse(init.body) : null, auth: init.headers?.authorization });
    return String(url).endsWith("/media/upload") ? Response.json({ data: { id: "1880028106020515840" } }) : Response.json({ data: { id: "99" } });
  };
  const r = await publishX({ account: { access_token: "XSECRET" }, text: "Education · XAUUSD\nChart by TradingView.", image, fetcher });
  assert.deepEqual([calls.length, calls[0].url.endsWith("/2/media/upload"), calls[0].form.get("media_category"), calls[0].form.get("media").type], [2, true, "tweet_image", "image/jpeg"]);
  assert.deepEqual([calls[1].json.media.media_ids, r.remote_id], [["1880028106020515840"], "99"]);
  await assert.rejects(publishX({ account: { access_token: "XSECRET" }, text: "t", image, fetcher: async () => Response.json({ title: "Forbidden", detail: "missing media.write" }, { status: 403 }) }), /media upload 403 missing media\.write/);
  const dry = await publishTo("x", { account: { access_token: "XSECRET" }, draft: { text: "t", image_url: card }, dryRun: true, media: image });
  assert.deepEqual(dry.requests.map((q) => q.url.replace(/^https:\/\/api\.x\.com/, "")), ["/2/media/upload", "/2/tweets"]);
  assert.ok(!JSON.stringify(dry).includes("XSECRET"));
});

test("Create → War Room through the studio API (owner 2026-11-18): the source's reading as analysis; an AI Worker without it says so", async () => {
  resetKeyCacheForTests();
  const asked = [];
  const reading = { source: "4h", label: "4H", at: "2026-11-18T16:00:00.000Z", bias: "bullish", analysts: 9, reasons: ["Buyers defended the weekly pivot range."], metrics: ["weekly pivot central range"] };
  const base = env({ CONTENT_CHANNELS: "threads,x" });
  const e = { ...base.env, PROJECTION: { ...base.env.PROJECTION, warroom: async (input) => { asked.push(input); return reading; } } };
  const person = await jwt({ email: "owner@example.com" });
  const t = await (await handle(req("/api/studio/templates?kind=warroom&ref=4h&channels=threads", { token: person }), e, opts)).json();
  assert.deepEqual(asked, [{ source: "4h" }]);
  assert.deepEqual([t.ref, t.options.map((o) => o.ref), t.at], ["4h", ["news", "15m", "1h", "4h", "1d"], reading.at]);
  assert.match(t.texts.threads, /^Education · XAUUSD 4H War Room reading\n\nBias on the 4-hour chart: Bullish \(9 analysts heard\)\./);
  const c = await (await handle(req("/api/studio/check", { token: person, method: "POST", body: { kind: "warroom", channel: "threads", text: t.texts.threads } }), e, opts)).json();
  assert.equal(c.guardian.pass, true, JSON.stringify(c.guardian.failures));
  const old = { ...base.env };
  const n = await (await handle(req("/api/studio/templates?kind=warroom&ref=1d&channels=threads", { token: person }), old, opts)).json();
  assert.deepEqual([n.texts.threads, n.note], [null, "No reading from this source right now (the AI Worker has no War Room reading yet)."]);
  const bad = await (await handle(req("/api/studio/templates?kind=warroom&ref=5m&channels=threads", { token: person }), e, opts)).json();
  assert.equal(bad.ref, "news", "an unknown source reads the news");
});

test("the Agent page's API (owner 2026-11-25, the CTA agent's Checks): a person reads the Threads drafts' checks; nothing changes", async () => {
  resetKeyCacheForTests();
  const { env: e, d } = env();
  addDrafts(d.sql, [
    { id: "th1", channel: "threads", kind: "custom", text: "Education · XAUUSD\n\nGold held its range.\n\nEducational analysis by Cryptophys. Not financial advice.\n#XAUUSD #gold #education", status: "pending" },
    { id: "tg1", channel: "telegram", kind: "custom", text: "Education only. Not financial advice.", status: "pending" }
  ]);
  assert.equal((await handle(req("/api/studio/agent"), e, opts)).status, 403, "behind Access");
  const a = await (await handle(req("/api/studio/agent", { token: await jwt({ email: "owner@example.com" }) }), e, opts)).json();
  assert.deepEqual(a.checks.map((c) => c.id), ["th1"], "Threads only");
  assert.deepEqual([a.channel, a.active, a.channels.filter((c) => c.active).map((c) => c.id)], ["threads", true, ["threads"]]);
  const tg = await (await handle(req("/api/studio/agent?channel=telegram", { token: await jwt({ email: "owner@example.com" }) }), e, opts)).json();
  assert.deepEqual([tg.channel, tg.active, "checks" in tg, "audit" in tg], ["telegram", false, false, false], "a channel the agent does not manage yet: no data");
  assert.equal(a.checks[0].text.endsWith("Not financial advice."), true, "what Threads gets: no hashtag line");
  assert.equal(a.topic_tag, "XAUUSD");
  assert.equal(getDraft(d.sql, "th1").text.endsWith("#education"), true, "the draft itself is unchanged");
});

test("the model's switch (the CTA agent's router): an approver turns it off and on, same origin; the Agent page shows it", async () => {
  resetKeyCacheForTests();
  const { env: e } = env({ REFLECTION_API_KEY: "rk-test" });
  const person = await jwt({ email: "owner@example.com", sub: "u1" });
  const service = await jwt({ common_name: "svc.access", sub: "" });
  const post = (body, extra = {}) => handle(req("/api/studio/agent/model", { method: "POST", body, ...extra }), e, opts);
  const first = await (await handle(req("/api/studio/agent", { token: person }), e, opts)).json();
  // Command's CTA row is the switch (owner 2026-11-27: "usulan saya"); the studio's switch only turns Beam off.
  assert.deepEqual([first.model.enabled, first.model.reason, first.model.connected, first.model.command], [true, null, false, null], "not stopped here; Command not connected yet");
  assert.equal((await post({ enabled: false }, { token: service })).status, 403, "never a service token");
  assert.equal((await post({ enabled: false }, { token: person, origin: "https://evil.example" })).status, 403, "same origin only");
  assert.equal((await post({ enabled: "no" }, { token: person })).status, 400);
  assert.equal((await post({ enabled: false }, { token: person })).status, 200);
  const a = await (await handle(req("/api/studio/agent", { token: person }), e, opts)).json();
  assert.deepEqual([a.model.enabled, a.model.has_key, a.model.reason, a.model.host, a.model.cap_usd], [false, true, "turned off in the studio", "api.reflection.ai", 1]);
  assert.ok(!JSON.stringify(a).includes("rk-test"), "the key never reaches the page");
  await post({ enabled: true }, { token: person });
  assert.equal((await (await handle(req("/api/studio/agent", { token: person }), e, opts)).json()).model.enabled, true);
});

test("the agent's Replies end to end (owner 2026-11-25): the first run starts a 72-hour dry run that sends nothing; then live; the switch stops it", async () => {
  resetKeyCacheForTests();
  const { env: e, d } = env({ AGENT_REPLIES: "on", CONTENT_PUBLISH: "on", PUBLISH_CHANNELS: "threads", THREADS_ACCESS_TOKEN: "T", THREADS_USER_ID: "77" });
  const T0 = Date.parse("2026-11-25T06:00:00Z");
  addDrafts(d.sql, [{ id: "p1", channel: "threads", kind: "custom", text: "Education · XAUUSD\n\nGold held its range.\n\nNot financial advice.", status: "pending" }], { now: T0 - 7_200_000 });
  decideDraft(d.sql, { id: "p1", decision: "approve", actor: "owner" }, { now: T0 - 7_100_000 });
  recordPublish(d.sql, { id: "p1", remoteId: "999" }, { now: T0 });
  const sent = [];
  const fetcher = async (url, init) => {
    const u = String(url);
    if (u.includes("/me?")) return Response.json({ id: "77" });
    if (u.includes("/999/replies")) return Response.json({ data: [{ id: "501", text: "should I buy now?", username: "alice", is_reply_owned_by_me: false }] });
    if (u.endsWith("/77/threads")) { sent.push(Object.fromEntries(new URLSearchParams(String(init.body)))); return Response.json({ id: "c9" }); }
    if (u.includes("/c9?")) return Response.json({ status: "FINISHED" });
    if (u.endsWith("/threads_publish")) return Response.json({ id: "r9" });
    throw new Error(`unexpected ${u}`);
  };
  const first = await agentReplies(e, { now: T0, fetcher, sleep: async () => {} });
  assert.equal(first.status, "dry_run");
  assert.deepEqual([first.channels.threads.logged, sent.length], [1, 0], "the dry run logs and sends nothing");
  assert.equal(studioSetting(d.sql, "agent_replies").value.since, new Date(T0).toISOString(), "the dry run starts at the first run");
  const person = await jwt({ email: "owner@example.com", sub: "u1" });
  const page = await (await handle(req("/api/studio/agent", { token: person }), e, opts)).json();
  assert.deepEqual([page.replies.mode, page.replies.recent[0].status, page.replies.recent[0].username], ["dry_run", "dry_run", "alice"]);
  // live after 72 hours (the post still inside the 3-day window): a new reply is answered, the old one is not read again
  const later = T0 + 72 * 3_600_000;
  assert.equal((await agentReplies(e, { now: later, fetcher, sleep: async () => {} })).status, "dry_run", "live waits for the About lede");
  assert.equal((await handle(req("/api/studio/agent/replies", { method: "POST", body: { about_lede_ok: true }, token: person }), e, opts)).status, 200);
  const f2 = async (url, init) => (String(url).includes("/999/replies") ? Response.json({ data: [{ id: "501", text: "should I buy now?", username: "alice" }, { id: "502", text: "sell or hold?", username: "bob" }] }) : fetcher(url, init));
  const live = await agentReplies(e, { now: later, fetcher: f2, sleep: async () => {} });
  assert.deepEqual([live.status, live.channels.threads.answered, sent.length, sent[0].reply_to_id, sent[0].text.endsWith("Not financial advice.")], ["live", 1, 1, "502", true]);
  // the switch: an approver stops it, logged; then nothing runs
  const post = (body, extra = {}) => handle(req("/api/studio/agent/replies", { method: "POST", body, ...extra }), e, opts);
  assert.equal((await post({ enabled: false }, { token: await jwt({ common_name: "svc.access", sub: "" }) })).status, 403);
  assert.equal((await post({ enabled: false }, { token: person })).status, 200);
  assert.equal((await agentReplies(e, { now: later, fetcher: f2 })).status, "off");
  assert.equal((await agentReplies({ ...e, AGENT_REPLIES: "off" }, { now: later, fetcher: f2 })).status, "off", "the var stops it too");
});

test("auto-approve end to end (owner 2026-11-25): a Threads pattern draft goes out by itself 15 minutes after it is ready; an edited one waits", async () => {
  resetKeyCacheForTests();
  const { env: e, d } = env({ CONTENT_PUBLISH: "on", PUBLISH_CHANNELS: "threads,telegram", THREADS_ACCESS_TOKEN: "T", THREADS_USER_ID: "77", TELEGRAM_BOT_TOKEN: "B", TELEGRAM_CHAT_ID: "@c" });
  const T0 = Date.parse("2026-11-25T06:00:00Z");
  const text = "Education · Pattern breakout · XAUUSD H1\nFlag\n\nEducational analysis by Cryptophys. Not an invitation to buy or sell, and not financial advice.";
  addDrafts(d.sql, [
    { id: "pattern:a:threads", channel: "threads", kind: "pattern", text, status: "pending" },
    { id: "pattern:b:threads", channel: "threads", kind: "pattern", text, status: "pending" },
    { id: "pattern:a:telegram", channel: "telegram", kind: "pattern", text, status: "pending" },
    { id: "custom:x:threads", channel: "threads", kind: "custom", text, status: "pending" }
  ], { now: T0 });
  const edited = editDraft(d.sql, { id: "pattern:b:threads", text: text.replace("Flag", "Flag (edited)"), actor: "owner@example.com", check: () => ({ guardian: { pass: true, failures: [] } }) }, { now: T0 + 60_000 });
  assert.equal(edited.ok, true, JSON.stringify(edited));
  const posted = [];
  const fetcher = async (url, init) => {
    const u = String(url);
    if (u.includes("/me?")) return Response.json({ id: "77" });
    if (u.endsWith("/77/threads")) { posted.push(Object.fromEntries(new URLSearchParams(String(init.body)))); return Response.json({ id: "c1" }); }
    if (u.includes("/c1?")) return Response.json({ status: "FINISHED" });
    if (u.endsWith("/threads_publish")) return Response.json({ id: "p1" });
    if (u.includes("threads_publishing_limit")) return Response.json({ data: [{ quota_usage: 0, config: { quota_total: 250 } }] });
    throw new Error(`unexpected ${u}`);
  };
  const person = await jwt({ email: "owner@example.com" });
  const queue = await (await handle(req("/api/studio/drafts?status=pending&channel=threads", { token: person }), e, opts)).json();
  assert.equal(queue.drafts.find((x) => x.id === "pattern:a:threads").auto_at, "2026-11-25T06:00:00.000Z", "the queue shows when it goes out by itself: as soon as it is ready");
  assert.equal(queue.drafts.find((x) => x.id === "pattern:b:threads").auto_at, null, "an edited draft waits for a person");
  assert.equal("auto_at" in queue.drafts.find((x) => x.id === "custom:x:threads"), false, "never a custom post");
  assert.equal((await runSchedule(e, { now: T0 - 60_000, fetcher })).auto, undefined, "nothing before it is ready");
  const r = await runSchedule(e, { now: T0 + 60_000, fetcher });
  assert.deepEqual(r.auto.map((x) => [x.id, x.status, x.publish]), [["pattern:a:threads", "approved", "published"]]);
  assert.equal(getDraft(d.sql, "pattern:a:threads").decided_by, "auto-approve");
  assert.equal(posted.length, 1);
  assert.deepEqual([getDraft(d.sql, "pattern:b:threads").status, getDraft(d.sql, "pattern:a:telegram").status, getDraft(d.sql, "custom:x:threads").status], ["pending", "pending", "pending"], "edited, another channel without the rule, a custom post: they wait");
});

test("cta-write end to end (rule 4 amended): the switch, a written post auto-approved and published in the run that wrote it, a failed guard keeps the template, the kill switch", async () => {
  resetKeyCacheForTests();
  const AGENTS = { syscall: async (agent, capability) => (capability === "model_router.status" ? { outcome: "succeeded", result: { schema: "model_router.status.v1", system: "cta", state: { state: "on", mode: "free_only" }, global: { paid_off: 0 } } } : { outcome: "succeeded", result: {} }) };
  const { env: e, d } = env({ CONTENT_PUBLISH: "on", PUBLISH_CHANNELS: "threads", THREADS_ACCESS_TOKEN: "T", THREADS_USER_ID: "77", REFLECTION_API_KEY: "rk-test", AGENTS });
  const T0 = Date.parse("2026-11-25T06:00:00Z");
  const TEMPLATE = "Education · Pattern breakout · XAUUSD H1\nRounding Top · direction down\n\nBreakout line 3570.54\nThe pattern fails if an H1 candle closes back above 3689.87.\nPrice when read: 3555.10 · 12:09 AM UTC\n\nEducational analysis by Cryptophys. Not an invitation to buy or sell, and not financial advice.";
  const GOOD = "Rounding Top, direction down.\n\nThe breakout line is at 3570.54.\nIt fails if an H1 candle closes back above 3689.87.\nPrice when read: 3555.10 at 12:09 AM UTC.";
  addDrafts(d.sql, [
    { id: "pattern:a:threads", channel: "threads", kind: "pattern", text: TEMPLATE, status: "pending" },
    { id: "pattern:b:threads", channel: "threads", kind: "pattern", text: TEMPLATE.replace("Rounding Top", "Double Top"), status: "pending" }
  ], { now: T0 });
  const answers = [GOOD, GOOD.replace("Rounding Top", "Double Top") + " Target 3427.31."];
  const posted = [];
  const fetcher = async (url, init) => {
    const u = String(url);
    if (u.startsWith("https://api.reflection.ai/")) return Response.json({ choices: [{ message: { content: answers.shift() } }], usage: { prompt_tokens: 300, completion_tokens: 60 } }, { headers: { "reflection-data-retention": "zero" } });
    if (u.includes("/me?")) return Response.json({ id: "77" });
    if (u.endsWith("/77/threads")) { posted.push(Object.fromEntries(new URLSearchParams(String(init.body)))); return Response.json({ id: "c1" }); }
    if (u.includes("/c1?")) return Response.json({ status: "FINISHED" });
    if (u.endsWith("/threads_publish")) return Response.json({ id: "p1" });
    if (u.includes("threads_publishing_limit")) return Response.json({ data: [{ quota_usage: 0, config: { quota_total: 250 } }] });
    throw new Error(`unexpected ${u}`);
  };
  const person = await jwt({ email: "owner@example.com", sub: "u1" });
  const post = (path, body, at) => handle(req(path, { method: "POST", body, token: person }), e, { ...opts, now: at / 1000 });
  // off by default: the template stays and nothing is asked of the model
  const a0 = await (await handle(req("/api/studio/agent", { token: person }), e, opts)).json();
  assert.deepEqual([a0.write.mode, a0.write.enabled], ["off", false]);
  assert.equal((await post("/api/studio/agent/write", { enabled: "yes" }, T0)).status, 400);
  assert.equal((await post("/api/studio/agent/write", { enabled: true, kinds: ["custom"] }, T0)).status, 400, "never a custom post");
  assert.equal((await post("/api/studio/agent/model", { enabled: true }, T0)).status, 200);
  assert.equal((await post("/api/studio/agent/write", { enabled: true }, T0)).status, 200);
  assert.equal((await agentWrite(e, { now: T0 + 60_000, fetcher })).status, "off", "still off: About's sentence about the model is not in (about_lede_ok)");
  assert.equal(getDraft(d.sql, "pattern:a:threads").text, TEMPLATE);
  assert.equal((await post("/api/studio/agent/replies", { about_lede_ok: true }, T0)).status, 200);
  // the same run writes first, then approves and publishes at once (window 0, owner 2026-11-25)
  const r = await runSchedule(e, { now: T0 + 5 * 60_000, fetcher });
  assert.deepEqual([r.written.written, r.written.kept], [1, 1], JSON.stringify(r.written));
  assert.deepEqual(r.auto.map((x) => [x.id, x.publish]).sort(), [["pattern:a:threads", "published"], ["pattern:b:threads", "published"]], "the written one and the template kept: both go out in the run that checked them");
  assert.ok(posted.find((p) => p.text?.includes("The breakout line is at 3570.54.")), "the written text went out");
  const a = getDraft(d.sql, "pattern:a:threads"), b = getDraft(d.sql, "pattern:b:threads");
  assert.ok(a.text.startsWith("Education - Pattern breakout - XAUUSD H1\nRounding Top, direction down.\n\nThe breakout line is at 3570.54."), a.text);
  assert.equal(a.guardian.pass, true);
  assert.ok(b.text.startsWith("Education - Pattern breakout - XAUUSD H1\nDouble Top - direction down\n\nBreakout line 3570.54"), "an added number: the template stays (published, humanized)");
  assert.deepEqual(draftEvents(d.sql, "pattern:b:threads").map((x) => x.action).sort(), ["approved", "drafted", "published", "publishing", "write_kept"]);
  assert.match(draftEvents(d.sql, "pattern:b:threads").find((x) => x.action === "write_kept").detail, /number_added/);
  assert.match(draftEvents(d.sql, "pattern:a:threads").find((x) => x.action === "written").detail, /template: Education · Pattern breakout/, "the template is kept in the history");
  assert.equal((await runSchedule(e, { now: T0 + 10 * 60_000, fetcher })).written, undefined, "each draft is tried once");
  assert.deepEqual(r.auto.find((x) => x.id === "pattern:a:threads"), { channel: "threads", id: "pattern:a:threads", kind: "pattern", decided_by: "auto-approve", status: "approved", publish: "published" });
  const page = await (await handle(req("/api/studio/agent", { token: person }), e, { ...opts, now: (T0 + 22 * 60_000) / 1000 })).json();
  assert.equal(page.write.mode, "on");
  assert.deepEqual(page.write.recent.map((x) => x.action).sort(), ["write_kept", "written"]);
  assert.ok(page.model.today.calls >= 2, "each call counts against the model's daily cap");
  // the kill switch: off, and the next fresh draft keeps its template without a model call
  assert.equal((await post("/api/studio/agent/write", { enabled: false }, T0 + 23 * 60_000)).status, 200);
  addDrafts(d.sql, [{ id: "pattern:c:threads", channel: "threads", kind: "pattern", text: TEMPLATE, status: "pending" }], { now: T0 + 24 * 60_000 });
  answers.push("should never be asked");
  await runSchedule(e, { now: T0 + 25 * 60_000, fetcher });
  assert.equal(answers.length, 1, "no model call");
  assert.ok(!draftEvents(d.sql, "pattern:c:threads").some((x) => x.action === "written"), "the template, not a written text");
});

test("the About gate (about_lede_ok): set by an approver only while /about carries the owner's sentence; the event keeps who and when", async () => {
  resetKeyCacheForTests();
  const OLD = "Every post starts as numbers from the Cryptophys system and ends as a short, checked text that a person approved. No post is written freely by a model.";
  assert.ok(readFileSync("public/about.html", "utf8").includes(`<p class="lede">${ABOUT_LEDE}</p>`), "the page carries the owner's sentence (#86)");
  const page = (html) => ({ fetch: async (r) => new URL(r.url).pathname === "/about" ? new Response(html, { status: 200 }) : new Response("x", { status: 404 }) });
  const owner = await jwt({ email: "owner@example.com", sub: "u1" }), viewer = await jwt({ email: "writer@example.com", sub: "u2" });
  const set = (e, token) => handle(req("/api/studio/agent/replies", { method: "POST", body: { about_lede_ok: true }, token }), e, opts);
  const old = env({ STUDIO_APPROVERS: "owner@example.com", ASSETS: page(`<p class="lede">${OLD}</p>`) });
  const r409 = await set(old.env, owner);
  assert.equal(r409.status, 409);
  assert.equal((await r409.json()).error, "lede_not_live");
  assert.equal(studioSetting(old.d.sql, "agent_replies"), null, "nothing saved");
  const live = env({ STUDIO_APPROVERS: "owner@example.com" });
  assert.equal(await aboutLedeLive(live.env, new URL("https://cta.cryptophys.work/")), true);
  assert.equal((await set(live.env, viewer)).status, 403, "not an approver");
  const ok = await set(live.env, owner);
  assert.equal(ok.status, 200);
  const v = studioSetting(live.d.sql, "agent_replies").value;
  assert.deepEqual([v.about_lede_ok, v.about_lede_set_by], [true, "owner@example.com"]);
  assert.ok(Number.isFinite(Date.parse(v.about_lede_set_at)));
  assert.ok(draftEvents(live.d.sql, "studio:agent_replies").some((x) => x.action === "settings_saved" && x.actor === "owner@example.com"), "an event: who and when");
  assert.equal((await handle(req("/api/studio/agent/replies", { method: "POST", body: { about_lede_ok: false }, token: owner }), old.env, opts)).status, 200, "turning it off needs no check");
  const js = readFileSync("public/studio/studio.js", "utf8");
  assert.match(js, /About's sentence about the model is live/);
});

test("one claim before publishing (orchestrator review of #93): two runs publishing one draft at the same moment make exactly one platform call", async () => {
  resetKeyCacheForTests();
  const { env: e, d } = env({ CONTENT_PUBLISH: "on", PUBLISH_CHANNELS: "telegram", TELEGRAM_BOT_TOKEN: "123:SECRET", TELEGRAM_CHAT_ID: "@c" });
  addDrafts(d.sql, [{ id: "t1", channel: "telegram", kind: "daily_recap", text: "Education only. Not financial advice.", status: "pending" }]);
  decideDraft(d.sql, { id: "t1", decision: "approve", actor: "owner" });
  let calls = 0;
  const fetcher = async () => { calls++; await new Promise((r) => setTimeout(r, 20)); return Response.json({ ok: true, result: { message_id: 7 } }); };
  const [a, b] = await Promise.all([publishDraft(e, getDraft(d.sql, "t1"), { fetcher }), publishDraft(e, getDraft(d.sql, "t1"), { fetcher })]);
  assert.equal(calls, 1, "exactly one API call");
  assert.ok([a, b].some((x) => x.status === "published") && [a, b].some((x) => x.held === "already_publishing"), JSON.stringify([a, b]));
  assert.equal(getDraft(d.sql, "t1").status, "published");
  assert.deepEqual(draftEvents(d.sql, "t1").filter((x) => x.action === "publishing").length, 1, "one claim");
  // a claim left by a run that died: failed after CLAIM_STALE_MS, for a person to check; never republished by itself
  addDrafts(d.sql, [{ id: "t2", channel: "telegram", kind: "daily_recap", text: "Education only. Not financial advice.", status: "pending" }]);
  decideDraft(d.sql, { id: "t2", decision: "approve", actor: "owner" });
  const T = Date.now();
  assert.equal(claimPublish(d.sql, { id: "t2" }, { now: T }).ok, true);
  assert.deepEqual(claimPublish(d.sql, { id: "t2" }, { now: T + 60_000 }), { ok: false, status: "publishing" }, "never claimed twice");
  assert.deepEqual(failStuckPublishing(d.sql, { now: T + 5 * 60_000 }), [], "a fresh claim stays");
  assert.deepEqual(failStuckPublishing(d.sql, { now: T + 11 * 60_000 }), ["t2"]);
  assert.deepEqual([getDraft(d.sql, "t2").status, getDraft(d.sql, "t2").error], ["failed", STUCK_NOTE]);
  assert.deepEqual(claimPublish(d.sql, { id: "t2" }, { now: T + 12 * 60_000 }), { ok: false, status: "failed" }, "a failed draft is not claimed: a person uses Publish now");
  assert.deepEqual(claimPublish(d.sql, { id: "t1" }, { now: T }), { ok: false, status: "published" }, "a published draft is never claimed");
});


test("the public Archive: one line per post across channels, Telegram only when no other channel has it (owner 2026-11-26)", async () => {
  const { env: e, d } = env({});
  const t = "Education only. Not financial advice.";
  const posts = [
    ["levels:H1:20261125T170000Z:threads", 0], ["levels:H1:20261125T170000Z:telegram", 0],
    ["pattern:H1:rounding_top:confirmed:3690:3575:telegram", 0],
    ["daily:2026-11-24:threads", -60_000], ["daily:2026-11-24:instagram", -30_000],
    ["levels:H1:20261125T160000Z:telegram", -3_600_000], ["levels:H1:20261125T160000Z:threads", -3_590_000]
  ];
  const kind = (id) => (id.startsWith("levels") ? "key_levels" : id.startsWith("pattern") ? "pattern" : "daily_recap");
  addDrafts(d.sql, posts.map(([id]) => ({ id, kind: kind(id), channel: id.split(":").at(-1), text: t, status: "approved" })));
  const at = Date.parse("2026-11-25T17:09:54Z");
  for (const [id, dt] of posts) recordPublish(d.sql, { id, remoteId: "r" }, { now: at + dt });
  const listed = (await (await handle(req("/api/public/archive"), e, opts)).json()).posts.map((p) => [p.id, p.channel]);
  assert.deepEqual(listed, [
    ["pattern:H1:rounding_top:confirmed:3690:3575:telegram", "telegram"],
    ["levels:H1:20261125T170000Z:threads", "threads"],
    ["daily:2026-11-24:instagram", "instagram"],
    ["levels:H1:20261125T160000Z:threads", "threads"]
  ], "Threads + Telegram: the Threads line only; Telegram only: once; Threads + Instagram: once, the newest; newest first (a tie by channel name)");
  assert.equal(new Set(listed.map(([id, ch]) => postKey({ id, channel: ch }))).size, listed.length, "no post twice");
  assert.deepEqual(ARCHIVE_LAST_CHANNELS, ["telegram"]);
  assert.equal(postKey({ id: "manual:2026-11-24:b50daba1:threads", channel: "threads" }), "manual:2026-11-24:b50daba1");
  assert.equal(postKey({ id: "odd", channel: "threads" }), "odd");
});

test("a pattern is posted when it becomes confirmed, not again while it stays so, even as its band moves (owner 2026-11-25)", async () => {
  // 26 Nov: the H1 rising wedge was posted on Threads at 06:09 (3618:3606) and at 07:09 (3622:3620); the bands do not overlap.
  const wedge = (upper, lower) => ({ chart: "H1", pattern: "wedge_rising", name: "Rising Wedge", status: "confirmed", direction: "down", upper, lower, projection: 3580 });
  let reading = { at: "2026-11-26T06:09:00.000Z", price: 3600, zones: [], patterns: [wedge(3618, 3606)], structure: {} };
  const base = env({ CONTENT_CHANNELS: "threads" });
  const e = { ...base.env, PROJECTION: { ...base.env.PROJECTION, analysis: async () => reading } };
  const ids = (r) => r.drafts.map((x) => x.id).filter((x) => x.startsWith("pattern:"));
  const r1 = await draftAnalysis(e, { now: Date.parse("2026-11-26T06:09:30Z") });
  assert.deepEqual(ids(r1), ["pattern:H1:wedge_rising:confirmed:3618:3606:threads"], "posted when it is first seen confirmed");
  assert.deepEqual(studioSetting(base.d.sql, PATTERN_SEEN_KEY).value.keys, ["H1:wedge_rising:confirmed"]);
  reading = { ...reading, at: "2026-11-26T07:09:00.000Z", patterns: [wedge(3622, 3620)] };
  assert.deepEqual(ids(await draftAnalysis(e, { now: Date.parse("2026-11-26T07:09:30Z") })), [], "the moved band is the same pattern: not again");
  // A failed read (no patterns list) does not reset what was seen; a run without it does, and its return is new.
  reading = { ...reading, patterns: undefined };
  await draftAnalysis(e, { now: Date.parse("2026-11-26T08:09:30Z") });
  assert.deepEqual(studioSetting(base.d.sql, PATTERN_SEEN_KEY).value.keys, ["H1:wedge_rising:confirmed"]);
  reading = { ...reading, patterns: [] };
  await draftAnalysis(e, { now: Date.parse("2026-11-26T09:09:30Z") });
  assert.deepEqual(studioSetting(base.d.sql, PATTERN_SEEN_KEY).value.keys, []);
  reading = { ...reading, patterns: [wedge(3700, 3690)] };
  assert.deepEqual(ids(await draftAnalysis(e, { now: Date.parse("2026-11-26T10:09:30Z") })), ["pattern:H1:wedge_rising:confirmed:3700:3690:threads"], "confirmed again after it was gone, at a band that does not overlap: a new post");
});

test("the public Archive: a pattern posted again before #97 and #100 shows once, as its earliest publish (owner 2026-11-26)", async () => {
  const { env: e, d } = env({});
  const t = "Education only. Not financial advice.";
  const posts = [
    ["pattern:H1:wedge_rising:confirmed:3618:3606:threads", "2026-11-26T06:09:50Z"],
    ["pattern:H1:wedge_rising:confirmed:3622:3620:threads", "2026-11-26T07:09:55Z"],
    ["pattern:H1:broadening_right_angled_descending:confirmed:3600:3483:telegram", "2026-11-25T16:09:54Z"],
    ["pattern:H1:broadening_right_angled_descending:confirmed:3602:3479:telegram", "2026-11-25T17:09:54Z"],
    ["pattern:H1:rounding_top:confirmed:3690:3571:threads", "2026-11-19T01:41:01Z"],
    ["pattern:H1:rounding_top:confirmed:3690:3575:telegram", "2026-11-25T17:09:54Z"],
    ["levels:H1:20261126T070000Z:threads", "2026-11-26T07:09:55Z"],
    ["levels:H1:20261126T060000Z:threads", "2026-11-26T06:09:50Z"]
  ];
  addDrafts(d.sql, posts.map(([id]) => ({ id, kind: id.startsWith("levels") ? "key_levels" : "pattern", channel: id.split(":").at(-1), text: t, status: "approved" })));
  for (const [id, at] of posts) recordPublish(d.sql, { id, remoteId: "r" }, { now: Date.parse(at) });
  const listed = (await (await handle(req("/api/public/archive"), e, opts)).json()).posts.map((p) => p.id);
  assert.deepEqual(listed, [
    "levels:H1:20261126T070000Z:threads",
    "levels:H1:20261126T060000Z:threads",
    "pattern:H1:wedge_rising:confirmed:3618:3606:threads",
    "pattern:H1:rounding_top:confirmed:3690:3575:telegram",
    "pattern:H1:broadening_right_angled_descending:confirmed:3600:3483:telegram",
    "pattern:H1:rounding_top:confirmed:3690:3571:threads"
  ], "the wedge once (06:09), the broadening once (16:09); the rounding top again after 120 H1 bars (5 days); maps untouched");
  // Archive only: the desk keeps every publish.
  assert.equal(getDraft(d.sql, "pattern:H1:wedge_rising:confirmed:3622:3620:threads").status, "published");
  assert.deepEqual(onePatternPost([{ id: "manual:x:threads", published_at: "2026-11-26T00:00:00Z" }]).length, 1);
});

test("the daily recap asks for 2 days and up to 200 rows and drafts the projection's last 24 hours (owner 2026-11-26: \"1.a\")", async () => {
  const now = Date.parse("2026-11-26T22:17:00Z");
  const asked = [];
  const rows = Array.from({ length: 96 }, (_, i) => ({ bar_close: new Date(now - 60_000 - i * 15 * 60_000).toISOString(), stance: "WAIT", bias: "NEUTRAL", session: "london" }));
  const base = env({ CONTENT_CHANNELS: "threads" });
  const e = { ...base.env, PROJECTION: { ...base.env.PROJECTION, recaps: async (input) => { asked.push(input); return { delay_hours: 0, recaps: rows }; } } };
  const { draftDay } = await import("../src/app.mjs");
  const r = await draftDay(e, { now });
  assert.deepEqual(asked, [{ days: 2, limit: 200 }]);
  assert.deepEqual([r.bars, r.window_delay_hours, r.added], [96, 0, ["daily:2026-11-26:threads"]]);
  // Before xauusd RC1 the RPC still gives 50 rows: nothing is drafted, and the log says the reply was cut.
  const old = { ...base.env, PROJECTION: { ...base.env.PROJECTION, recaps: async () => ({ delay_hours: 0, recaps: rows.slice(0, 50) }) } };
  const c = await draftDay(old, { now });
  assert.deepEqual([c.cut, c.rows, c.added], [true, 50, []]);
});
