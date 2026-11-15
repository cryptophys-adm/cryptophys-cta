// The CTA app's HTTP face: the public page's API, the studio behind Access (the JWT checked here, fail closed),
// a person's decision, the dry run, publishing held while CONTENT_PUBLISH is off; the X and Telegram publishers;
// the organ's DNA within the platform's external ceiling.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { handle, accountOf, publishDraft, SECRETS, channelsOf } from "../src/app.mjs";
import { resetKeyCacheForTests } from "../src/access.mjs";
import { addDrafts, listDrafts, getDraft, draftEvents, decideDraft, recordPublish, deskCounts, storedToken, storeToken, draftIdsWithPrefix, kindCountsSince, publishedPosts } from "../src/desk.mjs";
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
    add: async (d, now) => addDrafts(sql, d, { now }), list: async (i) => listDrafts(sql, i ?? {}),
    get: async (id) => { const d = getDraft(sql, id); return d ? { ...d, events: draftEvents(sql, id) } : null; },
    decide: async (i, now) => decideDraft(sql, i, { now }), published: async (i, now) => recordPublish(sql, i, { now }),
    counts: async () => deskCounts(sql), token: async (c) => storedToken(sql, c), saveToken: async (c, t, now) => { storeToken(sql, c, t, { now }); return true; },
    idsWithPrefix: async (p) => draftIdsWithPrefix(sql, p), kindCounts: async (k, s) => kindCountsSince(sql, k, s), archive: async (n) => publishedPosts(sql, { limit: n })
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
  assert.match(p.brand.disclaimer, /bukan ajakan jual atau beli/);
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
  assert.equal((await handle(req("/api/studio/drafts", { token: "a.b.c" }), e, opts)).status, 403);
  const person = await jwt({ email: "Owner@Example.com" });
  assert.equal(await (await handle(req("/studio", { token: person }), e, opts)).text(), "asset /studio/index.html");
  assert.deepEqual(await (await handle(req("/api/studio/whoami", { token: person }), e, opts)).json(), { subject: "owner@example.com", type: "user", can_decide: true });
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
  addDrafts(d.sql, [{ id: "t1", channel: "telegram", kind: "daily_recap", text: "Edukasi. Bukan ajakan jual atau beli.", status: "pending" }, { id: "y1", channel: "youtube", kind: "daily_recap", text: "Edukasi. Bukan ajakan jual atau beli.", status: "pending" }]);
  for (const id of ["t1", "y1"]) decideDraft(d.sql, { id, decision: "approve", actor: "owner" });
  const calls = [];
  const fetcher = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return Response.json({ ok: true, result: { message_id: 77 } }); };
  const r = await publishDraft(e, getDraft(d.sql, "t1"), { fetcher });
  assert.equal(r.status, "published");
  assert.deepEqual(calls[0].body, { chat_id: "@xauusd_ai_cta", text: "Edukasi. Bukan ajakan jual atau beli.", disable_web_page_preview: true });
  assert.equal(getDraft(d.sql, "t1").remote_id, "77");
  assert.deepEqual(await publishDraft(e, getDraft(d.sql, "y1"), { fetcher }), { status: "approved", held: "publisher_not_built" });
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
  await assert.rejects(publishTo("tiktok", { draft: { text: "x" } }), /not built yet/);
  assert.deepEqual(Object.keys(SECRETS), CHANNELS);
  assert.deepEqual(CHANNELS.filter((c) => CHANNEL_SPECS[c].publisher === "built"), ["threads", "instagram", "x", "telegram"]);
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
  assert.deepEqual(d.crons, cfg.triggers.crons);
  assert.deepEqual(d.secrets_kept, Object.values(SECRETS).flatMap((s) => Object.values(s)));
  const src = readFileSync(new URL("../src/index.mjs", import.meta.url), "utf8");
  for (const e of [...d.entrypoints, ...d.durable_objects.map((o) => o.class_name)]) assert.match(src, new RegExp(`export class ${e}\\b`));
  assert.equal(d.via, "forge");
  assert.deepEqual(d.vars, Object.keys(cfg.vars), "every var is declared, and every non-secret value is a plain var");
  assert.match(cfg.vars.ACCESS_AUD, /^[0-9a-f]{64}$/, "the Access audience is a plain var, not resolved at deploy");
  assert.ok(d.secrets_kept.every((s) => !(s in cfg.vars)), "a secret is never a var");
});
