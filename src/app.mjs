// The CTA app's logic: the HTTP face, the drafting runs and publishing (no Workers-runtime import, so the tests
// run it under Node). src/index.mjs holds the Durable Object and the RPC entrypoints.
import { dailyDrafts } from "./drafts.mjs";
import { analysisDrafts } from "./analysis-drafts.mjs";
import { CHANNELS, CHANNEL_SPECS } from "./channels.mjs";
import { publishTo, publishingQuota, refreshToken, REFRESH_AFTER_DAYS } from "./publishers.mjs";
import { verifyAccessJwt } from "./access.mjs";
import { brandOf, profileLinks, DEFAULT_BRAND } from "./brands.mjs";

export const RECAP_CRON = "17 22 * * 2-6";
export const ANALYSIS_CRON = "9 * * * 1-5";
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" };
export const SECURITY_HEADERS = Object.freeze({
  "content-security-policy": "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: https:; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), microphone=(), geolocation=()"
});
const json = (data, status = 200) => new Response(JSON.stringify(data, null, 2), { status, headers: JSON_HEADERS });

export const publishOn = (env) => String(env?.CONTENT_PUBLISH ?? "off").trim().toLowerCase() === "on";
export const channelsOf = (env) => String(env?.CONTENT_CHANNELS ?? CHANNELS.join(",")).split(",").map((c) => c.trim()).filter((c) => CHANNELS.includes(c));
const delayOf = (env) => { const n = Number(env?.PUBLIC_DELAY_HOURS ?? 24); return Number.isFinite(n) && n >= 1 ? n : 24; };
/** The Worker secrets of each channel's account (kept by the native deploy; organism.json `deploy.secrets_kept`). */
export const SECRETS = Object.freeze({
  threads: { access_token: "THREADS_ACCESS_TOKEN", user_id: "THREADS_USER_ID" },
  instagram: { access_token: "INSTAGRAM_ACCESS_TOKEN", user_id: "INSTAGRAM_USER_ID" },
  x: { access_token: "X_ACCESS_TOKEN" },
  telegram: { bot_token: "TELEGRAM_BOT_TOKEN", chat_id: "TELEGRAM_CHAT_ID" },
  youtube: {},
  tiktok: {}
});

export const desk = (env) => env.CONTENT_DESK.get(env.CONTENT_DESK.idFromName("desk"));

/** A channel's account from its secrets (a refreshed token from the desk wins). Never returned to a caller. */
export async function accountOf(env, channel, { stored = null } = {}) {
  const names = SECRETS[channel] ?? {};
  const keys = Object.keys(names);
  if (!keys.length) return null;
  const account = Object.fromEntries(keys.map((k) => [k, env?.[names[k]] || null]));
  if (stored?.access_token && "access_token" in account) account.access_token = stored.access_token;
  return keys.every((k) => account[k]) ? { ...account, refreshed_at: stored?.refreshed_at ?? null } : null;
}

/** Publishes one approved draft now, when publishing is on. Never throws. */
export async function publishDraft(env, draft, { now = Date.now(), fetcher } = {}) {
  if (!publishOn(env)) return { status: "approved", held: "publishing_off" };
  if (draft?.status !== "approved") return { status: draft?.status ?? "missing", held: "not_approved" };
  if (CHANNEL_SPECS[draft.channel]?.publisher !== "built") return { status: "approved", held: "publisher_not_built" };
  const account = await accountOf(env, draft.channel, { stored: await desk(env).token(draft.channel).catch(() => null) });
  if (!account) return { status: "approved", held: "account_not_configured" };
  try {
    const r = await publishTo(draft.channel, { account, draft, fetcher });
    return desk(env).published({ id: draft.id, remoteId: r.remote_id }, now);
  } catch (error) {
    return desk(env).published({ id: draft.id, error: String(error?.message ?? error) }, now);
  }
}

/** The daily recap drafts (decisions older than 24 hours), queued once. */
export async function draftDay(env, { now = Date.now() } = {}) {
  const projection = await env.PROJECTION.recaps({ days: 3 });
  const { summary, drafts } = dailyDrafts(projection?.recaps ?? [], { now, channels: channelsOf(env), delayHours: delayOf(env) });
  const added = drafts.length ? await desk(env).add(drafts, now) : [];
  return { bars: summary.bars, drafts: drafts.map((d) => ({ id: d.id, status: d.status })), added };
}

