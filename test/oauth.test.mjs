// Channel accounts by OAuth (owner 2026-11-16: "ya, kerjakan halaman koneksi OAuth per channel"): the sign-in URLs,
// PKCE, the code exchange per provider, tokens encrypted at rest and never shown, the one-time state, approvers only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { PROVIDERS, authorizeUrl, newAttempt, exchangeCode, refreshX, checkTelegram, sealToken, openToken, encryptionReady, appOf, STATE_RE, redirectUri } from "../src/oauth.mjs";
import { putOAuthState, takeOAuthState, saveConnection, connectionsOf, removeConnection, storedToken } from "../src/desk.mjs";

const KEY = Buffer.alloc(32, 7).toString("base64");
const REDIRECT = redirectUri("https://cta.cryptophys.work");
const sqlite = () => { const db = new DatabaseSync(":memory:"); return { exec(q, ...b) { const s = db.prepare(q); const out = /^\s*SELECT/i.test(q) ? s.all(...b) : (s.run(...b), []); return { toArray: () => out.map((r) => ({ ...r })) }; } }; };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("sign-in URLs: the provider's own page, our fixed redirect, the scopes, a one-time state; PKCE for X; offline for YouTube", async () => {
  assert.equal(REDIRECT, "https://cta.cryptophys.work/studio/oauth/callback");
  const a = await newAttempt("x");
  assert.match(a.state, STATE_RE);
  const expected = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(a.verifier))).toString("base64url");
  assert.equal(a.challenge, expected, "S256");
  const x = new URL(authorizeUrl("x", { clientId: "cid", redirect: REDIRECT, state: a.state, challenge: a.challenge }));
  assert.deepEqual([x.origin + x.pathname, x.searchParams.get("code_challenge_method"), x.searchParams.get("scope")], ["https://x.com/i/oauth2/authorize", "S256", "tweet.read tweet.write users.read offline.access"]);
  assert.equal((await newAttempt("threads")).verifier, null);
  const t = new URL(authorizeUrl("tiktok", { clientId: "ck", redirect: REDIRECT, state: a.state }));
  assert.deepEqual([t.searchParams.get("client_key"), t.searchParams.get("client_id")], ["ck", null]);
  const y = new URL(authorizeUrl("youtube", { clientId: "g", redirect: REDIRECT, state: a.state }));
  assert.deepEqual([y.searchParams.get("access_type"), y.searchParams.get("prompt")], ["offline", "consent"]);
  for (const c of Object.keys(PROVIDERS)) assert.equal(new URL(authorizeUrl(c, { clientId: "i", redirect: REDIRECT, state: a.state, challenge: "c" })).searchParams.get("redirect_uri"), REDIRECT);
  assert.equal(appOf({ THREADS_APP_ID: "1" }, "threads"), null, "both the id and the secret");
});

test("tokens at rest: AES-GCM with TOKEN_ENC_KEY; a plain stored token still reads; a sealed one without the key reads as nothing", async () => {
  const env = { TOKEN_ENC_KEY: KEY };
  assert.equal(await encryptionReady(env), true);
  assert.equal(await encryptionReady({ TOKEN_ENC_KEY: "short" }), false);
  const sealed = await sealToken(env, "SECRET-TOKEN");
  assert.match(sealed, /^enc1:/);
  assert.ok(!sealed.includes("SECRET"));
  assert.notEqual(await sealToken(env, "SECRET-TOKEN"), sealed, "a fresh IV each time");
  assert.equal(await openToken(env, sealed), "SECRET-TOKEN");
  assert.equal(await openToken({}, sealed), null);
  assert.equal(await openToken(env, "plain"), "plain");
  assert.equal(await sealToken({}, "plain"), "plain", "no key: as before this feature");
});

