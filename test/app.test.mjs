// The CTA app's HTTP face: the public page's API, the studio behind Access (the JWT checked here, fail closed),
// a person's decision, the dry run, publishing held while CONTENT_PUBLISH is off; the X and Telegram publishers;
// the organ's DNA within the platform's external ceiling.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { handle, accountOf, publishDraft, SECRETS, STUDIO_SECRETS, roleOf, channelsOf, renderImages, collectInsights, runSchedule } from "../src/app.mjs";
import { resetKeyCacheForTests } from "../src/access.mjs";
import { addDrafts, listDrafts, getDraft, draftEvents, decideDraft, recordPublish, deskCounts, storedToken, storeToken, draftIdsWithPrefix, kindCountsSince, publishedPosts, draftsNeedingImage, attachImage, mediaOf, noteDraft, publishedSince, saveMetrics, storedSettings, saveChannelSettings, channelCountsSince, searchDrafts, editDraft, duplicateDraft, calendarMonth, listMedia, nextApproved, approvedCounts, claimSlot, slotOutcome, recentSlots, addLink, getLink, countClick, listLinks, listHashtagSets, saveHashtagSet, studioSetting, saveStudioSetting, kindMixSince, addAbTest, listAbTests, measuredPosts, copiedSince } from "../src/desk.mjs";
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
  return { exec(q, ...b) { const s = db.prepare(q); const out = /^\s*SELECT/i.test(q) ? s.all(...b) : (s.run(...b), []); return { toArray: () => out.map((r) => ({ ...r })) }; } };
}
/** The ContentDesk Durable Object's RPC surface over node:sqlite. */
function deskStub() {
  const sql = sqlite();
  const api = {
    add: async (d, now, actor) => addDrafts(sql, d, { now, ...(actor ? { actor } : {}) }), list: async (i) => listDrafts(sql, i ?? {}),
    get: async (id) => { const d = getDraft(sql, id); return d ? { ...d, events: draftEvents(sql, id) } : null; },
    decide: async (i, now) => decideDraft(sql, i, { now }), published: async (i, now) => recordPublish(sql, i, { now }),
    counts: async () => deskCounts(sql), token: async (c) => storedToken(sql, c), saveToken: async (c, t, now) => { storeToken(sql, c, t, { now }); return true; },
    idsWithPrefix: async (p) => draftIdsWithPrefix(sql, p), kindCounts: async (k, s) => kindCountsSince(sql, k, s), archive: async (n) => publishedPosts(sql, { limit: n }),
    needingImage: async (n, retry) => draftsNeedingImage(sql, { limit: n, retry }), attachImage: async (i, now) => attachImage(sql, i, { now }),
    media: async (id) => mediaOf(sql, id), note: async (i, now) => noteDraft(sql, i, { now }),
    publishedSince: async (s, n) => publishedSince(sql, s, { limit: n }), saveMetrics: async (i, now) => saveMetrics(sql, i, { now }),
    settings: async () => storedSettings(sql), saveSettings: async (i, now) => saveChannelSettings(sql, i, { now }), channelCounts: async (s) => channelCountsSince(sql, s),
    library: async (i) => searchDrafts(sql, i ?? {}), calendar: async (m) => calendarMonth(sql, m), mediaList: async (i) => listMedia(sql, i ?? {}),
    edit: async (i, now) => editDraft(sql, { ...i, check: (x) => editCheck(x, i.checkOptions ?? {}) }, { now }),
    duplicate: async (i, now) => duplicateDraft(sql, { ...i, check: (x) => editCheck(x, i.checkOptions ?? {}) }, { now }),
    nextApproved: async (c) => nextApproved(sql, c), approvedCounts: async () => approvedCounts(sql), claimSlot: async (i, now) => claimSlot(sql, i, { now }),
    slotOutcome: async (i) => { slotOutcome(sql, i); return true; }, recentSlots: async (n) => recentSlots(sql, { limit: n }),
    addLink: async (i, now) => addLink(sql, i, { now }), link: async (s) => getLink(sql, s), click: async (i, now) => { countClick(sql, i, { now }); return true; },
    links: async () => listLinks(sql), hashtagSets: async () => listHashtagSets(sql), saveHashtagSet: async (i, now) => saveHashtagSet(sql, i, { now }),
    studioSetting: async (k) => studioSetting(sql, k), saveStudioSetting: async (i, now) => saveStudioSetting(sql, i, { now }), kindMix: async (f, t) => kindMixSince(sql, f, t),
    addAbTest: async (i, now) => { addAbTest(sql, i, { now }); return true; }, abTests: async () => listAbTests(sql), measuredPosts: async () => measuredPosts(sql), copiedSince: async (s) => copiedSince(sql, s)
  };
  return { sql, api, ns: { idFromName: () => "desk", get: () => api } };
}
const ASSETS = { fetch: async (req) => new Response(`asset ${new URL(req.url).pathname}`, { status: 200, headers: { "content-type": "text/html" } }) };
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
  assert.deepEqual(await (await handle(req("/health"), e, opts)).json(), { ok: true, service: "cryptophys-cta", publish: "off" });
  const p = await (await handle(req("/api/public/profile"), e, opts)).json();
  assert.equal(p.brand.id, "xauusd-ai-cta");
  assert.match(p.brand.disclaimer, /not an invitation to buy or sell and not financial advice/);
  assert.deepEqual(p.links, [{ channel: "threads", label: "Threads", url: "https://www.threads.net/@xauusd-ai-cta" }]);
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
  const { env: e, d } = env({ CONTENT_PUBLISH: "on", TELEGRAM_BOT_TOKEN: "123:SECRET", TELEGRAM_CHAT_ID: "@xauusd_ai_cta" });
  assert.deepEqual(await accountOf(e, "telegram"), { bot_token: "123:SECRET", chat_id: "@xauusd_ai_cta", refreshed_at: null });
  assert.equal(await accountOf(e, "threads"), null);
  assert.equal(await accountOf(e, "youtube"), null);
  addDrafts(d.sql, [{ id: "t1", channel: "telegram", kind: "daily_recap", text: "Education only. Not financial advice.", status: "pending" }, { id: "y1", channel: "youtube", kind: "daily_recap", text: "Education only. Not financial advice.", status: "pending" }]);
  for (const id of ["t1", "y1"]) decideDraft(d.sql, { id, decision: "approve", actor: "owner" });
  const calls = [];
  const fetcher = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return Response.json({ ok: true, result: { message_id: 77 } }); };
  const r = await publishDraft(e, getDraft(d.sql, "t1"), { fetcher });
  assert.equal(r.status, "published");
  assert.deepEqual(calls[0].body, { chat_id: "@xauusd_ai_cta", text: "Education only. Not financial advice.", disable_web_page_preview: true });
  assert.equal(getDraft(d.sql, "t1").remote_id, "77");
  assert.deepEqual(await publishDraft(e, getDraft(d.sql, "y1"), { fetcher }), { status: "approved", held: "account_not_configured" }, "YouTube is built; without its OAuth app it waits");
  assert.deepEqual(await (await handle(req("/api/public/archive"), e, opts)).json().then((a) => a.posts.map((p) => p.id)), ["t1"], "the archive shows what was published");
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
    assert.ok(a.capabilities.every((c) => CEILING.has(c)), a.id);
  }
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
  assert.deepEqual(d.secrets_kept, [...Object.values(SECRETS).flatMap((s) => Object.values(s)), ...STUDIO_SECRETS]);
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
  for (const id of ["p1", "p2", "p3"]) decideDraft(d.sql, { id, decision: "approve", actor: "owner" }, { now: at - 30 * 86_400_000 });
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
  assert.deepEqual(deploys, ["--dry-run", ""], "the deploy runs exactly what the dry run validated (wrangler 4.45.0 has no --tag or --message)");
  assert.match(code, /deploy\.health/);
  assert.match(code, /deploy\.smoke/);
  const cfg = JSON.parse(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8").replace(/^\s*\/\/.*$/gm, ""));
  assert.equal(cfg.vars.CONTENT_PUBLISH, "off");
});