/** The real-time analysis drafts (key-level map at 06 UTC, pattern posts every hour), queued once. */
export async function draftAnalysis(env, { now = Date.now() } = {}) {
  const analysis = await env.PROJECTION.analysis();
  const d = desk(env);
  const known = new Set(await d.idsWithPrefix("pattern:"));
  const postedToday = await d.kindCounts("pattern", new Date(now).toISOString().slice(0, 10));
  const drafts = analysisDrafts(analysis, { now, channels: channelsOf(env), levelsRun: new Date(now).getUTCHours() === 6, postedToday, known });
  const added = drafts.length ? await d.add(drafts, now) : [];
  return { zones: analysis?.zones?.length ?? 0, patterns: analysis?.patterns?.length ?? 0, drafts: drafts.map((x) => ({ id: x.id, status: x.status })), added };
}

/** Refreshes Threads' and Instagram's long-lived tokens after REFRESH_AFTER_DAYS (only while publishing is on). */
export async function refreshTokens(env, { now = Date.now() } = {}) {
  if (!publishOn(env)) return { status: "publishing_off" };
  const out = {};
  for (const channel of channelsOf(env).filter((c) => c === "threads" || c === "instagram")) {
    const account = await accountOf(env, channel, { stored: await desk(env).token(channel).catch(() => null) });
    if (!account) { out[channel] = "not_configured"; continue; }
    const age = account.refreshed_at ? now - Date.parse(account.refreshed_at) : Infinity;
    if (age < REFRESH_AFTER_DAYS * 86_400_000) { out[channel] = "fresh"; continue; }
    try { await desk(env).saveToken(channel, await refreshToken({ channel, token: account.access_token }), now); out[channel] = "refreshed"; }
    catch (e) { out[channel] = `failed: ${String(e?.message ?? e).slice(0, 120)}`; }
  }
  return out;
}

/** The studio's status: publishing, channels (configured or not, never a token), counts. */
export async function studioStatus(env) {
  const channels = {};
  for (const c of CHANNELS) {
    const spec = CHANNEL_SPECS[c];
    const account = await accountOf(env, c, { stored: await desk(env).token(c).catch(() => null) });
    channels[c] = {
      name: spec.name, enabled: channelsOf(env).includes(c), media: spec.media, publisher: spec.publisher, note: spec.note,
      configured: Boolean(account),
      quota: account && publishOn(env) && (c === "threads" || c === "instagram") ? await publishingQuota({ channel: c, account }) : null
    };
  }
  const brand = brandOf(DEFAULT_BRAND);
  return { publish: publishOn(env) ? "on" : "off", brand: { id: brand.id, name: brand.name, handles: brand.handles }, delay_hours: delayOf(env), channels, counts: await desk(env).counts() };
}

/** Reads a same-origin JSON body from a person; returns { body } or { response }. */
async function personJson(request, url, identity, maxBytes = 4096) {
  if (identity.type !== "user") return { response: json({ error: "forbidden", hint: "a person decides, never a service token" }, 403) };
  if (request.headers.get("origin") !== url.origin) return { response: json({ error: "cross_origin_refused" }, 403) };
  if (!String(request.headers.get("content-type") || "").toLowerCase().startsWith("application/json")) return { response: json({ error: "content_type_must_be_json" }, 415) };
  const text = await request.text();
  if (text.length > maxBytes) return { response: json({ error: "body_too_large" }, 413) };
  try {
    const body = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body)) return { response: json({ error: "body must be a JSON object" }, 400) };
    return { body };
  } catch { return { response: json({ error: "invalid_json" }, 400) }; }
}
async function rpc(fn, failure) {
  try { const r = await fn(); return json(r, r?.ok === false ? 400 : 200); }
  catch (error) { console.error(failure, String(error?.message ?? error)); return json({ error: failure }, 502); }
}

const isStudio = (path) => path === "/studio" || path.startsWith("/studio/") || path.startsWith("/api/studio/");
const STUDIO_ROUTES = ["/api/studio/drafts", "/api/studio/draft", "/api/studio/preview", "/api/studio/status", "/api/studio/decide", "/api/studio/draft-now", "/api/studio/whoami"];

