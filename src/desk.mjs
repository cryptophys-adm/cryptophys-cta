// The approval queue (content roadmap P2): every draft waits for a person. Pure over a SQL handle with
// exec(query, ...binds) → { toArray() } (the Durable Object's SQLite storage; node:sqlite in the tests).
//
// Statuses: pending (waits for approval), needs_image / needs_video (the channel needs media not made yet; cannot
// be approved), blocked
// (the guardian failed), approved (waits for publishing, or publishing is off), rejected, published, failed.
// Each change is an event with who and why. An approval runs the guardian again on the stored text.
import { checkContentDraft } from "./guardian.mjs";

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
    media_id TEXT NOT NULL, seq INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (media_id, seq))`
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

/** Adds drafts once (by id); a draft already queued is left as it is. Returns the ids added. */
export function addDrafts(sql, drafts, { now = Date.now() } = {}) {
  ensureDesk(sql);
  const added = [];
  for (const d of drafts || []) {
    if (!d?.id || !d.text || !d.channel) continue;
    if (rows(sql, "SELECT 1 AS x FROM drafts WHERE id = ?", d.id).length) continue;
    sql.exec("INSERT INTO drafts (id, kind, channel, text, image_url, window_from, window_to, decision_times, guardian, status, created_at, overlay) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      d.id, d.kind ?? "post", d.channel, d.text, d.image_url ?? null, d.window?.from ?? null, d.window?.to ?? null,
      JSON.stringify(d.decision_times ?? []), JSON.stringify(d.guardian ?? {}), STATUSES.includes(d.status) ? d.status : "pending", iso(now),
      d.overlay ? JSON.stringify(d.overlay) : null);
    event(sql, { at: iso(now), id: d.id, action: "drafted", actor: "content-engine", detail: d.status ?? "pending" });
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
