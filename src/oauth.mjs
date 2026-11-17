// Channel accounts by OAuth (owner 2026-11-16: "ya, kerjakan halaman koneksi OAuth per channel"). A person (an
// approver) presses Connect on the Channels page; the provider's own login and consent page asks them; the provider
// sends a one-time code back to /studio/oauth/callback (behind Access); this Worker exchanges it server-side for the
// account's tokens and keeps them encrypted in the Desk. A token never passes through the chat, the browser or the
// studio's pages, and the studio never shows one: only the account's name, its scopes and when it expires.
//
// What stays with the platform: each provider app's own id and secret (THREADS_APP_ID, ..., set once as Worker
// secrets) and the key that encrypts the tokens (TOKEN_ENC_KEY). Telegram has no OAuth: its bot token stays a Worker
// secret, and the page only checks that the bot can post to the channel.
//
// Endpoints follow each provider's published OAuth guide (read 2026-11-16); a first real connection per provider
// confirms them. Pure where it can be; `fetcher` is injected.

export const OAUTH_STATE_TTL_MS = 10 * 60_000;
export const CALLBACK_PATH = "/studio/oauth/callback";

/**
 * Each channel's provider: where the person signs in, the scopes asked, the app's secrets (names only), whether
 * PKCE is used, and how the account is named. `app` maps the provider's terms to our secret names.
 */
export const PROVIDERS = Object.freeze({
  threads: Object.freeze({ name: "Threads (Meta)", authorize: "https://threads.net/oauth/authorize", token: "https://graph.threads.net/oauth/access_token",
    scopes: ["threads_basic", "threads_content_publish", "threads_manage_insights"], scopeSep: ",", app: { id: "THREADS_APP_ID", secret: "THREADS_APP_SECRET" }, pkce: false }),
  instagram: Object.freeze({ name: "Instagram (Meta)", authorize: "https://www.instagram.com/oauth/authorize", token: "https://api.instagram.com/oauth/access_token",
    scopes: ["instagram_business_basic", "instagram_business_content_publish", "instagram_business_manage_insights"], scopeSep: ",", app: { id: "INSTAGRAM_APP_ID", secret: "INSTAGRAM_APP_SECRET" }, pkce: false }),
  x: Object.freeze({ name: "X", authorize: "https://x.com/i/oauth2/authorize", token: "https://api.x.com/2/oauth2/token",
    scopes: ["tweet.read", "tweet.write", "users.read", "media.write", "offline.access"], scopeSep: " ", app: { id: "X_CLIENT_ID", secret: "X_CLIENT_SECRET" }, pkce: true }),
  youtube: Object.freeze({ name: "YouTube (Google)", authorize: "https://accounts.google.com/o/oauth2/v2/auth", token: "https://oauth2.googleapis.com/token",
    scopes: ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"], scopeSep: " ", app: { id: "YOUTUBE_CLIENT_ID", secret: "YOUTUBE_CLIENT_SECRET" }, pkce: false }),
  tiktok: Object.freeze({ name: "TikTok", authorize: "https://www.tiktok.com/v2/auth/authorize/", token: "https://open.tiktokapis.com/v2/oauth/token/",
    scopes: ["user.info.basic", "video.publish", "video.upload"], scopeSep: ",", app: { id: "TIKTOK_CLIENT_KEY", secret: "TIKTOK_CLIENT_SECRET" }, pkce: false })
});
/** Telegram: a bot, not OAuth. */
export const BOT_CHANNELS = Object.freeze(["telegram"]);
/** The Worker secrets this feature reads: the apps' ids and secrets (YouTube's and TikTok's already exist) and the token key. */
export const CONNECT_SECRETS = Object.freeze(["THREADS_APP_ID", "THREADS_APP_SECRET", "INSTAGRAM_APP_ID", "INSTAGRAM_APP_SECRET", "X_CLIENT_ID", "X_CLIENT_SECRET", "TOKEN_ENC_KEY"]);

export const redirectUri = (origin) => `${origin}${CALLBACK_PATH}`;
const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const STATE_RE = /^[0-9a-f]{48}$/;

/** A one-time state (48 hex) and, for PKCE providers, a verifier and its S256 challenge. */
export async function newAttempt(channel, random = (n) => crypto.getRandomValues(new Uint8Array(n))) {
  const state = hex(random(24));
  if (!PROVIDERS[channel]?.pkce) return { state, verifier: null, challenge: null };
  const verifier = b64url(random(48));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  return { state, verifier, challenge };
}

/** The app's id and secret from the Worker secrets, or null when either is missing. Never returned to a caller. */
export function appOf(env, channel) {
  const p = PROVIDERS[channel];
  if (!p) return null;
  const id = env?.[p.app.id], secret = env?.[p.app.secret];
  return id && secret ? { id: String(id), secret: String(secret) } : null;
}

/** The provider's sign-in URL for this attempt. */
export function authorizeUrl(channel, { clientId, redirect, state, challenge = null }) {
  const p = PROVIDERS[channel];
  const q = new URLSearchParams();
  if (channel === "tiktok") q.set("client_key", clientId); else q.set("client_id", clientId);
  q.set("redirect_uri", redirect);
  q.set("response_type", "code");
  q.set("scope", p.scopes.join(p.scopeSep));
  q.set("state", state);
  if (p.pkce) { q.set("code_challenge", challenge); q.set("code_challenge_method", "S256"); }
  if (channel === "youtube") { q.set("access_type", "offline"); q.set("prompt", "consent"); q.set("include_granted_scopes", "true"); }
  return `${p.authorize}?${q}`;
}

const form = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v != null && v !== "")).toString();
async function jsonOf(res) { try { return await res.json(); } catch { return null; } }
function fail(what, res, body) {
  const why = String(body?.error_description ?? body?.error?.message ?? body?.error_message ?? body?.error ?? body?.message ?? "failed").slice(0, 160);
  return new Error(`${what} ${res?.status ?? ""} ${why}`.trim());
}
const FORM = { "content-type": "application/x-www-form-urlencoded" };