test("the code exchange per provider: server-side, the long-lived token for Meta, Basic auth and the verifier for X, a refresh token for Google", async () => {
  const calls = [];
  const meta = async (url, init) => {
    calls.push({ url: String(url), init });
    const u = String(url);
    if (u.startsWith("https://graph.threads.net/oauth/access_token")) return json({ access_token: "short", user_id: 42 });
    if (u.startsWith("https://graph.threads.net/access_token")) return json({ access_token: "long", expires_in: 5184000 });
    if (u.startsWith("https://graph.threads.net/v1.0/me")) return json({ id: "42", username: "xauusd-ai-cta" });
    return json({ error: "unexpected" }, 500);
  };
  const t = await exchangeCode("threads", { code: "c0de", app: { id: "app", secret: "s3" }, redirect: REDIRECT, fetcher: meta });
  assert.deepEqual([t.access_token, t.account_id, t.account_name, t.expires_in], ["long", "42", "@xauusd-ai-cta", 5184000]);
  assert.match(calls[0].init.body, /grant_type=authorization_code/);
  assert.equal(calls[0].init.method, "POST");
  const xcalls = [];
  const xf = async (url, init) => { xcalls.push({ url: String(url), init }); return String(url).includes("/users/me") ? json({ data: { id: "7", username: "cta" } }) : json({ access_token: "xa", refresh_token: "xr", expires_in: 7200, scope: "tweet.write" }); };
  const x = await exchangeCode("x", { code: "c", verifier: "v".repeat(64), app: { id: "cid", secret: "cs" }, redirect: REDIRECT, fetcher: xf });
  assert.deepEqual([x.refresh_token, x.account_name, x.expires_in], ["xr", "@cta", 7200]);
  assert.equal(xcalls[0].init.headers.authorization, `Basic ${btoa("cid:cs")}`);
  assert.match(xcalls[0].init.body, /code_verifier=v{64}/);
  const r = await refreshX({ app: { id: "cid", secret: "cs" }, refresh_token: "xr", fetcher: async () => json({ access_token: "xa2", expires_in: 7200 }) });
  assert.deepEqual([r.access_token, r.refresh_token], ["xa2", "xr"], "keeps the refresh token when X does not rotate it");
  await assert.rejects(exchangeCode("youtube", { code: "c", app: { id: "g", secret: "s" }, redirect: REDIRECT, fetcher: async () => json({ access_token: "a" }) }), /no refresh token/);
  await assert.rejects(exchangeCode("threads", { code: "c", app: { id: "a", secret: "s" }, redirect: REDIRECT, fetcher: async () => json({ error: { message: "bad code" } }, 400) }), /token 400 bad code/);
  const tk = await exchangeCode("tiktok", { code: "c", app: { id: "k", secret: "s" }, redirect: REDIRECT, fetcher: async (u) => String(u).includes("user/info") ? json({ data: { user: { open_id: "o1", display_name: "CTA" } } }) : json({ access_token: "ta", refresh_token: "tr", open_id: "o1", expires_in: 86400 }) });
  assert.deepEqual([tk.account_id, tk.account_name, tk.refresh_token], ["o1", "CTA", "tr"]);
});

test("Telegram: the bot can post only as the channel's creator or an administrator allowed to post", async () => {
  const bot = (member) => async (url) => {
    const m = /\/(getMe|getChat|getChatMember)\?/.exec(String(url))[1];
    return json({ ok: true, result: m === "getMe" ? { id: 9, username: "cta_bot" } : m === "getChat" ? { title: "XAUUSD AI" } : member });
  };
  assert.deepEqual(await checkTelegram({ bot_token: "123:SECRET", chat_id: "@c" }, { fetcher: bot({ status: "administrator", can_post_messages: true }) }), { ok: true, bot: "@cta_bot", chat: "XAUUSD AI", status: "administrator", can_post: true });
  assert.equal((await checkTelegram({ bot_token: "t", chat_id: "@c" }, { fetcher: bot({ status: "member" }) })).can_post, false);
  assert.ok(!JSON.stringify(await checkTelegram({ bot_token: "123:SECRET", chat_id: "@c" }, { fetcher: bot({ status: "creator" }) })).includes("SECRET"));
});