test("the pages: no inline script or style (CSP 'self'), the studio's four views, and no other company's name", () => {
  const read = (p) => readFileSync(new URL(`../public/${p}`, import.meta.url), "utf8");
  for (const page of ["index.html", "archive.html", "about.html", "disclaimer.html", "signin.html", "studio/index.html"]) {
    const html = read(page);
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>|<style\b|\sstyle=|\son[a-z]+=/i, `${page}: inline script, style or handler`);
  }
  const studio = read("studio/index.html");
  for (const v of ["dashboard", "queue", "performance", "channels"]) assert.match(studio, new RegExp(`id="view-${v}"`));
  for (const id of ["publish", "who", "tabs", "queue", "channels", "perf", "draftnow", "rendernow", "insightsnow", "err"]) assert.match(studio, new RegExp(`id="${id}"`), id);
  const publicPages = ["index.html", "archive.html", "about.html", "disclaimer.html"];
  for (const page of publicPages) {
    const html = read(page);
    for (const href of ["/", "/archive", "/about", "/disclaimer", "/studio"]) assert.match(html, new RegExp(`href="${href}"`), `${page} links ${href}`);
    assert.match(html, /not financial advice/i, `${page} carries the disclaimer`);
    assert.doesNotMatch(html, /\b(nexus|omega)\b/i, `${page}: never Nexus or Omega publicly`);
    assert.doesNotMatch(html, /\b(buy now|sell now|entry at|take profit at|stop loss at|guaranteed)\b/i, `${page}: no advice`);
  }
  const all = [...publicPages, "signin.html", "studio/index.html", "cta.css", "cta.js", "studio/studio.js"].map(read).join("\n");
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
  const { env: e, d } = env({ CONTENT_PUBLISH: "on", CONTENT_CHANNELS: "telegram,x", TELEGRAM_BOT_TOKEN: "123:SECRET", TELEGRAM_CHAT_ID: "@c" });
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