/**
 * Exchanges the code for the account's tokens, server-side, and names the account. Returns { access_token,
 * refresh_token, expires_in, account_id, account_name, scopes }. Throws a short reason (never a token).
 */
export async function exchangeCode(channel, { code, verifier = null, app, redirect, fetcher = (...a) => fetch(...a) }) {
  const p = PROVIDERS[channel];
  if (!p) throw new Error("unknown channel");
  if (channel === "threads" || channel === "instagram") {
    const res = await fetcher(p.token, { method: "POST", headers: FORM, body: form({ client_id: app.id, client_secret: app.secret, grant_type: "authorization_code", redirect_uri: redirect, code }) });
    const raw = await jsonOf(res);
    const body = Array.isArray(raw?.data) ? raw.data[0] : raw;
    if (!res.ok || !body?.access_token) throw fail("token", res, raw);
    // The short-lived token (an hour) for the long-lived one (60 days), refreshed by the daily run.
    const base = channel === "threads" ? "https://graph.threads.net/access_token" : "https://graph.instagram.com/access_token";
    const q = new URLSearchParams({ grant_type: channel === "threads" ? "th_exchange_token" : "ig_exchange_token", client_secret: app.secret, access_token: String(body.access_token) });
    const res2 = await fetcher(`${base}?${q}`, { method: "GET" });
    const long = await jsonOf(res2);
    if (!res2.ok || !long?.access_token) throw fail("long-lived token", res2, long);
    const who = await identify(channel, { access_token: long.access_token }, { fetcher }).catch(() => null);
    return { access_token: String(long.access_token), refresh_token: null, expires_in: Number(long.expires_in) || null,
      account_id: String(body.user_id ?? who?.id ?? ""), account_name: who?.name ?? null, scopes: String(body.permissions ?? p.scopes.join(",")) };
  }
  if (channel === "x") {
    const res = await fetcher(p.token, { method: "POST", headers: { ...FORM, authorization: `Basic ${btoa(`${app.id}:${app.secret}`)}` },
      body: form({ grant_type: "authorization_code", code, redirect_uri: redirect, code_verifier: verifier, client_id: app.id }) });
    const body = await jsonOf(res);
    if (!res.ok || !body?.access_token) throw fail("token", res, body);
    const who = await identify("x", { access_token: body.access_token }, { fetcher }).catch(() => null);
    return { access_token: String(body.access_token), refresh_token: body.refresh_token ? String(body.refresh_token) : null, expires_in: Number(body.expires_in) || null,
      account_id: who?.id ?? null, account_name: who?.name ?? null, scopes: String(body.scope ?? p.scopes.join(" ")) };
  }
  if (channel === "youtube") {
    const res = await fetcher(p.token, { method: "POST", headers: FORM, body: form({ code, client_id: app.id, client_secret: app.secret, redirect_uri: redirect, grant_type: "authorization_code" }) });
    const body = await jsonOf(res);
    if (!res.ok || !body?.access_token) throw fail("token", res, body);
    if (!body.refresh_token) throw new Error("google gave no refresh token (remove the app's access in the Google account, then connect again)");
    const who = await identify("youtube", { access_token: body.access_token }, { fetcher }).catch(() => null);
    return { access_token: null, refresh_token: String(body.refresh_token), expires_in: null, account_id: who?.id ?? null, account_name: who?.name ?? null, scopes: String(body.scope ?? "") };
  }
  if (channel === "tiktok") {
    const res = await fetcher(p.token, { method: "POST", headers: FORM, body: form({ client_key: app.id, client_secret: app.secret, code, grant_type: "authorization_code", redirect_uri: redirect }) });
    const body = await jsonOf(res);
    if (!res.ok || !body?.access_token) throw fail("token", res, body);
    const who = await identify("tiktok", { access_token: body.access_token }, { fetcher }).catch(() => null);
    return { access_token: String(body.access_token), refresh_token: body.refresh_token ? String(body.refresh_token) : null, expires_in: Number(body.expires_in) || null,
      account_id: String(body.open_id ?? who?.id ?? ""), account_name: who?.name ?? null, scopes: String(body.scope ?? p.scopes.join(",")) };
  }
  throw new Error("no OAuth for this channel");
}

