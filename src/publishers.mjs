// Publishers (ported from xauusd-ai-trading-assistant workers/xauusd-content, then X and Telegram added).
// Threads and Instagram (content roadmap P2). Both use Meta's two-step flow: create a media
// container, then publish it. The token travels in the POST body; the GET reads (status, quota, refresh) carry
// it as a query parameter as Meta expects, and this Worker never logs a request URL. Each
// call can run as a dry run: the requests it would send, with the token replaced by "[token]".
//
// Not verified against Meta's own pages from here (developers.facebook.com was unreachable from the build
// session): the endpoint shapes below follow the published guides. Before CONTENT_PUBLISH is turned on, one
// dry run and one real post on a test account confirm them. The daily publishing limit is read from Meta's own
// limit endpoint at run time, never assumed.
export const THREADS_BASE = "https://graph.threads.net/v1.0";
export const INSTAGRAM_BASE = "https://graph.instagram.com";
// Instagram takes two kinds of token (owner 2026-11-17: Meta's "API setup with Unified login" gives a system-user
// token). An Instagram-login token (IGAA...) talks to graph.instagram.com, renews every 60 days, and /me names the
// account. A Meta business token (EAA..., a system-user token from Unified or Facebook login) talks to
// graph.facebook.com, does not expire, and /me is the system user: the Instagram account id is entered with it.
// The calls themselves (media, media_publish, status_code, content_publishing_limit, insights) are the same.
export const FACEBOOK_GRAPH_BASE = "https://graph.facebook.com";
export const isBusinessToken = (token) => /^EAA/.test(String(token ?? ""));
export const instagramBase = (token) => (isBusinessToken(token) ? FACEBOOK_GRAPH_BASE : INSTAGRAM_BASE);
const STATUS_POLLS = 5;

const form = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v != null && v !== "").map(([k, v]) => [k, String(v)]));
const redact = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, k === "access_token" ? "[token]" : v]));

async function call(fetcher, method, url, params) {
  const res = method === "GET"
    ? await fetcher(`${url}?${form(params)}`, { method: "GET" })
    : await fetcher(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form(params) });
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  if (!res.ok || body?.error) {
    const e = new Error(`${res.status} ${String(body?.error?.message ?? "request failed").slice(0, 200)}`);
    e.status = res.status; e.code = body?.error?.code ?? null;
    throw e;
  }
  return body;
}

/**
 * The account's id as Meta returns it from /me (a string). A stored id can be wrong: Meta's token exchange sends
 * user_id as a number above 2^53, which JSON.parse rounds (2026-11-17: "Object with ID '...150' does not exist").
 * Falls back to the stored id when /me cannot be read.
 */
export async function liveUserId(channel, account, fetcher) {
  const stored = String(account?.user_id ?? "");
  if (channel === "instagram" && isBusinessToken(account?.access_token)) return stored;
  try {
    const url = channel === "threads" ? `${THREADS_BASE}/me` : "https://graph.instagram.com/me";
    const b = await call(fetcher, "GET", url, { fields: channel === "threads" ? "id" : "user_id", access_token: account?.access_token });
    const id = String((channel === "threads" ? b?.id : b?.user_id ?? b?.id) ?? "");
    return /^\d+$/.test(id) ? id : stored;
  } catch { return stored; }
}

/** Waits until a container is ready (Threads: status FINISHED; Instagram: status_code FINISHED). */
async function waitReady(fetcher, url, token, field, { sleep, polls = STATUS_POLLS }) {
  for (let i = 0; i < polls; i++) {
    const s = await call(fetcher, "GET", url, { fields: field, access_token: token });
    const v = String(s?.[field] ?? "").toUpperCase();
    if (v === "FINISHED" || v === "PUBLISHED") return v;
    if (v === "ERROR" || v === "EXPIRED") throw new Error(`container ${v.toLowerCase()}`);
    await sleep(i === 0 ? 2_000 : 5_000);
  }
  throw new Error("container not ready in time");
}

/**
 * One Threads text post. `account` is { user_id, access_token }. Returns { remote_id } (the published post's id),
 * or { dry_run: true, requests } when `dryRun`.
 */