test("the desk: a state is taken once, by the person who started it, within ten minutes; a connection replaces the tokens; disconnect deletes them", () => {
  const sql = sqlite();
  const t0 = Date.parse("2026-11-16T12:00:00Z");
  putOAuthState(sql, { state: "a".repeat(48), channel: "x", verifier: "v", actor: "owner@example.com" }, { now: t0 });
  assert.match(takeOAuthState(sql, { state: "a".repeat(48), actor: "someone@example.com" }, { now: t0 }).error, /someone else/);
  assert.match(takeOAuthState(sql, { state: "a".repeat(48), actor: "owner@example.com" }, { now: t0 }).error, /unknown or used/, "deleted on the first take, whatever its answer");
  putOAuthState(sql, { state: "b".repeat(48), channel: "x", verifier: "v", actor: "owner@example.com" }, { now: t0 });
  assert.match(takeOAuthState(sql, { state: "b".repeat(48), actor: "owner@example.com" }, { now: t0 + 11 * 60_000 }).error, /too long/);
  putOAuthState(sql, { state: "c".repeat(48), channel: "x", verifier: "v", actor: "owner@example.com" }, { now: t0 });
  assert.deepEqual(takeOAuthState(sql, { state: "c".repeat(48), actor: "owner@example.com" }, { now: t0 + 60_000 }), { ok: true, channel: "x", verifier: "v" });
  saveConnection(sql, { channel: "threads", account_id: "42", account_name: "@cta", scopes: "threads_basic", actor: "owner@example.com", token: { access_token: "enc1:x", expires_in: 3600 } }, { now: t0 });
  assert.deepEqual([connectionsOf(sql).threads.account_name, storedToken(sql, "threads").access_token], ["@cta", "enc1:x"]);
  removeConnection(sql, { channel: "threads", actor: "owner@example.com" }, { now: t0 });
  assert.deepEqual([connectionsOf(sql), storedToken(sql, "threads")], [{}, null]);
});

test("the Channels page: Connect, Set up app, Paste token, Set bot, Disconnect and Check through the studio API; secrets only in password inputs, posted and cleared", () => {
  const js = readFileSync(new URL("../public/studio/studio.js", import.meta.url), "utf8");
  for (const p of ["/api/studio/connections", "/api/studio/connect/start", "/api/studio/connect/disconnect", "/api/studio/connect/check", "/api/studio/connect/app", "/api/studio/connect/token"]) assert.ok(js.includes(p), p);
  for (const label of ["Set up app", "Paste token", "Set bot", "Connect"]) assert.ok(js.includes(`"${label}"`), label);
  assert.match(js, /el\.type = i\.secret \? "password" : "text"; el\.autocomplete = "off"/, "secret inputs are password fields without autocomplete");
  assert.match(js, /els\.forEach\(\(el\) => \{ el\.value = ""; \}\)/, "inputs are cleared after saving");
  assert.doesNotMatch(js, /innerHTML|localStorage|sessionStorage/, "nothing stored in the browser");
});

test("without the token key the account buttons stay clickable: each opens its form, which says the key is missing (owner 2026-11-17: \"tombol setup cta masih belum bisa diklik\")", () => {
  const js = readFileSync(new URL("../public/studio/studio.js", import.meta.url), "utf8");
  assert.doesNotMatch(js, /\}, locked\)/, "no account button is created disabled");
  assert.match(js, /const btn = \(text, cls, onClick\) =>/, "the account button helper takes no disabled flag");
  assert.match(js, /Encryption key not set — store disabled/);
  assert.match(js, /if \(locked\) box\.appendChild\(make\("div", "hint warnline", keyMissing\)\)/, "the open form says what is missing");
  assert.match(js, /save\.disabled = locked/, "only Save waits: nothing is stored unencrypted");
  assert.match(js, /if \(locked\) \{ err\.textContent = keyMissing; return; \}/, "Connect explains instead of starting a sign-in that cannot be stored");
  assert.match(js, /only an approver \(STUDIO_APPROVERS\) connects accounts/, "a non-approver is told who is signed in and why");
});
