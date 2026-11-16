// The approval queue (content roadmap P2): every draft waits for a person. Pure over a SQL handle with
// exec(query, ...binds) → { toArray() } (the Durable Object's SQLite storage; node:sqlite in the tests).
//
// Statuses: pending (waits for approval), needs_image / needs_video (the channel needs media not made yet; cannot
// be approved), blocked
// (the guardian failed), approved (waits for publishing, or publishing is off), rejected, published, failed.
// Each change is an event with who and why. An approval runs the guardian again on the stored text.
import { checkContentDraft } from "./guardian.mjs";
import { initialStatus } from "./channels.mjs";

export const DESK_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS drafts (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL, channel TEXT NOT NULL, text TEXT NOT NULL, image_url TEXT,
    window_from TEXT, window_to TEXT, decision_times TEXT NOT NULL DEFAULT '[]', guardian TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL, created_at TEXT NOT NULL, decided_at TEXT, decided_by TEXT, decision_reason TEXT,
    published_at TEXT, remote_id TEXT, error TEXT, overlay TEXT)`,
  "CREATE INDEX IF NOT EXISTS drafts_status ON drafts (status, created_at)",
  `CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, draft_id TEXT NOT NULL, action TEXT NOT NULL, actor TEXT NOT NULL, detail TEXT)`,
  `CREATE TABLE IF NOT EXISTS tokens (
    channel TEXT PRIMARY KEY, access_token TEXT NOT NULL, refreshed_at TEXT NOT NULL, expires_at TEXT, refresh_token TEXT)`,
  // The Instagram cards (src/card.mjs, src/render.mjs): one JPEG per draft, base64, served publicly only once its
  // draft is approved or published (GET /media/<id>.jpg), to the studio at any time.
  `CREATE TABLE IF NOT EXISTS media (
    id TEXT PRIMARY KEY, draft_id TEXT NOT NULL, content_type TEXT NOT NULL, data TEXT NOT NULL, bytes INTEGER NOT NULL, created_at TEXT NOT NULL)`,
  // A video (YouTube, TikTok) is larger than a row may be (2 MB): its base64 is kept in chunks, `media.data` empty.
  // Each published post's latest metrics (src/insights.mjs), read once a day.
  `CREATE TABLE IF NOT EXISTS post_metrics (
    draft_id TEXT PRIMARY KEY, channel TEXT NOT NULL, fetched_at TEXT NOT NULL, data TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS media_chunks (
    media_id TEXT NOT NULL, seq INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (media_id, seq))`,
  // Each channel's settings (src/settings.mjs), set by a person in the studio's Channels page. Never a token.
  `CREATE TABLE IF NOT EXISTS channel_settings (
    channel TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL)`,
  // The scheduler's slots that ran (src/scheduler.mjs): a slot is used once.
  `CREATE TABLE IF NOT EXISTS slot_runs (
    key TEXT PRIMARY KEY, channel TEXT NOT NULL, slot_at TEXT NOT NULL, ran_at TEXT NOT NULL, draft_id TEXT, outcome TEXT NOT NULL)`,
  // Marketing (src/marketing.mjs): tracked links and their clicks (per channel and WIB day; nothing about the
  // person), hashtag sets, and studio-wide settings (the weekly content mix).
  `CREATE TABLE IF NOT EXISTS links (
    slug TEXT PRIMARY KEY, target TEXT NOT NULL, campaign TEXT NOT NULL, label TEXT NOT NULL, created_at TEXT NOT NULL, created_by TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS link_clicks (
    slug TEXT NOT NULL, channel TEXT NOT NULL, day TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (slug, channel, day))`,
  `CREATE TABLE IF NOT EXISTS hashtag_sets (
    name TEXT PRIMARY KEY, tags TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS studio_settings (
    key TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL)`,
  // A/B captions (src/growth.mjs): the two drafts of one test.
  // Channel accounts connected by OAuth (src/oauth.mjs): who and what, never a token (the tokens are in `tokens`,
  // encrypted), and the one-time states of the sign-ins under way.
  `CREATE TABLE IF NOT EXISTS connections (
    channel TEXT PRIMARY KEY, account_id TEXT, account_name TEXT, scopes TEXT, connected_at TEXT NOT NULL, connected_by TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS oauth_states (
    state TEXT PRIMARY KEY, channel TEXT NOT NULL, verifier TEXT, actor TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS ab_tests (
    draft_id TEXT PRIMARY KEY, grp TEXT NOT NULL, variant TEXT NOT NULL, channel TEXT NOT NULL, created_at TEXT NOT NULL)`
];
/** A media chunk: 1 MB of base64 per row (a Durable Object's SQLite row holds up to 2 MB). */
export const MEDIA_CHUNK = 1_000_000;
export const STATUSES = Object.freeze(["pending", "needs_image", "needs_video", "blocked", "approved", "rejected", "published", "failed"]);

const rows = (sql, q, ...b) => sql.exec(q, ...b).toArray();
const clip = (v, n) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, n) : "");
const iso = (ms) => new Date(ms).toISOString();

export function ensureDesk(sql) { for (const q of DESK_SCHEMA) sql.exec(q); }

/** Kinds whose text is the analysis itself, price levels included (the guardian's allowLevels). */
export const LEVEL_KINDS = Object.freeze(["key_levels", "pattern"]);
/** The guardian's check of a stored draft, the same way it was drafted: levels for analysis kinds, attribution with an image. */
export function recheck(d, { delayHours = 24, now = Date.now() } = {}) {
  return checkContentDraft({ text: d.text, chart: Boolean(d.image_url), decisionTimes: d.decision_times, delayHours, allowLevels: LEVEL_KINDS.includes(d.kind), now });
}

function event(sql, { at, id, action, actor, detail = null }) {
  sql.exec("INSERT INTO events (at, draft_id, action, actor, detail) VALUES (?, ?, ?, ?, ?)", at, id, action, actor, detail);
}

/** Adds drafts once (by id); a draft already queued is left as it is. `actor`: the engine, or the person who wrote it (Create). Returns the ids added. */
export function addDrafts(sql, drafts, { now = Date.now(), actor = "content-engine" } = {}) {
  ensureDesk(sql);
  const added = [];
  for (const d of drafts || []) {
    if (!d?.id || !d.text || !d.channel) continue;
    if (rows(sql, "SELECT 1 AS x FROM drafts WHERE id = ?", d.id).length) continue;
    sql.exec("INSERT INTO drafts (id, kind, channel, text, image_url, window_from, window_to, decision_times, guardian, status, created_at, overlay) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      d.id, d.kind ?? "post", d.channel, d.text, d.image_url ?? null, d.window?.from ?? null, d.window?.to ?? null,
      JSON.stringify(d.decision_times ?? []), JSON.stringify(d.guardian ?? {}), STATUSES.includes(d.status) ? d.status : "pending", iso(now),
      d.overlay ? JSON.stringify(d.overlay) : null);
    event(sql, { at: iso(now), id: d.id, action: actor === "content-engine" ? "drafted" : "composed", actor: clip(actor, 200) || "content-engine", detail: d.status ?? "pending" });
    added.push(d.id);
  }
  return added;
}

const shape = (r) => ({ ...r, decision_times: JSON.parse(r.decision_times || "[]"), guardian: JSON.parse(r.guardian || "{}"), overlay: r.overlay ? JSON.parse(r.overlay) : null, metrics: r.metrics ? JSON.parse(r.metrics) : null });

/** The newest drafts, optionally of one status. */
export function listDrafts(sql, { status = null, limit = 50 } = {}) {
  ensureDesk(sql);
  const n = Math.min(200, Math.max(1, Number(limit) || 50));
  const list = status && STATUSES.includes(status)
    ? rows(sql, "SELECT d.*, m.data AS metrics, m.fetched_at AS metrics_at FROM drafts d LEFT JOIN post_metrics m ON m.draft_id = d.id WHERE d.status = ? ORDER BY d.created_at DESC LIMIT ?", status, n)
    : rows(sql, "SELECT d.*, m.data AS metrics, m.fetched_at AS metrics_at FROM drafts d LEFT JOIN post_metrics m ON m.draft_id = d.id ORDER BY d.created_at DESC LIMIT ?", n);
  return list.map(shape);
}

export function getDraft(sql, id) {
  ensureDesk(sql);
  const r = rows(sql, "SELECT * FROM drafts WHERE id = ?", String(id ?? ""))[0];
  return r ? shape(r) : null;
}

export function draftEvents(sql, id, { limit = 20 } = {}) {
  ensureDesk(sql);
  return rows(sql, "SELECT at, action, actor, detail FROM events WHERE draft_id = ? ORDER BY id DESC LIMIT ?", String(id ?? ""), limit);
}

/**
 * A person's decision on a pending draft: "approve" or "reject", with who and why. An approval checks the
 * stored text with the guardian again (the delay counted from now); a draft that fails it is blocked instead.
 */
export function decideDraft(sql, { id, decision, actor, reason = "", delayHours = 24 }, { now = Date.now() } = {}) {
  ensureDesk(sql);
  const who = clip(actor, 200), why = clip(reason, 300);
  if (!["approve", "reject"].includes(decision)) return { ok: false, error: "decision must be approve or reject" };
  if (!who) return { ok: false, error: "actor is required" };
  if (decision === "reject" && !why) return { ok: false, error: "a reason is required to reject" };
  const d = getDraft(sql, id);
  if (!d) return { ok: false, error: "no such draft" };
  if (d.status !== "pending") return { ok: false, error: `the draft is ${d.status}, not pending` };
  let status = decision === "approve" ? "approved" : "rejected";
  let guardian = d.guardian;
  if (decision === "approve") {
    guardian = recheck(d, { delayHours, now });
    if (!guardian.pass) status = "blocked";
  }
  sql.exec("UPDATE drafts SET status = ?, guardian = ?, decided_at = ?, decided_by = ?, decision_reason = ? WHERE id = ?", status, JSON.stringify(guardian), iso(now), who, why || null, d.id);
  event(sql, { at: iso(now), id: d.id, action: status, actor: who, detail: why || null });
  return { ok: true, id: d.id, status, guardian };
}

/** The outcome of a publishing attempt of an approved draft. */
export function recordPublish(sql, { id, remoteId = null, error = null }, { now = Date.now() } = {}) {
  ensureDesk(sql);
  const status = remoteId ? "published" : "failed";
  sql.exec("UPDATE drafts SET status = ?, published_at = ?, remote_id = ?, error = ? WHERE id = ? AND status = 'approved'", status, remoteId ? iso(now) : null, remoteId, error ? clip(String(error), 300) : null, String(id));
  event(sql, { at: iso(now), id: String(id), action: status, actor: "content-engine", detail: remoteId ?? clip(String(error ?? ""), 300) });
  return { status };
}

/** Counts per status (health and the Nexus page). */
export function deskCounts(sql) {
  ensureDesk(sql);
  return Object.fromEntries(rows(sql, "SELECT status, COUNT(*) AS n FROM drafts GROUP BY status").map((r) => [r.status, Number(r.n)]));
}

/** A refreshed token kept by the desk (newer than the secret it started from), or null. */
export function storedToken(sql, channel) {
  ensureDesk(sql);
  return rows(sql, "SELECT access_token, refreshed_at, expires_at, refresh_token FROM tokens WHERE channel = ?", channel)[0] ?? null;
}
/** Stores a refreshed token; a rotated refresh token (TikTok) replaces the stored one, which the secret only seeded. */
export function storeToken(sql, channel, { access_token, expires_in = null, refresh_token = null }, { now = Date.now() } = {}) {
  ensureDesk(sql);
  sql.exec("INSERT INTO tokens (channel, access_token, refreshed_at, expires_at, refresh_token) VALUES (?, ?, ?, ?, ?) ON CONFLICT(channel) DO UPDATE SET access_token = excluded.access_token, refreshed_at = excluded.refreshed_at, expires_at = excluded.expires_at, refresh_token = COALESCE(excluded.refresh_token, tokens.refresh_token)",
    channel, access_token, iso(now), expires_in ? iso(now + expires_in * 1000) : null, refresh_token);
}

/** The ids of drafts whose id starts with `prefix` (dedupe), and how many drafts of a kind each channel got since `sinceIso`. */
export function draftIdsWithPrefix(sql, prefix) {
  ensureDesk(sql);
  const p = String(prefix ?? "");
  return rows(sql, "SELECT id FROM drafts WHERE id >= ? AND id < ?", p, p + "\uffff").map((r) => r.id);
}
export function kindCountsSince(sql, kind, sinceIso) {
  ensureDesk(sql);
  return Object.fromEntries(rows(sql, "SELECT channel, COUNT(*) AS n FROM drafts WHERE kind = ? AND created_at >= ? GROUP BY channel", kind, sinceIso).map((r) => [r.channel, Number(r.n)]));
}

/** The public archive: published posts only, newest first (their text passed the guardian twice). */
export function publishedPosts(sql, { limit = 30 } = {}) {
  ensureDesk(sql);
  const n = Math.min(100, Math.max(1, Number(limit) || 30));
  return rows(sql, "SELECT id, kind, channel, text, published_at, remote_id FROM drafts WHERE status = 'published' ORDER BY published_at DESC LIMIT ?", n);
}

/** A card is tried this many times; then its draft waits for a person (the studio's "render now" still retries). */
export const MAX_RENDER_ATTEMPTS = 3;
/**
 * Drafts waiting for their media (a card, or a video), oldest first; a draft whose media failed MAX_RENDER_ATTEMPTS
 * times only on `retry`.
 */
export function draftsNeedingImage(sql, { limit = 3, retry = false } = {}) {
  ensureDesk(sql);
  const n = Math.min(20, Math.max(1, Number(limit) || 3));
  return rows(sql, `SELECT * FROM drafts d WHERE status IN ('needs_image', 'needs_video')${retry ? "" : " AND (SELECT COUNT(*) FROM events e WHERE e.draft_id = d.id AND e.action = 'render_failed') < ?"} ORDER BY created_at ASC LIMIT ?`, ...(retry ? [n] : [MAX_RENDER_ATTEMPTS, n])).map(shape);
}

const MEDIA_ID = /^[0-9a-f]{32}$/;
/**
 * Stores a draft's card and moves the draft on: the guardian runs again with the image (TradingView's attribution
 * is required), then the draft waits for a person ("pending") or is blocked. Only a draft that needs an image.
 */
export function attachImage(sql, { id, mediaId, data, bytes, imageUrl, contentType = "image/jpeg", delayHours = 24 }, { now = Date.now() } = {}) {
  ensureDesk(sql);
  const d = getDraft(sql, id);
  if (!d) return { ok: false, error: "no such draft" };
  const video = contentType === "video/webm";
  const want = video ? "needs_video" : "needs_image";
  if (d.status !== want) return { ok: false, error: `the draft is ${d.status}, not ${want}` };
  if (!MEDIA_ID.test(String(mediaId ?? ""))) return { ok: false, error: "bad media id" };
  const ext = video ? "webm" : "jpg";
  if (typeof data !== "string" || !data || !new RegExp(`^https://[^/]+/media/[0-9a-f]{32}\\.${ext}$`).test(String(imageUrl ?? ""))) return { ok: false, error: `bad ${video ? "video" : "image"}` };
  if (data.length <= MEDIA_CHUNK) {
    sql.exec("INSERT INTO media (id, draft_id, content_type, data, bytes, created_at) VALUES (?, ?, ?, ?, ?, ?)", mediaId, d.id, contentType, data, Number(bytes) || 0, iso(now));
  } else {
    sql.exec("INSERT INTO media (id, draft_id, content_type, data, bytes, created_at) VALUES (?, ?, ?, '', ?, ?)", mediaId, d.id, contentType, Number(bytes) || 0, iso(now));
    for (let i = 0, seq = 0; i < data.length; i += MEDIA_CHUNK, seq += 1) sql.exec("INSERT INTO media_chunks (media_id, seq, data) VALUES (?, ?, ?)", mediaId, seq, data.slice(i, i + MEDIA_CHUNK));
  }
  const guardian = recheck({ ...d, image_url: imageUrl }, { delayHours, now });
  const status = guardian.pass ? "pending" : "blocked";
  sql.exec("UPDATE drafts SET image_url = ?, guardian = ?, status = ? WHERE id = ?", imageUrl, JSON.stringify(guardian), status, d.id);
  event(sql, { at: iso(now), id: d.id, action: "image_attached", actor: "content-engine", detail: `${mediaId} ${status}` });
  return { ok: true, id: d.id, status, guardian };
}

/** A card with its draft's status (the public route serves it only once the draft is approved or published). */
export function mediaOf(sql, mediaId) {
  ensureDesk(sql);
  if (!MEDIA_ID.test(String(mediaId ?? ""))) return null;
  const m = rows(sql, "SELECT m.content_type, m.data, m.bytes, m.draft_id, d.status AS draft_status FROM media m JOIN drafts d ON d.id = m.draft_id WHERE m.id = ?", mediaId)[0] ?? null;
  if (m && !m.data) m.data = rows(sql, "SELECT data FROM media_chunks WHERE media_id = ? ORDER BY seq", mediaId).map((r) => r.data).join("");
  return m;
}

/** An engine note on a draft (a failed render), in its event history. */
export function noteDraft(sql, { id, action, detail = null }, { now = Date.now() } = {}) {
  ensureDesk(sql);
  if (!getDraft(sql, id)) return false;
  event(sql, { at: iso(now), id: String(id), action: clip(action, 40), actor: "content-engine", detail: detail ? clip(String(detail), 300) : null });
  return true;
}

/** The posts published since `sinceIso` (newest first), with their stored metrics, for the performance report. */
export function publishedSince(sql, sinceIso, { limit = 100 } = {}) {
  ensureDesk(sql);
  return rows(sql, "SELECT d.id, d.channel, d.kind, d.remote_id, d.published_at, m.data AS metrics, m.fetched_at AS metrics_at FROM drafts d LEFT JOIN post_metrics m ON m.draft_id = d.id WHERE d.status = 'published' AND d.published_at >= ? ORDER BY d.published_at DESC LIMIT ?",
    String(sinceIso), Math.min(500, Math.max(1, Number(limit) || 100))).map((r) => ({ ...r, metrics: r.metrics ? JSON.parse(r.metrics) : null }));
}
/** Stores a post's latest metrics (one row per post, replaced on each read). */
export function saveMetrics(sql, { id, channel, metrics }, { now = Date.now() } = {}) {
  ensureDesk(sql);
  if (!getDraft(sql, id) || !metrics || typeof metrics !== "object") return false;
  sql.exec("INSERT INTO post_metrics (draft_id, channel, fetched_at, data) VALUES (?, ?, ?, ?) ON CONFLICT(draft_id) DO UPDATE SET fetched_at = excluded.fetched_at, data = excluded.data",
    String(id), String(channel), iso(now), JSON.stringify(metrics));
  return true;
}

/** The stored settings of every channel ({ channel: settings }), with who changed them last and when. */
export function storedSettings(sql) {
  ensureDesk(sql);
  const out = {}, meta = {};
  for (const r of rows(sql, "SELECT channel, data, updated_at, updated_by FROM channel_settings")) {
    try { out[r.channel] = JSON.parse(r.data); } catch { continue; }
    meta[r.channel] = { updated_at: r.updated_at, updated_by: r.updated_by };
  }
  return { settings: out, meta };
}
/** Stores one channel's settings (already validated by normalizeSettings), with an event per change. */
export function saveChannelSettings(sql, { channel, settings, actor }, { now = Date.now() } = {}) {
  ensureDesk(sql);
  const data = JSON.stringify(settings);
  sql.exec("INSERT INTO channel_settings (channel, data, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(channel) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, updated_by = excluded.updated_by",
    channel, data, iso(now), clip(actor, 200) || "unknown");
  event(sql, { at: iso(now), id: `settings:${channel}`, action: "settings_saved", actor: clip(actor, 200) || "unknown", detail: data.slice(0, 2000) });
  return { ok: true, channel, settings, updated_at: iso(now) };
}
/** How many drafts each channel got since `sinceIso` (every kind): the daily maximum's count. */
export function channelCountsSince(sql, sinceIso) {
  ensureDesk(sql);
  return Object.fromEntries(rows(sql, "SELECT channel, COUNT(*) AS n FROM drafts WHERE created_at >= ? GROUP BY channel", sinceIso).map((r) => [r.channel, Number(r.n)]));
}

// ---- Content management (owner 2026-11-16: "content management"): the library, edits, copies, the calendar, media ----
/** Statuses whose text a person may still change (nothing approved, published or rejected is rewritten). */
export const EDITABLE = Object.freeze(["pending", "blocked", "needs_image", "needs_video"]);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** The WIB day (UTC+7) of an ISO time, as SQLite computes it: the calendar's and the filters' day. */
const WIB_DAY = (col) => `date(datetime(${col}, '+7 hours'))`;

/** The library: every draft, filtered by status, channel, kind, words and WIB days, newest first, with the total. */
export function searchDrafts(sql, { status = null, channel = null, kind = null, q = null, from = null, to = null, limit = 30, offset = 0 } = {}) {
  ensureDesk(sql);
  const where = [], binds = [];
  if (status && STATUSES.includes(status)) { where.push("d.status = ?"); binds.push(status); }
  if (channel) { where.push("d.channel = ?"); binds.push(String(channel).slice(0, 40)); }
  if (kind) { where.push("d.kind = ?"); binds.push(String(kind).slice(0, 40)); }
  const words = clip(q ?? "", 100);
  if (words) { where.push("(instr(lower(d.text), lower(?)) > 0 OR instr(lower(d.id), lower(?)) > 0)"); binds.push(words, words); }
  if (from && DAY.test(from)) { where.push(`${WIB_DAY("d.created_at")} >= ?`); binds.push(from); }
  if (to && DAY.test(to)) { where.push(`${WIB_DAY("d.created_at")} <= ?`); binds.push(to); }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const n = Math.min(100, Math.max(1, Number(limit) || 30));
  const off = Math.max(0, Math.min(100_000, Number(offset) || 0));
  const total = Number(rows(sql, `SELECT COUNT(*) AS n FROM drafts d ${w}`, ...binds)[0]?.n ?? 0);
  const list = rows(sql, `SELECT d.*, m.data AS metrics, m.fetched_at AS metrics_at FROM drafts d LEFT JOIN post_metrics m ON m.draft_id = d.id ${w} ORDER BY d.created_at DESC, d.id LIMIT ? OFFSET ?`, ...binds, n, off).map(shape);
  return { drafts: list, total, offset: off, limit: n };
}

/**
 * A person's edit of a draft's text. `check(draft)` is the guardian's check of the new text (the caller's, as for a
 * composed post); a text it refuses is not stored. A draft whose card or video carries the old text loses that media
 * and waits for a new one; otherwise it waits for approval again.
 */
export function editDraft(sql, { id, text, actor, check }, { now = Date.now() } = {}) {
  ensureDesk(sql);
  const who = clip(actor, 200);
  if (!who) return { ok: false, error: "actor is required" };
  const d = getDraft(sql, id);
  if (!d) return { ok: false, error: "no such draft" };
  if (!EDITABLE.includes(d.status)) return { ok: false, error: `a ${d.status} draft cannot be edited; duplicate it instead` };
  const t = typeof text === "string" ? text.replace(/\r\n/g, "\n") : "";
  if (t === d.text) return { ok: false, error: "nothing changed" };
  const r = check({ ...d, text: t });
  if (!r.guardian.pass) return { ok: false, error: "the guardian refused the new text; nothing was saved", guardian: r.guardian };
  const status = initialStatus(d.channel);
  sql.exec("UPDATE drafts SET text = ?, guardian = ?, status = ?, image_url = NULL WHERE id = ?", t, JSON.stringify(r.guardian), status, d.id);
  event(sql, { at: iso(now), id: d.id, action: "edited", actor: who, detail: `${d.text.length} → ${t.length} characters; ${d.status} → ${status}` });
  return { ok: true, id: d.id, status, guardian: r.guardian };
}

/**
 * A copy of any draft as a new draft (a reused post), checked again, waiting for approval; its history names the
 * source. `newId` is the new id's stem; the channel is appended.
 */
export function duplicateDraft(sql, { id, newId: stem, actor, check }, { now = Date.now() } = {}) {
  ensureDesk(sql);
  const who = clip(actor, 200);
  if (!who) return { ok: false, error: "actor is required" };
  const d = getDraft(sql, id);
  if (!d) return { ok: false, error: "no such draft" };
  const newId = `${clip(stem, 120)}:${d.channel}`;
  const r = check(d);
  if (!r.guardian.pass) return { ok: false, error: "the guardian refused the copy (check its text in the library); nothing was saved", guardian: r.guardian };
  const copy = { id: newId, kind: d.kind, channel: d.channel, text: d.text, image_url: null, window: d.window_from ? { from: d.window_from, to: d.window_to } : null,
    decision_times: d.decision_times, guardian: r.guardian, overlay: d.overlay, status: initialStatus(d.channel) };
  const added = addDrafts(sql, [copy], { now, actor: who });
  if (!added.length) return { ok: false, error: "the copy exists already" };
  event(sql, { at: iso(now), id: newId, action: "duplicated", actor: who, detail: `from ${d.id}` });
  return { ok: true, id: newId, status: copy.status, from: d.id };
}

/** The calendar of a month (YYYY-MM, WIB days): drafts made and posts published per day and channel. */
export function calendarMonth(sql, month) {
  ensureDesk(sql);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month ?? ""))) return { ok: false, error: "month must be YYYY-MM" };
  const days = {};
  const add = (day, channel, key) => {
    const x = (days[day] ??= { created: 0, published: 0, channels: {} });
    x[key] += 1;
    const c = (x.channels[channel] ??= { created: 0, published: 0 });
    c[key] += 1;
  };
  for (const r of rows(sql, `SELECT ${WIB_DAY("created_at")} AS day, channel FROM drafts WHERE substr(${WIB_DAY("created_at")}, 1, 7) = ?`, month)) add(r.day, r.channel, "created");
  for (const r of rows(sql, `SELECT ${WIB_DAY("published_at")} AS day, channel FROM drafts WHERE published_at IS NOT NULL AND substr(${WIB_DAY("published_at")}, 1, 7) = ?`, month)) add(r.day, r.channel, "published");
  return { ok: true, month, days };
}

/** The media library: every card and video (no bytes), newest first, with its draft's channel and status. */
export function listMedia(sql, { limit = 24, offset = 0 } = {}) {
  ensureDesk(sql);
  const n = Math.min(60, Math.max(1, Number(limit) || 24));
  const off = Math.max(0, Number(offset) || 0);
  const total = Number(rows(sql, "SELECT COUNT(*) AS n FROM media")[0]?.n ?? 0);
  const list = rows(sql, "SELECT m.id, m.draft_id, m.content_type, m.bytes, m.created_at, d.channel, d.kind, d.status FROM media m LEFT JOIN drafts d ON d.id = m.draft_id ORDER BY m.created_at DESC, m.id LIMIT ? OFFSET ?", n, off);
  return { media: list, total, offset: off, limit: n };
}

// ---- The scheduler (src/scheduler.mjs): one row per channel slot that ran, so a slot is never used twice ----

/** The oldest approved draft of a channel (the next post of its schedule), or null. */
export function nextApproved(sql, channel) {
  ensureDesk(sql);
  return rows(sql, "SELECT * FROM drafts WHERE status = 'approved' AND channel = ? ORDER BY COALESCE(decided_at, created_at) ASC, id LIMIT 1", channel).map(shape)[0] ?? null;
}
/** How many approved drafts each channel holds (waiting for publishing or for a slot). */
export function approvedCounts(sql) {
  ensureDesk(sql);
  return Object.fromEntries(rows(sql, "SELECT channel, COUNT(*) AS n FROM drafts WHERE status = 'approved' GROUP BY channel").map((r) => [r.channel, Number(r.n)]));
}
/** Claims a slot once ("<channel>@<WIB date>T<HH:MM>"); false when it already ran. */
export function claimSlot(sql, { key, channel, at }, { now = Date.now() } = {}) {
  ensureDesk(sql);
  const k = `${channel}@${key}`;
  if (rows(sql, "SELECT 1 AS x FROM slot_runs WHERE key = ?", k).length) return false;
  sql.exec("INSERT INTO slot_runs (key, channel, slot_at, ran_at, outcome) VALUES (?, ?, ?, ?, 'claimed')", k, channel, iso(at), iso(now));
  return true;
}
/** What a claimed slot did: the draft it published (or tried), or "empty" when no approved draft waited. */
export function slotOutcome(sql, { key, channel, draftId = null, outcome }) {
  ensureDesk(sql);
  sql.exec("UPDATE slot_runs SET draft_id = ?, outcome = ? WHERE key = ?", draftId, clip(String(outcome ?? ""), 60) || "unknown", `${channel}@${key}`);
}
/** The latest slot runs of every channel, newest first. */
export function recentSlots(sql, { limit = 20 } = {}) {
  ensureDesk(sql);
  return rows(sql, "SELECT key, channel, slot_at, ran_at, draft_id, outcome FROM slot_runs ORDER BY slot_at DESC LIMIT ?", Math.min(100, Math.max(1, Number(limit) || 20)));
}

// ---- Marketing: tracked links, hashtag sets, the content mix ----
/** Stores a new tracked link (already validated by normalizeLink); a slug is never reused. */
export function addLink(sql, { slug, link, actor }, { now = Date.now() } = {}) {
  ensureDesk(sql);
  if (rows(sql, "SELECT 1 AS x FROM links WHERE slug = ?", slug).length) return { ok: false, error: "slug taken" };
  sql.exec("INSERT INTO links (slug, target, campaign, label, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)", slug, link.target, link.campaign, link.label, iso(now), clip(actor, 200) || "unknown");
  return { ok: true, slug, ...link };
}
export function getLink(sql, slug) {
  ensureDesk(sql);
  return rows(sql, "SELECT slug, target, campaign, label FROM links WHERE slug = ?", String(slug ?? ""))[0] ?? null;
}
/** Counts one click (per link, channel and WIB day). */
export function countClick(sql, { slug, channel }, { now = Date.now() } = {}) {
  ensureDesk(sql);
  const day = new Date(now + 7 * 3_600_000).toISOString().slice(0, 10);
  sql.exec("INSERT INTO link_clicks (slug, channel, day, n) VALUES (?, ?, ?, 1) ON CONFLICT(slug, channel, day) DO UPDATE SET n = n + 1", slug, channel, day);
}
/** The links, newest first, with their clicks per channel and in total. */
export function listLinks(sql, { limit = 100 } = {}) {
  ensureDesk(sql);
  const links = rows(sql, "SELECT slug, target, campaign, label, created_at, created_by FROM links ORDER BY created_at DESC LIMIT ?", Math.min(500, Math.max(1, Number(limit) || 100)));
  const clicks = rows(sql, "SELECT slug, channel, SUM(n) AS n FROM link_clicks GROUP BY slug, channel");
  return links.map((l) => {
    const by = Object.fromEntries(clicks.filter((c) => c.slug === l.slug).map((c) => [c.channel, Number(c.n)]));
    return { ...l, clicks: by, total: Object.values(by).reduce((a, b) => a + b, 0) };
  });
}

export function listHashtagSets(sql) {
  ensureDesk(sql);
  return rows(sql, "SELECT name, tags, updated_at, updated_by FROM hashtag_sets ORDER BY name");
}
/** Saves a hashtag set (validated by normalizeHashtagSet), or deletes it with `remove`. */
export function saveHashtagSet(sql, { set, remove = false, actor, max = 30 }, { now = Date.now() } = {}) {
  ensureDesk(sql);
  if (remove) { sql.exec("DELETE FROM hashtag_sets WHERE name = ?", set.name); return { ok: true, removed: set.name }; }
  const exists = rows(sql, "SELECT 1 AS x FROM hashtag_sets WHERE name = ?", set.name).length;
  if (!exists && Number(rows(sql, "SELECT COUNT(*) AS n FROM hashtag_sets")[0].n) >= max) return { ok: false, error: `at most ${max} sets` };
  sql.exec("INSERT INTO hashtag_sets (name, tags, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET tags = excluded.tags, updated_at = excluded.updated_at, updated_by = excluded.updated_by",
    set.name, set.tags, iso(now), clip(actor, 200) || "unknown");
  return { ok: true, ...set };
}

/** A studio-wide setting (JSON), or null. */
export function studioSetting(sql, key) {
  ensureDesk(sql);
  const r = rows(sql, "SELECT data, updated_at, updated_by FROM studio_settings WHERE key = ?", key)[0];
  if (!r) return null;
  try { return { value: JSON.parse(r.data), updated_at: r.updated_at, updated_by: r.updated_by }; } catch { return null; }
}
export function saveStudioSetting(sql, { key, value, actor }, { now = Date.now() } = {}) {
  ensureDesk(sql);
  const data = JSON.stringify(value);
  sql.exec("INSERT INTO studio_settings (key, data, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, updated_by = excluded.updated_by",
    key, data, iso(now), clip(actor, 200) || "unknown");
  event(sql, { at: iso(now), id: `studio:${key}`, action: "settings_saved", actor: clip(actor, 200) || "unknown", detail: data.slice(0, 2000) });
  return { ok: true, key, value, updated_at: iso(now) };
}
/** Approved and published drafts per kind since `fromIso` (the week's content mix). */
export function kindMixSince(sql, fromIso, toIso) {
  ensureDesk(sql);
  return Object.fromEntries(rows(sql, "SELECT kind, COUNT(*) AS n FROM drafts WHERE status IN ('approved', 'published') AND COALESCE(published_at, decided_at, created_at) >= ? AND COALESCE(published_at, decided_at, created_at) < ? GROUP BY kind", fromIso, toIso).map((r) => [r.kind, Number(r.n)]));
}

// ---- Growth: A/B pairs, measured posts, recent copies ----
/** Records the two drafts of an A/B test (both already added). */
export function addAbTest(sql, { grp, a, b, channel }, { now = Date.now() } = {}) {
  ensureDesk(sql);
  for (const [id, v] of [[a, "A"], [b, "B"]]) sql.exec("INSERT OR IGNORE INTO ab_tests (draft_id, grp, variant, channel, created_at) VALUES (?, ?, ?, ?, ?)", id, grp, v, channel, iso(now));
}
/** The A/B tests, newest first: each with both drafts' status and latest metrics. */
export function listAbTests(sql, { limit = 30 } = {}) {
  ensureDesk(sql);
  const list = rows(sql, `SELECT t.grp, t.variant, t.channel, t.created_at, d.id, d.status, d.text, d.published_at, m.data AS metrics
    FROM ab_tests t JOIN drafts d ON d.id = t.draft_id LEFT JOIN post_metrics m ON m.draft_id = d.id ORDER BY t.created_at DESC, t.grp, t.variant LIMIT ?`, Math.min(200, Math.max(2, (Number(limit) || 30) * 2)));
  const groups = new Map();
  for (const r of list) {
    const g = groups.get(r.grp) ?? { grp: r.grp, channel: r.channel, created_at: r.created_at };
    g[r.variant === "A" ? "a" : "b"] = { id: r.id, status: r.status, text: r.text, published_at: r.published_at, metrics: r.metrics ? JSON.parse(r.metrics) : null };
    groups.set(r.grp, g);
  }
  return [...groups.values()];
}
/** Every published post with metrics (best times, evergreen), newest first. */
export function measuredPosts(sql, { limit = 1000 } = {}) {
  ensureDesk(sql);
  return rows(sql, "SELECT d.id, d.kind, d.channel, d.text, d.published_at, m.data AS metrics FROM drafts d JOIN post_metrics m ON m.draft_id = d.id WHERE d.status = 'published' ORDER BY d.published_at DESC LIMIT ?",
    Math.min(5000, Math.max(1, Number(limit) || 1000))).map((r) => ({ ...r, metrics: JSON.parse(r.metrics) }));
}
/** The drafts copied since `sinceIso` (their source ids, from the "duplicated" events). */
export function copiedSince(sql, sinceIso) {
  ensureDesk(sql);
  return rows(sql, "SELECT detail FROM events WHERE action = 'duplicated' AND at >= ?", sinceIso).map((r) => String(r.detail ?? "").replace(/^from /, ""));
}

// ---- Channel connections (src/oauth.mjs) ----
/** Records a sign-in under way (one-time state, PKCE verifier) and drops expired ones. */
export function putOAuthState(sql, { state, channel, verifier = null, actor }, { now = Date.now(), ttlMs = 600_000 } = {}) {
  ensureDesk(sql);
  sql.exec("DELETE FROM oauth_states WHERE created_at < ?", iso(now - ttlMs));
  sql.exec("INSERT INTO oauth_states (state, channel, verifier, actor, created_at) VALUES (?, ?, ?, ?, ?)", state, channel, verifier, clip(actor, 200) || "unknown", iso(now));
  return { ok: true };
}
/** Takes a state once: the same person, within its time; it is deleted whatever the answer. */
export function takeOAuthState(sql, { state, actor }, { now = Date.now(), ttlMs = 600_000 } = {}) {
  ensureDesk(sql);
  const r = rows(sql, "SELECT state, channel, verifier, actor, created_at FROM oauth_states WHERE state = ?", String(state ?? ""))[0] ?? null;
  if (r) sql.exec("DELETE FROM oauth_states WHERE state = ?", r.state);
  if (!r) return { ok: false, error: "unknown or used sign-in (start again from the Channels page)" };
  if (Date.parse(r.created_at) < now - ttlMs) return { ok: false, error: "the sign-in took too long (start again)" };
  if (r.actor !== (clip(actor, 200) || "unknown")) return { ok: false, error: "the sign-in was started by someone else" };
  return { ok: true, channel: r.channel, verifier: r.verifier };
}
/** Stores a connected account (its sealed tokens go through storeToken) with an event; replaces the previous one. */
export function saveConnection(sql, { channel, account_id = null, account_name = null, scopes = null, actor, token }, { now = Date.now() } = {}) {
  ensureDesk(sql);
  sql.exec("DELETE FROM tokens WHERE channel = ?", channel);
  sql.exec("INSERT INTO tokens (channel, access_token, refreshed_at, expires_at, refresh_token) VALUES (?, ?, ?, ?, ?)",
    channel, token.access_token ?? "", iso(now), token.expires_in ? iso(now + Number(token.expires_in) * 1000) : null, token.refresh_token ?? null);
  sql.exec("INSERT INTO connections (channel, account_id, account_name, scopes, connected_at, connected_by) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(channel) DO UPDATE SET account_id = excluded.account_id, account_name = excluded.account_name, scopes = excluded.scopes, connected_at = excluded.connected_at, connected_by = excluded.connected_by",
    channel, account_id ? clip(String(account_id), 100) : null, account_name ? clip(String(account_name), 120) : null, scopes ? clip(String(scopes), 400) : null, iso(now), clip(actor, 200) || "unknown");
  event(sql, { at: iso(now), id: `connection:${channel}`, action: "connected", actor: clip(actor, 200) || "unknown", detail: account_name ? clip(String(account_name), 120) : null });
  return { ok: true, channel };
}
export function connectionsOf(sql) {
  ensureDesk(sql);
  return Object.fromEntries(rows(sql, "SELECT c.channel, c.account_id, c.account_name, c.scopes, c.connected_at, c.connected_by, t.expires_at, t.refreshed_at FROM connections c LEFT JOIN tokens t ON t.channel = c.channel").map((r) => [r.channel, r]));
}
/** Disconnects a channel: its stored tokens and its connection are deleted (the account secrets, if any, stay). */
export function removeConnection(sql, { channel, actor }, { now = Date.now() } = {}) {
  ensureDesk(sql);
  sql.exec("DELETE FROM tokens WHERE channel = ?", channel);
  sql.exec("DELETE FROM connections WHERE channel = ?", channel);
  event(sql, { at: iso(now), id: `connection:${channel}`, action: "disconnected", actor: clip(actor, 200) || "unknown", detail: null });
  return { ok: true, channel };
}