export async function publishThreads({ account, text, imageUrl = null, fetcher = (...a) => fetch(...a), dryRun = false, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const uid = String(account?.user_id ?? "");
  // With the card (owner 2026-11-17, Threads set to Image): an IMAGE container from the card's public JPEG URL,
  // served once its draft is approved (as for Instagram).
  const create = { url: `${THREADS_BASE}/${uid}/threads`, params: imageUrl ? { media_type: "IMAGE", image_url: imageUrl, text, access_token: account?.access_token } : { media_type: "TEXT", text, access_token: account?.access_token } };
  const publish = { url: `${THREADS_BASE}/${uid}/threads_publish`, params: { creation_id: "<container>", access_token: account?.access_token } };
  if (dryRun) return { dry_run: true, requests: [create, publish].map((r) => ({ method: "POST", url: r.url, params: redact(r.params) })) };
  if (!uid || !account?.access_token) throw new Error("threads account not configured");
  if (imageUrl && !/^https:\/\//.test(String(imageUrl))) throw new Error("threads needs a public https image URL");
  const id = await liveUserId("threads", account, fetcher);
  const container = await call(fetcher, "POST", `${THREADS_BASE}/${id}/threads`, create.params);
  await waitReady(fetcher, `${THREADS_BASE}/${container.id}`, account.access_token, "status", { sleep });
  const post = await call(fetcher, "POST", `${THREADS_BASE}/${id}/threads_publish`, { ...publish.params, creation_id: container.id });
  return { remote_id: String(post.id), container_id: String(container.id) };
}

/**
 * One Instagram image post (Instagram has no text-only post). `imageUrl` must be a public JPEG URL.
 * Returns { remote_id }, or { dry_run: true, requests } when `dryRun`.
 */
export async function publishInstagram({ account, caption, imageUrl, fetcher = (...a) => fetch(...a), dryRun = false, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const uid = String(account?.user_id ?? "");
  const base = instagramBase(account?.access_token);
  const create = { url: `${base}/${uid}/media`, params: { image_url: imageUrl, caption, access_token: account?.access_token } };
  const publish = { url: `${base}/${uid}/media_publish`, params: { creation_id: "<container>", access_token: account?.access_token } };
  if (dryRun) return { dry_run: true, requests: [create, publish].map((r) => ({ method: "POST", url: r.url, params: redact(r.params) })) };
  if (!uid || !account?.access_token) throw new Error("instagram account not configured");
  if (!/^https:\/\//.test(String(imageUrl ?? ""))) throw new Error("instagram needs a public https image URL");
  const id = await liveUserId("instagram", account, fetcher);
  const container = await call(fetcher, "POST", `${base}/${id}/media`, create.params);
  await waitReady(fetcher, `${base}/${container.id}`, account.access_token, "status_code", { sleep });
  const post = await call(fetcher, "POST", `${base}/${id}/media_publish`, { ...publish.params, creation_id: container.id });
  return { remote_id: String(post.id), container_id: String(container.id) };
}

/** Today's publishing quota as Meta reports it: { used, total } or null when it cannot be read. */
export async function publishingQuota({ channel, account, fetcher = (...a) => fetch(...a) }) {
  const uid = String(account?.user_id ?? "");
  if (!uid || !account?.access_token) return null;
  try {
    const id = await liveUserId(channel, account, fetcher);
    const url = channel === "threads" ? `${THREADS_BASE}/${id}/threads_publishing_limit` : `${instagramBase(account.access_token)}/${id}/content_publishing_limit`;
    const body = await call(fetcher, "GET", url, { fields: "quota_usage,config", access_token: account.access_token });
    const row = Array.isArray(body?.data) ? body.data[0] : body;
    const used = Number(row?.quota_usage), total = Number(row?.config?.quota_total);
    return Number.isFinite(used) ? { used, total: Number.isFinite(total) ? total : null } : null;
  } catch { return null; }
}

/**
 * A refreshed long-lived token (each lasts about 60 days; refreshed when older than REFRESH_AFTER_DAYS).
 * Returns { access_token, expires_in } or throws.
 */
export const REFRESH_AFTER_DAYS = 30;
export async function refreshToken({ channel, token, fetcher = (...a) => fetch(...a) }) {
  const url = channel === "threads" ? "https://graph.threads.net/refresh_access_token" : `${INSTAGRAM_BASE}/refresh_access_token`;
  const body = await call(fetcher, "GET", url, { grant_type: channel === "threads" ? "th_refresh_token" : "ig_refresh_token", access_token: token });
  if (!body?.access_token) throw new Error("no token in the refresh answer");
  return { access_token: String(body.access_token), expires_in: Number(body.expires_in) || null };
}

/**
 * One X post (X API v2, POST /2/tweets, OAuth 2.0 user token with tweet.write). `account` is { access_token }.
 * Billed per post by X (owner's account). Returns { remote_id } or a dry run.
 */
export const X_BASE = "https://api.x.com/2";
export async function publishX({ account, text, image = null, fetcher = (...a) => fetch(...a), dryRun = false }) {
  const req = { method: "POST", url: `${X_BASE}/tweets`, body: { text } };
  // With the card (owner 2026-11-17, X set to Image): the JPEG goes first to POST /2/media/upload (multipart, media
  // category tweet_image; the user token needs media.write), then the post carries its media id.
  const upload = { method: "POST", url: `${X_BASE}/media/upload`, body: { media: "[card.jpg]", media_category: "tweet_image" } };
  if (dryRun) return { dry_run: true, requests: [...(image ? [{ ...upload, headers: { authorization: "Bearer [token]" } }] : []), { ...req, ...(image ? { body: { text, media: { media_ids: ["<media id>"] } } } : {}), headers: { authorization: "Bearer [token]" } }] };
  if (!account?.access_token) throw new Error("x account not configured");
  if (image) {
    const { bytes, mime } = await image();
    const form = new FormData();
    form.append("media", new Blob([bytes], { type: mime || "image/jpeg" }), "card.jpg");
    form.append("media_category", "tweet_image");
    const up = await fetcher(upload.url, { method: "POST", headers: { authorization: `Bearer ${account.access_token}` }, body: form });
    let ub = null;
    try { ub = await up.json(); } catch { ub = null; }
    const mediaId = ub?.data?.id ?? ub?.media_id_string ?? null;
    if (!up.ok || !mediaId) throw new Error(`media upload ${up.status} ${String(ub?.detail ?? ub?.title ?? ub?.errors?.[0]?.message ?? "failed").slice(0, 200)}`);
    req.body = { text, media: { media_ids: [String(mediaId)] } };
  }
  const res = await fetcher(req.url, { method: "POST", headers: { authorization: `Bearer ${account.access_token}`, "content-type": "application/json" }, body: JSON.stringify(req.body) });
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  if (!res.ok || !body?.data?.id) throw new Error(`${res.status} ${String(body?.detail ?? body?.title ?? "request failed").slice(0, 200)}`);
  return { remote_id: String(body.data.id) };
}

/**
 * One Telegram channel message (Bot API sendMessage). `account` is { bot_token, chat_id } (the channel's
 * @name or numeric id; the bot must be an admin of the channel). The bot token is part of the Bot API URL by
 * design; this Worker never logs a request URL. Returns { remote_id } or a dry run.
 */
export const TELEGRAM_BASE = "https://api.telegram.org";
/** Telegram's caption limit for a photo; a longer text follows the photo as its own message. */
export const TELEGRAM_CAPTION_MAX = 1024;
export async function publishTelegram({ account, text, image = null, fetcher = (...a) => fetch(...a), dryRun = false }) {
  const body = { chat_id: account?.chat_id, text, disable_web_page_preview: true };
  // A post with a card (owner 2026-11-17: "akan lebih menarik kalau posting Telegram dengan gambar"): sendPhoto with
  // the JPEG uploaded as multipart (no public URL needed), the text as its caption when it fits, else right after it.
  if (image) {
    const fits = String(text).length <= TELEGRAM_CAPTION_MAX;
    if (dryRun) return { dry_run: true, requests: [{ method: "POST", url: `${TELEGRAM_BASE}/bot[token]/sendPhoto`, body: { chat_id: account?.chat_id, photo: "[card.jpg]", ...(fits ? { caption: text } : {}) } },
      ...(fits ? [] : [{ method: "POST", url: `${TELEGRAM_BASE}/bot[token]/sendMessage`, body }])] };
    if (!account?.bot_token || !account?.chat_id) throw new Error("telegram channel not configured");
    const { bytes, mime } = await image();
    const form = new FormData();
    form.append("chat_id", String(account.chat_id));
    if (fits) form.append("caption", String(text));
    form.append("photo", new Blob([bytes], { type: mime || "image/jpeg" }), "card.jpg");
    const res = await fetcher(`${TELEGRAM_BASE}/bot${account.bot_token}/sendPhoto`, { method: "POST", body: form });
    let out = null;
    try { out = await res.json(); } catch { out = null; }
    if (!res.ok || out?.ok !== true) throw new Error(`${res.status} ${String(out?.description ?? "request failed").slice(0, 200)}`);
    if (fits) return { remote_id: String(out.result?.message_id ?? "") };
  }
  if (dryRun) return { dry_run: true, requests: [{ method: "POST", url: `${TELEGRAM_BASE}/bot[token]/sendMessage`, body }] };
  if (!account?.bot_token || !account?.chat_id) throw new Error("telegram channel not configured");
  const res = await fetcher(`${TELEGRAM_BASE}/bot${account.bot_token}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  let out = null;
  try { out = await res.json(); } catch { out = null; }
  if (!res.ok || out?.ok !== true) throw new Error(`${res.status} ${String(out?.description ?? "request failed").slice(0, 200)}`);
  return { remote_id: String(out.result?.message_id ?? "") };
}

// ---- Video: YouTube Shorts and TikTok (owner 2026-11-15: "Youtube & Tiktok"; "lanjutkan semua") -------------------
// Endpoint shapes follow the published guides, read from this session on 2026-11-15: YouTube's resumable upload
// (developers.google.com/youtube/v3/guides/using_resumable_upload_protocol) and TikTok's Content Posting API, Direct
// Post with FILE_UPLOAD (developers.tiktok.com/doc/content-posting-api-reference-direct-post and the media transfer
// guide). The token refreshes (Google's OAuth token endpoint; TikTok's /v2/oauth/token/ with refresh-token rotation)
// follow the standard flows and are confirmed by the first dry run and test post, like Meta's.
// Both platforms keep uploads private until the app passes their audit: YouTube for API projects not verified,
// TikTok for unaudited clients (SELF_ONLY). The publisher asks for public and reports what the platform did.
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const YOUTUBE_UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status";
export const TIKTOK_BASE = "https://open.tiktokapis.com/v2";
/** TikTok takes one chunk up to 64 MB; a card video is a few MB. */
export const TIKTOK_SINGLE_CHUNK_MAX = 64 * 1024 * 1024;

async function jsonOf(res) { try { return await res.json(); } catch { return null; } }
const titleOf = (text, max) => {
  const first = String(text ?? "").split("\n").find((l) => l.trim()) ?? "XAUUSD analysis";
  const t = first.replace(/^Education\s*·\s*/i, "").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
};

/** Google: a fresh access token from the account's refresh token. */
export async function googleAccessToken({ account, fetcher }) {
  const res = await fetcher(GOOGLE_TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form({ client_id: account.client_id, client_secret: account.client_secret, refresh_token: account.refresh_token, grant_type: "refresh_token" }) });
  const body = await jsonOf(res);
  if (!res.ok || !body?.access_token) throw new Error(`google token ${res.status} ${String(body?.error_description ?? body?.error ?? "failed").slice(0, 120)}`);
  return body.access_token;
}

/**
 * One YouTube Short: the resumable upload (session, then the bytes). `account` is { client_id, client_secret,
 * refresh_token }; `video` is { bytes, mime }. Returns { remote_id } or a dry run.
 */
export async function publishYouTube({ account, text, video, fetcher = (...a) => fetch(...a), dryRun = false }) {
  const meta = {
    snippet: { title: titleOf(text, 100), description: String(text ?? "").slice(0, 5000), tags: ["XAUUSD", "gold", "education", "Shorts"], categoryId: "27" },
    status: { privacyStatus: "public", selfDeclaredMadeForKids: false }
  };
  const size = video?.bytes?.length ?? 0, mime = video?.mime ?? "video/webm";
  if (dryRun) return { dry_run: true, requests: [
    { method: "POST", url: GOOGLE_TOKEN_URL, params: { grant_type: "refresh_token", client_id: "[client]", client_secret: "[secret]", refresh_token: "[token]" } },
    { method: "POST", url: YOUTUBE_UPLOAD_URL, headers: { authorization: "Bearer [token]", "x-upload-content-length": String(size), "x-upload-content-type": mime }, body: meta },
    { method: "PUT", url: "<session>", headers: { authorization: "Bearer [token]", "content-type": mime, "content-length": String(size) }, body: `<${size} bytes>` }
  ] };
  if (!account?.client_id || !account?.client_secret || !account?.refresh_token) throw new Error("youtube account not configured");
  if (!size) throw new Error("youtube needs the video");
  const token = await googleAccessToken({ account, fetcher });
  const start = await fetcher(YOUTUBE_UPLOAD_URL, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json; charset=UTF-8",
    "x-upload-content-length": String(size), "x-upload-content-type": mime }, body: JSON.stringify(meta) });
  const session = start.headers.get("location");
  if (!start.ok || !session) { const b = await jsonOf(start); throw new Error(`youtube session ${start.status} ${String(b?.error?.message ?? "failed").slice(0, 160)}`); }
  const put = await fetcher(session, { method: "PUT", headers: { authorization: `Bearer ${token}`, "content-type": mime, "content-length": String(size) }, body: video.bytes });
  const body = await jsonOf(put);
  if (!put.ok || !body?.id) throw new Error(`youtube upload ${put.status} ${String(body?.error?.message ?? "failed").slice(0, 160)}`);
  return { remote_id: String(body.id), privacy: body.status?.privacyStatus ?? null };
}

/** TikTok: a fresh access token; TikTok rotates the refresh token, so the new one is returned to be stored. */
export async function tiktokAccessToken({ account, fetcher }) {
  const res = await fetcher(`${TIKTOK_BASE}/oauth/token/`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form({ client_key: account.client_key, client_secret: account.client_secret, grant_type: "refresh_token", refresh_token: account.refresh_token }) });
  const body = await jsonOf(res);
  if (!res.ok || !body?.access_token) throw new Error(`tiktok token ${res.status} ${String(body?.error_description ?? body?.error ?? "failed").slice(0, 120)}`);
  return { access_token: body.access_token, expires_in: body.expires_in ?? null, refresh_token: body.refresh_token ?? null };
}
async function tiktokCall(fetcher, path, token, payload) {
  const res = await fetcher(`${TIKTOK_BASE}${path}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json; charset=UTF-8" }, body: JSON.stringify(payload ?? {}) });
  const body = await jsonOf(res);
  const code = body?.error?.code;
  if (!res.ok || (code && code !== "ok")) throw new Error(`tiktok ${path} ${res.status} ${String(code ?? "")} ${String(body?.error?.message ?? "").slice(0, 120)}`.trim());
  return body?.data ?? {};
}

/**
 * One TikTok video, Direct Post with FILE_UPLOAD in one chunk. `account` is { client_key, client_secret,
 * refresh_token }; `onToken` stores the rotated refresh token. The privacy is the most public the creator allows.
 */
export const TIKTOK_COVER_MS = 1000;

export async function publishTikTok({ account, text, video, fetcher = (...a) => fetch(...a), dryRun = false, onToken = async () => {}, audited = false }) {
  const size = video?.bytes?.length ?? 0, mime = video?.mime ?? "video/webm";
  const postInfo = (privacy) => ({ title: String(text ?? "").slice(0, 2200), privacy_level: privacy, disable_duet: false, disable_comment: false, disable_stitch: false,
    brand_content_toggle: false, brand_organic_toggle: false, is_aigc: false,
    // The cover frame: 1 s in, the card and the title (2026-11-18: the first frame made a dark thumbnail).
    video_cover_timestamp_ms: TIKTOK_COVER_MS });
  const source = { source: "FILE_UPLOAD", video_size: size, chunk_size: size, total_chunk_count: 1 };
  if (dryRun) return { dry_run: true, requests: [
    { method: "POST", url: `${TIKTOK_BASE}/oauth/token/`, params: { grant_type: "refresh_token", client_key: "[client]", client_secret: "[secret]", refresh_token: "[token]" } },
    { method: "POST", url: `${TIKTOK_BASE}/post/publish/creator_info/query/`, headers: { authorization: "Bearer [token]" } },
    { method: "POST", url: `${TIKTOK_BASE}/post/publish/video/init/`, headers: { authorization: "Bearer [token]" }, body: { post_info: postInfo(audited ? "<most public allowed>" : "SELF_ONLY"), source_info: source } },
    { method: "PUT", url: "<upload_url>", headers: { "content-type": mime, "content-length": String(size), "content-range": `bytes 0-${Math.max(0, size - 1)}/${size}` }, body: `<${size} bytes>` }
  ] };
  if (!account?.client_key || !account?.client_secret || !account?.refresh_token) throw new Error("tiktok account not configured");
  if (!size) throw new Error("tiktok needs the video");
  if (size > TIKTOK_SINGLE_CHUNK_MAX) throw new Error("tiktok video over 64 MB (one chunk)");
  const token = await tiktokAccessToken({ account, fetcher });
  if (token.refresh_token) await onToken(token);
  const creator = await tiktokCall(fetcher, "/post/publish/creator_info/query/", token.access_token, {});
  const options = Array.isArray(creator.privacy_level_options) ? creator.privacy_level_options : [];
  // An unaudited client may post only SELF_ONLY (2026-11-18: with the account private, TikTok still refused the most
  // public option with "unaudited_client_can_only_post_to_private_accounts"). Once TikTok audits the app,
  // TIKTOK_AUDITED "yes" picks the most public option the creator allows.
  const privacy = !audited ? "SELF_ONLY" : ["PUBLIC_TO_EVERYONE", "FOLLOWER_OF_CREATOR", "MUTUAL_FOLLOW_FRIENDS", "SELF_ONLY"].find((p) => options.includes(p)) ?? "SELF_ONLY";
  const init = await tiktokCall(fetcher, "/post/publish/video/init/", token.access_token, { post_info: postInfo(privacy), source_info: source });
  if (!init.upload_url || !init.publish_id) throw new Error("tiktok init gave no upload url");
  const put = await fetcher(init.upload_url, { method: "PUT", headers: { "content-type": mime, "content-length": String(size), "content-range": `bytes 0-${size - 1}/${size}` }, body: video.bytes });
  if (put.status !== 201 && put.status !== 200) throw new Error(`tiktok upload ${put.status}`);
  return { remote_id: String(init.publish_id), privacy };
}

/**
 * One draft through its channel's publisher. A video channel loads its video with `media()` ({ bytes, mime }); a
 * rotated token is stored with `saveToken(token)`.
 */
/** A draft's chart card (a JPEG this Worker serves), as opposed to a video or no media. */
const CARD_JPG = /\/media\/[0-9a-f]{32}\.jpg$/;
export async function publishTo(channel, { account, draft, fetcher, dryRun = false, sleep, media = async () => null, saveToken = async () => {}, tiktokAudited = false } = {}) {
  switch (channel) {
    case "threads": return publishThreads({ account, text: draft.text, imageUrl: CARD_JPG.test(String(draft.image_url ?? "")) ? draft.image_url : null, fetcher, dryRun, ...(sleep ? { sleep } : {}) });
    case "instagram": return publishInstagram({ account, caption: draft.text, imageUrl: draft.image_url, fetcher, dryRun, ...(sleep ? { sleep } : {}) });
    case "x": return publishX({ account, text: draft.text, image: CARD_JPG.test(String(draft.image_url ?? "")) ? media : null, fetcher, dryRun });
    case "telegram": return publishTelegram({ account, text: draft.text, image: CARD_JPG.test(String(draft.image_url ?? "")) ? media : null, fetcher, dryRun });
    case "youtube": return publishYouTube({ account, text: draft.text, video: dryRun ? await media().catch(() => null) : await media(), fetcher, dryRun });
    case "tiktok": return publishTikTok({ account, text: draft.text, video: dryRun ? await media().catch(() => null) : await media(), fetcher, dryRun, onToken: saveToken, audited: tiktokAudited });
    default: throw new Error(`${channel}: publisher not built yet`);
  }
}