/** X's access token lives two hours: a new one from the refresh token (X rotates the refresh token too). */
export async function refreshX({ app, refresh_token, fetcher = (...a) => fetch(...a) }) {
  const res = await fetcher(PROVIDERS.x.token, { method: "POST", headers: { ...FORM, authorization: `Basic ${btoa(`${app.id}:${app.secret}`)}` },
    body: form({ grant_type: "refresh_token", refresh_token, client_id: app.id }) });
  const body = await jsonOf(res);
  if (!res.ok || !body?.access_token) throw fail("x refresh", res, body);
  return { access_token: String(body.access_token), refresh_token: body.refresh_token ? String(body.refresh_token) : refresh_token, expires_in: Number(body.expires_in) || null };
}

/** The account behind a token: { id, name }. Read-only calls; throws a short reason. */
export async function identify(channel, account, { fetcher = (...a) => fetch(...a) } = {}) {
  const get = async (url, headers = {}) => {
    const res = await fetcher(url, { method: "GET", headers });
    const body = await jsonOf(res);
    if (!res.ok) throw fail("identify", res, body);
    return body;
  };
  if (channel === "threads") { const b = await get(`https://graph.threads.net/v1.0/me?${new URLSearchParams({ fields: "id,username", access_token: account.access_token })}`); return { id: String(b.id ?? ""), name: b.username ? `@${b.username}` : null }; }
  if (channel === "instagram") { const b = await get(`https://graph.instagram.com/me?${new URLSearchParams({ fields: "user_id,username", access_token: account.access_token })}`); return { id: String(b.user_id ?? b.id ?? ""), name: b.username ? `@${b.username}` : null }; }
  if (channel === "x") { const b = await get("https://api.x.com/2/users/me", { authorization: `Bearer ${account.access_token}` }); return { id: String(b?.data?.id ?? ""), name: b?.data?.username ? `@${b.data.username}` : null }; }
  if (channel === "youtube") { const b = await get("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", { authorization: `Bearer ${account.access_token}` }); const c = b?.items?.[0]; return { id: String(c?.id ?? ""), name: c?.snippet?.title ?? null }; }
  if (channel === "tiktok") { const b = await get("https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name", { authorization: `Bearer ${account.access_token}` }); const u = b?.data?.user; return { id: String(u?.open_id ?? ""), name: u?.display_name ?? null }; }
  throw new Error("no identity call for this channel");
}

/**
 * Telegram: the bot behind TELEGRAM_BOT_TOKEN, and whether it can post in TELEGRAM_CHAT_ID (telegramCanPost: by chat
 * type). Read-only Bot API calls; returns { ok, bot, chat, chat_type, status, can_post, advice } without the token.
 */
export async function checkTelegram({ bot_token, chat_id }, { fetcher = (...a) => fetch(...a) } = {}) {
  const call = async (method, params = {}) => {
    const res = await fetcher(`https://api.telegram.org/bot${bot_token}/${method}?${new URLSearchParams(params)}`, { method: "GET" });
    const body = await jsonOf(res);
    if (!res.ok || !body?.ok) throw new Error(`telegram ${method} ${res.status} ${String(body?.description ?? "failed").slice(0, 120)}`);
    return body.result;
  };
  const me = await call("getMe");
  const chat = await call("getChat", { chat_id });
  const member = await call("getChatMember", { chat_id, user_id: String(me.id) });
  const verdict = telegramCanPost(chat, member);
  return { ok: verdict.can_post, bot: me.username ? `@${me.username}` : null, chat: chat?.title ?? chat?.username ?? null, chat_type: chat?.type ?? null, status: member?.status ?? null, can_post: verdict.can_post, advice: verdict.advice };
}