/** The HTTP face. `deps` lets tests inject the desk, the clock and the JWT check's fetch. */
export async function handle(request, env, { fetchImpl = fetch, now } = {}) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const route = `${request.method} ${path}`;
  if (route === "GET /health") return json({ ok: true, service: "cryptophys-cta", publish: publishOn(env) ? "on" : "off" });

  // The public face: the brand's profile and the published archive. Nothing private.
  if (route === "GET /api/public/profile") {
    const brand = brandOf(DEFAULT_BRAND);
    return json({ brand: { id: brand.id, name: brand.name, tagline: brand.tagline, capacity: brand.capacity, disclaimer: brand.disclaimer }, links: profileLinks(brand) });
  }
  if (route === "GET /api/public/archive") {
    return rpc(async () => ({ posts: await desk(env).archive(Number(url.searchParams.get("limit")) || 30) }), "archive_failed");
  }

  if (isStudio(path)) {
    const v = await verifyAccessJwt(request.headers.get("cf-access-jwt-assertion"), env, { fetchImpl, ...(now ? { now } : {}) });
    if (!v.ok) return json({ error: "access_denied", reason: v.reason }, 403);
    const identity = v.identity;
    if (path.startsWith("/api/studio/")) {
      if (route === "GET /api/studio/whoami") return json({ subject: identity.subject, type: identity.type, can_decide: identity.type === "user" });
      if (route === "GET /api/studio/status") return rpc(() => studioStatus(env), "status_failed");
      if (route === "GET /api/studio/drafts") {
        const status = url.searchParams.get("status") || null;
        return rpc(async () => ({ drafts: await desk(env).list({ status, limit: 50 }), counts: await desk(env).counts(), can_decide: identity.type === "user" }), "drafts_failed");
      }
      if (route === "GET /api/studio/draft") return rpc(async () => (await desk(env).get(String(url.searchParams.get("id") || "").slice(0, 160))) ?? { ok: false, error: "no such draft" }, "draft_failed");
      if (route === "GET /api/studio/preview") {
        return rpc(async () => {
          const d = await desk(env).get(String(url.searchParams.get("id") || "").slice(0, 160));
          if (!d) return { ok: false, error: "no such draft" };
          if (CHANNEL_SPECS[d.channel]?.publisher !== "built") return { ok: true, id: d.id, channel: d.channel, dry_run: true, requests: [], note: "publisher not built yet" };
          const account = { user_id: "<user>", access_token: "[token]", bot_token: "[token]", chat_id: "<channel>" };
          return { ok: true, id: d.id, channel: d.channel, ...(await publishTo(d.channel, { account, draft: d, dryRun: true })) };
        }, "preview_failed");
      }
      if (route === "POST /api/studio/decide") {
        const r = await personJson(request, url, identity);
        if (r.response) return r.response;
        const id = typeof r.body.id === "string" ? r.body.id.slice(0, 160) : "";
        const decision = typeof r.body.decision === "string" ? r.body.decision : "";
        const reason = typeof r.body.reason === "string" ? r.body.reason.trim().slice(0, 300) : "";
        if (!id) return json({ error: "id is required" }, 400);
        if (decision !== "approve" && decision !== "reject") return json({ error: "decision must be approve or reject" }, 400);
        if (decision === "reject" && !reason) return json({ error: "a reason is required to reject" }, 400);
        return rpc(async () => {
          const at = now ? now * 1000 : Date.now();
          const out = await desk(env).decide({ id, decision, reason, actor: identity.subject, delayHours: delayOf(env) }, at);
          if (!out.ok || out.status !== "approved") return out;
          return { ...out, publish: await publishDraft(env, await desk(env).get(out.id), { now: at }) };
        }, "decide_failed");
      }
      if (route === "POST /api/studio/draft-now") {
        const r = await personJson(request, url, identity, 256);
        if (r.response) return r.response;
        return rpc(async () => ({ recap: await draftDay(env), analysis: await draftAnalysis(env) }), "draft_failed");
      }
      if (STUDIO_ROUTES.includes(path)) return json({ error: "method_not_allowed" }, 405);
      return json({ error: "not_found" }, 404);
    }
    // /studio: the studio page (assets), after the JWT check.
    return asset(env, request, url, "/studio/index.html");
  }

  if (request.method === "GET" || request.method === "HEAD") return asset(env, request, url, path === "/" ? "/index.html" : null);
  return json({ error: "not_found" }, 404);
}

async function asset(env, request, url, rewrite) {
  if (!env.ASSETS) return json({ error: "not_found" }, 404);
  const target = rewrite ? new Request(new URL(rewrite, url.origin).toString(), { method: request.method, headers: request.headers }) : request;
  const res = await env.ASSETS.fetch(target);
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
}