/**
 * Pure: what is wrong with a Telegram chat id before asking Telegram (2026-11-17: "@ctx-channel", a display name with
 * a hyphen, came back "chat not found"). A public chat's @username has 5-32 letters, digits or underscores; a private
 * one has a number (channels and supergroups -100…). Null when it looks right.
 */
export function telegramChatIdProblem(chat_id) {
  const v = String(chat_id ?? "").trim();
  if (/^-?\d{5,20}$/.test(v)) return null;
  if (/^@[A-Za-z][A-Za-z0-9_]{4,31}$/.test(v)) return null;
  if (v.startsWith("@")) return `"${v.slice(0, 40)}" is not a Telegram username: a username has only letters, digits and underscores (no hyphen or space). That looks like the chat's display name. A private chat has no username: use its number id, which starts with -100 (Telegram Web shows it in the address bar: web.telegram.org/a/#-100…).`;
  return "The chat id is the chat's @username (public chats) or its number id starting with -100 (private chats; Telegram Web shows it in the address bar: web.telegram.org/a/#-100…).";
}

/** Pure: Telegram's "chat not found" said as what to do. */
export const TELEGRAM_CHAT_NOT_FOUND = "Telegram cannot find that chat for this bot: check the chat id (a private chat uses its -100… number, not its name), and that the bot has been added to the chat.";

/**
 * Pure: whether the bot can post, by chat type (2026-11-17: a group's plain member was refused). A channel takes an
 * administrator with "Post Messages" (or the creator). A group or supergroup takes any member the group lets send
 * messages: creator, administrator, member (unless the group's default permissions forbid sending), or restricted
 * with can_send_messages. The advice says what to change in Telegram, never a raw status.
 */
export function telegramCanPost(chat, member) {
  const status = member?.status ?? null;
  const type = chat?.type ?? null;
  if (status === "creator") return { can_post: true, advice: null };
  if (status === "left" || status === "kicked") return { can_post: false, advice: "The bot is not in that chat: add it, then press Set bot again." };
  if (type === "channel" || type == null) {
    if (status === "administrator" && member?.can_post_messages !== false) return { can_post: true, advice: null };
    if (status === "administrator") return { can_post: false, advice: "The bot is an administrator without \"Post Messages\": in the channel's Administrators, turn on Post Messages for the bot, then press Set bot again." };
    return { can_post: false, advice: "In a channel only administrators post: in the channel's Administrators, add the bot with \"Post Messages\" on, then press Set bot again." };
  }
  if (type === "group" || type === "supergroup") {
    if (status === "administrator") return { can_post: true, advice: null };
    if (status === "member" && chat?.permissions?.can_send_messages !== false) return { can_post: true, advice: null };
    if (status === "restricted" && member?.is_member !== false && member?.can_send_messages !== false) return { can_post: true, advice: null };
    return { can_post: false, advice: "The group does not let the bot send messages: make it an administrator, or allow members to send messages, then press Set bot again." };
  }
  return { can_post: false, advice: "That chat id is not a channel or a group the bot can post in: use the channel's @username or its -100… id." };
}

// ---- token encryption at rest (AES-GCM, TOKEN_ENC_KEY: 32 bytes, base64) ----
const ENC = "enc1:";
async function keyOf(env) {
  const raw = String(env?.TOKEN_ENC_KEY ?? "").trim();
  if (!raw) return null;
  let bytes;
  try { bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0)); } catch { return null; }
  if (bytes.length !== 32) return null;
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}
export const encryptionReady = async (env) => Boolean(await keyOf(env));
const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
/** Encrypts a token when TOKEN_ENC_KEY is set (else returns it unchanged: the stored refreshes before this feature). */
export async function sealToken(env, value) {
  if (value == null || value === "") return value ?? null;
  const key = await keyOf(env);
  if (!key) return value;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(String(value))));
  return `${ENC}${b64(iv)}:${b64(ct)}`;
}
/** Decrypts a sealed token; a plain one (stored before encryption) passes through; a sealed one without the key is null. */
export async function openToken(env, value) {
  if (value == null || !String(value).startsWith(ENC)) return value ?? null;
  const key = await keyOf(env);
  if (!key) return null;
  try {
    const [iv, ct] = String(value).slice(ENC.length).split(":");
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, key, unb64(ct)));
  } catch { return null; }
}
