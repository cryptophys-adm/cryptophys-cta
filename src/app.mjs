// The CTA app's logic: the HTTP face, the drafting runs and publishing (no Workers-runtime import, so the tests
// run it under Node). src/index.mjs holds the Durable Object and the RPC entrypoints.
import { levelFailures } from "./guardian.mjs";
import { dailyDrafts } from "./drafts.mjs";
import { analysisDrafts, PATTERN_LOOKBACK_MS, PATTERN_SEEN_KEY, PATTERN_CHARTS, seenPatternKeys, KIND_FAMILY, PATTERN_LEDGER_KEY, PATTERN_RECAP_KEY, updateLedger, invalidationDrafts, patternRecapDrafts, patternOfId, PATTERN_RECAP_CHANNELS } from "./analysis-drafts.mjs";
import { CHANNEL_SPECS as SPECS } from "./channels.mjs";
import { CHANNELS, CHANNEL_SPECS } from "./channels.mjs";
import { publishTo, publishingQuota, refreshToken, tiktokAccessToken, googleAccessToken, REFRESH_AFTER_DAYS, isBusinessToken, threadsReplies, publishThreadsReply } from "./publishers.mjs";
import { verifyAccessJwt } from "./access.mjs";
import { brandOf, profileLinks, DEFAULT_BRAND } from "./brands.mjs";
import { renderCard, renderVideo, toBase64, fromBase64 } from "./render.mjs";
import { DISCLAIMER } from "./drafts.mjs";
import { postInsights, performanceReport, insightChannelsOf, INSIGHTS_DAYS } from "./insights.mjs";
import { ANALYSIS_DISCLAIMER } from "./analysis-drafts.mjs";
import { effectiveSettings, normalizeSettings, draftingChannels, applySettings, withFormat, wibDayStart, FORMATS, PLANNED_FORMATS, KINDS, KIND_NAMES, DAYS, TIMEZONE, MAX_PER_DAY, MAX_SLOTS, AUTO_KINDS, AUTO_KIND_NAMES } from "./settings.mjs";
import { recheck, isStale, EXPIRED_NOTE } from "./desk.mjs";
import { dueSlots, nextSlots } from "./scheduler.mjs";
import { PROVIDERS, BOT_CHANNELS, CONNECT_SECRETS, appOf, newAttempt, authorizeUrl, exchangeCode, refreshX, identify, checkTelegram, telegramChatIdProblem, TELEGRAM_CHAT_NOT_FOUND, redirectUri, sealToken, openToken, encryptionReady, STATE_RE, CALLBACK_PATH } from "./oauth.mjs";
import { bestTimes, abResult, evergreen, EVERGREEN_MIN_DAYS } from "./growth.mjs";
import { agentChecks } from "./agent/checks.mjs";
import { publishText } from "./agent/humanizer.mjs";
import { auditChannel, planChannel } from "./agent/audit.mjs";
import { AGENT_CHANNELS, agentChannels } from "./agent/rules.mjs";
import { modelStatus, askModel } from "./agent/router.mjs";
import { dueNow, autoAt, AUTO_ACTOR } from "./agent/auto-approve.mjs";
import { runReplies, replyMode, REPLY_CHANNELS, REPLY_CAPS, REPLY_WINDOW_DAYS, KEEP_DAYS, DRY_RUN_HOURS } from "./agent/replies.mjs";
import { weeklySummary, summaryKey } from "./agent/weekly.mjs";
import { runWrite, writeMode, WRITE_CHANNELS, WRITE_KINDS, WRITE_WINDOW_MINUTES, WRITE_ACTOR, ABOUT_LEDE } from "./agent/write.mjs";
import { linkHosts, normalizeLink, randomSlug, shortUrl, redirectTarget, GO_PATH, normalizeHashtagSet, MAX_SETS, normalizeMix, DEFAULT_MIX, MIX_KINDS, wibWeek, mixReport } from "./marketing.mjs";
import { templateTexts, checkPost, composeDrafts, overlayFor, recapWindow, COMPOSE_KINDS, COMPOSE_KIND_NAMES } from "./compose.mjs";
import { sourceOf } from "./warroom-drafts.mjs";
import { goldClosedAt } from "../site/home/market-hours.js";

export const RECAP_CRON = "17 22 * * TUE-SAT";
export const ANALYSIS_CRON = "9 * * * SUN-FRI";
/**
 * The hourly analysis run drafts only while gold trades (the AI Worker's rule, site/home/market-hours.js). The cron runs
 * Sunday to Friday so the week's first hour after the reopen is drafted (Sunday 23:09 UTC in winter, 22:09 in US
 * summer); this skips Sunday's closed hours and Friday's after the close. A person's Draft now is not bound by it.
 */
export const analysisRunDue = (now) => !goldClosedAt(now);
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" };
// frame-src: the home page's TradingView quote (owner 2026-11-20), the widget frame's host only; no script host is added.
export const SECURITY_HEADERS = Object.freeze({
  "content-security-policy": "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: https:; media-src 'self'; connect-src 'self'; font-src 'self'; frame-src https://www.tradingview-widget.com; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), microphone=(), geolocation=()"
});
const json = (data, status = 200) => new Response(JSON.stringify(data, null, 2), { status, headers: JSON_HEADERS });

export const publishOn = (env) => String(env?.CONTENT_PUBLISH ?? "off").trim().toLowerCase() === "on";
/**
 * The channels that may publish while CONTENT_PUBLISH is "on" (owner 2026-11-17: "kita sambungkan dulu ke Telegram
 * setelah sukses baru ke channel lain"): PUBLISH_CHANNELS, a comma-separated list. Unset or empty: none (fail closed),
 * so turning CONTENT_PUBLISH on never opens a channel nobody named.
 */
export const publishChannels = (env) => (publishOn(env) ? String(env?.PUBLISH_CHANNELS ?? "").split(",").map((c) => c.trim()).filter((c) => CHANNELS.includes(c)) : []);
export const publishesTo = (env, channel) => publishChannels(env).includes(channel);
export const channelsOf = (env) => String(env?.CONTENT_CHANNELS ?? CHANNELS.join(",")).split(",").map((c) => c.trim()).filter((c) => CHANNELS.includes(c));
export const delayOf = (env) => { const v = env?.PUBLIC_DELAY_HOURS, n = v == null || String(v).trim() === "" ? NaN : Number(v); return Number.isFinite(n) && n >= 0 ? n : 24; };
/** The Worker secrets of each channel's account (kept by the native deploy; organism.json `deploy.secrets_kept`). */
export const SECRETS = Object.freeze({
  threads: { access_token: "THREADS_ACCESS_TOKEN", user_id: "THREADS_USER_ID" },
  instagram: { access_token: "INSTAGRAM_ACCESS_TOKEN", user_id: "INSTAGRAM_USER_ID" },
  x: { access_token: "X_ACCESS_TOKEN" },
  telegram: { bot_token: "TELEGRAM_BOT_TOKEN", chat_id: "TELEGRAM_CHAT_ID" },
  // OAuth apps the owner creates; the refresh tokens seed the desk, which keeps TikTok's rotated ones.
  youtube: { client_id: "YOUTUBE_CLIENT_ID", client_secret: "YOUTUBE_CLIENT_SECRET", refresh_token: "YOUTUBE_REFRESH_TOKEN" },
  tiktok: { client_key: "TIKTOK_CLIENT_KEY", client_secret: "TIKTOK_CLIENT_SECRET", refresh_token: "TIKTOK_REFRESH_TOKEN" }
});

/**
 * Team roles (owner 2026-11-16, pro marketing extras): STUDIO_APPROVERS, a Worker secret set through the platform
 * (comma-separated sign-in emails; never in the repository), names who approves. Unset: every signed-in person
 * approves, as before. Set: a person on it is an approver; anyone else signed in is an editor, who writes, edits and
 * copies drafts and manages links and hashtag sets, but never approves, rejects, or changes channel settings or the
 * content-mix targets. A service token only reads.
 */
export const STUDIO_SECRETS = Object.freeze(["STUDIO_APPROVERS"]);
export function roleOf(env, identity) {
  if (identity?.type !== "user") return "service";
  const list = String(env?.STUDIO_APPROVERS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (!list.length) return "approver";
  return list.includes(String(identity.subject ?? "").toLowerCase()) ? "approver" : "editor";
}
const approverOnly = (role) => (role === "approver" ? null : json({ error: "approver_only", hint: "only an approver can do this (STUDIO_APPROVERS)" }, 403));

export const desk = (env) => env.CONTENT_DESK.get(env.CONTENT_DESK.idFromName("desk"));

/** A channel's account from its secrets (a refreshed token from the desk wins). Never returned to a caller. */
export async function accountOf(env, channel, { stored = null, connection = null, manual = null, app = null } = {}) {
  const names = SECRETS[channel] ?? {};
  const keys = Object.keys(names);
  if (!keys.length) return null;
  const account = Object.fromEntries(keys.map((k) => [k, env?.[names[k]] || null]));
  // Entered in the studio (2026-11-17): a pasted token or bot wins over the platform's secrets; an OAuth app entered
  // there gives YouTube and TikTok their client id and secret when the platform set none.
  for (const k of ["access_token", "user_id", "bot_token", "chat_id"]) if (manual?.[k] && k in account) account[k] = String(manual[k]);
  if (app) {
    if ("client_id" in account && !account.client_id) account.client_id = app.id;
    if ("client_key" in account && !account.client_key) account.client_key = app.id;
    if ("client_secret" in account && !account.client_secret) account.client_secret = app.secret;
  }
  // An account connected by OAuth (src/oauth.mjs) names its own user (Threads, Instagram).
  if (connection?.account_id && "user_id" in account) account.user_id = connection.account_id;
  if (stored?.access_token && "access_token" in account) account.access_token = stored.access_token;
  // TikTok rotates its refresh token: the one the desk stored last wins over the secret that seeded it.
  if (stored?.refresh_token && "refresh_token" in account) account.refresh_token = stored.refresh_token;
  return keys.every((k) => account[k]) ? { ...account, refreshed_at: stored?.refreshed_at ?? null } : null;
}

/** A channel's stored tokens, decrypted (src/oauth.mjs), or null. Never returned to a caller. */
export async function storedTokenOf(env, channel) {
  const t = await desk(env).token(channel).catch(() => null);
  if (!t) return null;
  return { ...t, access_token: await openToken(env, t.access_token), refresh_token: await openToken(env, t.refresh_token) };
}
/** Stores a refreshed or rotated token, encrypted when TOKEN_ENC_KEY is set. */
export async function saveTokenSealed(env, channel, token, now = Date.now()) {
  return desk(env).saveToken(channel, { ...token, access_token: await sealToken(env, token.access_token), refresh_token: token.refresh_token ? await sealToken(env, token.refresh_token) : null }, now);
}
/**
 * Credentials an approver entered in the studio (2026-11-17), sealed with TOKEN_ENC_KEY in the desk. Never returned
 * to a caller: the page sees only a masked hint (hintOf).
 */
async function openCreds(env, channel, kind) {
  const sealed = await desk(env).creds({ channel, kind }).catch(() => null);
  if (!sealed) return null;
  try { const text = await openToken(env, sealed); return text ? JSON.parse(text) : null; } catch { return null; }
}
async function saveCredsSealed(env, { channel, kind, value, hint, actor }, now) {
  return desk(env).saveCreds({ channel, kind, data: value == null ? null : await sealToken(env, JSON.stringify(value)), hint, actor }, now);
}
/** A channel's OAuth app: the platform's secrets first, else the one entered in the studio; with its source. */
export async function appFor(env, channel) {
  const own = appOf(env, channel);
  if (own) return { ...own, source: "platform" };
  const s = await openCreds(env, channel, "app");
  return s?.id && s?.secret ? { id: String(s.id), secret: String(s.secret), source: "studio" } : null;
}
/** A masked hint of an id or token: its last 4 characters. Never more. */
export const hintOf = (v) => { const t = String(v ?? ""); return t.length > 8 ? `…${t.slice(-4)}` : "…"; };
/** The channels whose token or bot can be pasted in the studio (others connect by OAuth only). */
export const PASTE_FIELDS = Object.freeze({ threads: ["access_token", "user_id"], instagram: ["access_token", "user_id"], x: ["access_token"], telegram: ["bot_token", "chat_id"] });

/**
 * A channel's account for a call: its secrets, its stored tokens and its OAuth connection. X's two-hour token is
 * renewed from its refresh token first when it is within five minutes of expiry. Never returned to a caller.
 */
export async function accountFor(env, channel, { now = Date.now(), fetcher } = {}) {
  let stored = await storedTokenOf(env, channel);
  const connection = (await desk(env).connections().catch(() => ({})))?.[channel] ?? null;
  const manual = PASTE_FIELDS[channel] ? await openCreds(env, channel, "manual") : null;
  const app = PROVIDERS[channel] ? await appFor(env, channel) : null;
  if (channel === "x" && stored?.refresh_token && (!stored.expires_at || Date.parse(stored.expires_at) - now < 5 * 60_000)) {
    if (app) {
      try {
        const t = await refreshX({ app, refresh_token: stored.refresh_token, ...(fetcher ? { fetcher } : {}) });
        await saveTokenSealed(env, "x", t, now);
        stored = { ...stored, ...t, expires_at: t.expires_in ? new Date(now + t.expires_in * 1000).toISOString() : null, refreshed_at: new Date(now).toISOString() };
      } catch (e) { console.error("x_refresh_failed", String(e?.message ?? e).slice(0, 160)); }
    }
  }
  return accountOf(env, channel, { stored, connection, manual, app });
}

/** Publishes one approved draft now, when publishing is on. Never throws. */
export async function publishDraft(env, draft, { now = Date.now(), fetcher, slot = false } = {}) {
  if (!publishOn(env)) return { status: "approved", held: "publishing_off" };
  if (!publishesTo(env, draft?.channel)) return { status: "approved", held: "channel_not_publishing" };
  if (draft?.status !== "approved") return { status: draft?.status ?? "missing", held: "not_approved" };
  // An analysis older than ANALYSIS_TTL_HOURS never goes out (owner 2026-11-17: "kadaluwarsa otomatis").
  if (isStale(draft, { now })) { await desk(env).expireStale(now); return { status: "expired", held: "expired", note: EXPIRED_NOTE }; }
  // A channel with posting slots publishes in its slots only (src/scheduler.mjs), never at the approval.
  if (!slot) {
    const { settings } = await channelSettings(env);
    const s = settings[draft.channel];
    if (s?.schedule?.length) return { status: "approved", held: "waiting_for_slot", next: nextSlots(s.schedule, now, 1).map((x) => ({ at: new Date(x.at).toISOString(), wib: x.key }))[0] ?? null };
  }
  if (CHANNEL_SPECS[draft.channel]?.publisher !== "built") return { status: "approved", held: "publisher_not_built" };
  const account = await accountFor(env, draft.channel, { now, fetcher });
  if (!account) return { status: "approved", held: "account_not_configured" };
  // One claim before the platform is called (orchestrator review of #93): only the run that moves the draft from approved
  // to publishing posts it; a second run at the same moment gets "already_publishing" and calls nothing.
  const claim = await desk(env).claimPublish({ id: draft.id }, now);
  if (!claim?.ok) return { status: claim?.status ?? "approved", held: "already_publishing" };
  // The guardian once more on the text as approved, right before the platform (owner 2026-11-27: "pastikan guardian
  // mengecek dan reject ini sebelum approval posting"): a draft approved before a rule existed, or put back after a
  // failure, never goes out past it. It fails with the guardian's checks as its error; nothing is called.
  const gate = recheck(draft, { delayHours: delayOf(env), now });
  if (!gate.pass) {
    const checks = [...new Set(gate.failures.map((f) => f.check))].join(", ");
    console.log("cta_publish_failed", JSON.stringify({ id: draft.id, channel: draft.channel, kind: draft.kind, error: `guardian: ${checks}`, step: "guardian", code: null, subcode: null }));
    return desk(env).published({ id: draft.id, error: `the guardian refused it at publish: ${checks}` }, now);
  }
  // Every post goes out humanized (humanize.py in full; owner: "Everything, templates too"), checked by the guardian
  // again; the Archive keeps the text that went out.
  const out = publishText(draft, (d) => recheck(d, { delayHours: delayOf(env), now }));
  const sending = out.changed ? { ...draft, text: out.text } : draft;
  try {
    const r = await publishTo(draft.channel, { account, draft: sending, fetcher, media: () => mediaBytes(env, draft),
      saveToken: (token) => saveTokenSealed(env, draft.channel, token, now), tiktokAudited: String(env.TIKTOK_AUDITED ?? "").trim().toLowerCase() === "yes" });
    return desk(env).published({ id: draft.id, remoteId: r.remote_id, ...(out.changed ? { text: out.text } : {}) }, now);
  } catch (error) {
    // One telemetry line per failure (orchestrator review, 2026-11-25, after a Threads post failed with its error only
    // in the studio): the id, channel, kind and the error, at most 200 characters, never a token or a URL's query.
    console.log("cta_publish_failed", JSON.stringify({ id: draft.id, channel: draft.channel, kind: draft.kind, error: safeError(error), step: error?.step ?? null, code: error?.code ?? null, subcode: error?.subcode ?? null }));
    return desk(env).published({ id: draft.id, error: String(error?.message ?? error) }, now);
  }
}

/** An error for the log: no URL query, no token-like string, at most 200 characters. */
export const safeError = (error) => String(error?.message ?? error ?? "").replace(/(https?:\/\/[^\s?#]+)[?#]\S*/g, "$1").replace(/(access_token|token|key|secret)=\S+/gi, "$1=…").replace(/\b[A-Za-z0-9_\-]{32,}\b/g, "…").slice(0, 200);

/** A draft's own media from the desk ({ bytes, mime }), for the video publishers (they upload the bytes). */
export async function mediaBytes(env, draft) {
  const id = /\/media\/([0-9a-f]{32})\.(?:jpg|webm)$/.exec(String(draft?.image_url ?? ""))?.[1];
  const m = id ? await desk(env).media(id) : null;
  if (!m) throw new Error("the draft has no media");
  return { bytes: fromBase64(m.data), mime: m.content_type };
}

/**
 * Each channel's settings (src/settings.mjs): the stored ones over the defaults. A desk that cannot be read gives
 * the defaults, which are what the engine did before settings existed. `strict` (the studio page) throws instead,
 * so a person never edits the defaults over settings that could not be read.
 */
export async function channelSettings(env, { strict = false } = {}) {
  let stored = null;
  try { stored = await desk(env).settings(); } catch (e) { if (strict) throw e; stored = null; }
  return { settings: effectiveSettings(stored?.settings ?? {}), meta: stored?.meta ?? {} };
}
/** The settings applied to fresh drafts: kinds, the daily maximum (WIB day) and the hashtag line (guardian again). */
async function settled(env, drafts, settings, now, dropped = null) {
  if (!drafts.length) return drafts;
  let today = {};
  try { today = await desk(env).channelCounts(wibDayStart(now)); } catch { today = {}; }
  return applySettings(drafts, settings, { today, recheck: (d) => recheck(d, { delayHours: delayOf(env), now }), dropped });
}

/**
 * The daily recap drafts, queued once: the 24 hours that end the projection's own delay before now (the last 24 hours
 * at delay 0; owner 2026-11-26: "1.a"). Up to RECAPS_LIMIT rows (xauusd RC1; before it the RPC gave 50, which
 * `dailyDrafts` notices and drafts nothing: `cut` in the log).
 */
export const RECAPS_LIMIT = 200;
export async function draftDay(env, { now = Date.now() } = {}) {
  const projection = await env.PROJECTION.recaps({ days: 2, limit: RECAPS_LIMIT });
  const { settings } = await channelSettings(env);
  const windowDelayHours = Number.isFinite(Number(projection?.delay_hours)) ? Number(projection.delay_hours) : 24;
  const made = dailyDrafts(projection?.recaps ?? [], { now, channels: draftingChannels(channelsOf(env), settings), delayHours: delayOf(env), windowDelayHours });
  const summary = made.summary;
  const drafts = await settled(env, made.drafts, settings, now);
  const added = drafts.length ? await desk(env).add(drafts, now) : [];
  return { bars: summary.bars, window_delay_hours: windowDelayHours, ...(summary.cut ? { cut: true, rows: (projection?.recaps ?? []).length } : {}), drafts: drafts.map((d) => ({ id: d.id, status: d.status })), added };
}

/**
 * The 5-minute pattern pass is a switch (orchestrator review of #113, 2026-11-27: xauusd's analysis() is not a cheap
 * read and the account is over its CPU and KV allowances, so 288 reads a day wait for a cheap M15 path there). Unset or
 * anything but "on": off, and the hourly run reads every chart's patterns as before.
 */
export const fastPassOn = (env) => String(env?.PATTERN_FAST_PASS ?? "").trim().toLowerCase() === "on";

/**
 * The pattern posts of one reading: the confirmed patterns of every chart (M15, H1, H4, D1) not posted yet, and an
 * invalidated pattern's post (owner 2026-11-27: "berlaku juga untuk 1H/4H/1D termasuk jika ada pattern invalidated
 * tertrigger"). Moves the seen set and the ledger only on a reading with its patterns list.
 */
async function patternPass(env, d, analysis, { now, channels, settings, dropped }) {
  const known = new Set(await d.idsWithPrefix("pattern:"));
  const history = await d.draftsSince("pattern:", new Date(now - PATTERN_LOOKBACK_MS).toISOString());
  const seen = await d.studioSetting(PATTERN_SEEN_KEY);
  const seenBefore = new Set(Array.isArray(seen?.value?.keys) ? seen.value.keys : []);
  // M15 patterns have no daily cap and do not count toward the others' (owner 2026-11-27: "Tanpa batas khusus").
  const postedToday = await d.kindCounts("pattern", new Date(now).toISOString().slice(0, 10), "pattern:M15:");
  const made = analysisDrafts(analysis, { now, channels, postedToday, known, history, seenBefore, patternCharts: PATTERN_CHARTS, maps: false });
  const drafts = await settled(env, made, settings, now, dropped);
  const added = drafts.length ? await d.add(drafts, now) : [];
  if (!Array.isArray(analysis?.patterns)) return { drafts, added };
  await d.saveStudioSetting({ key: PATTERN_SEEN_KEY, value: { at: new Date(now).toISOString(), keys: seenPatternKeys(analysis, PATTERN_CHARTS) }, actor: "cta-agent" }, now);
  const ledgerRow = await d.studioSetting(PATTERN_LEDGER_KEY);
  const addedSet = new Set(added);
  const drafted = (analysis.patterns ?? []).filter((p) => drafts.some((x) => addedSet.has(x.id) && x.id.startsWith(`pattern:${p.chart}:${p.pattern}:confirmed:`)));
  const { ledger, invalidated } = updateLedger(Array.isArray(ledgerRow?.value?.items) ? ledgerRow.value.items : [], analysis, { drafted, now });
  // An invalidated pattern is posted once, with its card, on the channels where its confirmed post went out (owner
  // 2026-11-27: "dengan gambarnya dan hanya 1x posting termasuk jika terjadi invalidated").
  const out = [];
  for (const e of invalidated) {
    const went = new Set(history.filter((h) => h.status === "published").map((h) => patternOfId(h.id)).filter((o) => o && o.chart === e.chart && o.pattern === e.pattern && o.status === "confirmed").map((o) => o.channel));
    out.push(...invalidationDrafts([e], analysis, { channels: channels.filter((c) => went.has(c)), now }));
  }
  const ready = await settled(env, out, settings, now, dropped);
  const invalid = ready.length ? await d.add(ready, now) : [];
  await d.saveStudioSetting({ key: PATTERN_LEDGER_KEY, value: { at: new Date(now).toISOString(), items: ledger }, actor: "cta-agent" }, now);
  return { drafts: [...drafts, ...ready], added: [...added, ...invalid] };
}

/**
 * The real-time analysis drafts, queued once. The hourly run: the key-level maps, the pattern posts of every chart
 * (unless the 5-minute pass is on: then they are its), and the hourly pattern recap (owner 2026-11-27: "setiap jam perlu
 * recap pattern apa yang sedang aktif dengan target harganya dan pattern apa yang invalidated"). `fast`: the 5-minute
 * pass, the pattern posts only (owner 2026-11-27: "jika bisa ditrigger langsung ... tanpa menunggu jadwal 1H"), run only
 * while `fastPassOn`.
 */
export async function draftAnalysis(env, { now = Date.now(), fast = false } = {}) {
  const analysis = await env.PROJECTION.analysis();
  const d = desk(env);
  const { settings } = await channelSettings(env);
  const channels = draftingChannels(channelsOf(env), settings);
  const dropped = [];
  if (fast) {
    const p = await patternPass(env, d, analysis, { now, channels, settings, dropped });
    return { charts: PATTERN_CHARTS, patterns: (analysis?.patterns ?? []).length, drafts: p.drafts.map((x) => ({ id: x.id, status: x.status })), added: p.added, ...(dropped.length ? { dropped } : {}) };
  }
  const pat = fastPassOn(env) ? { drafts: [], added: [] } : await patternPass(env, d, analysis, { now, channels, settings, dropped });
  const knownLevels = new Set(await d.idsWithPrefix("levels:"));
  const maps = analysisDrafts(analysis, { now, channels, levelsRun: new Date(now).getUTCHours() === 6, knownLevels, patternCharts: [] });
  // The pattern recap at this reading's close (owner 2026-11-27: per closing candle, M15 with H1; "1A", "2A"): the
  // close's charts' active confirmed patterns and those invalidated since the last close (this run's included); none
  // when it would say nothing new ("Lewati", no duplicate).
  const ledgerRow = await d.studioSetting(PATTERN_LEDGER_KEY);
  const ledger = Array.isArray(ledgerRow?.value?.items) ? ledgerRow.value.items : [];
  const last = await d.studioSetting(PATTERN_RECAP_KEY);
  const recap = Array.isArray(analysis?.patterns) ? patternRecapDrafts(analysis, { ledger, lastSignature: last?.value?.signature ?? null, channels: channels.filter((c) => PATTERN_RECAP_CHANNELS.includes(c)), now }) : { drafts: [], skipped: "no_reading" };
  const rest = await settled(env, [...maps, ...recap.drafts], settings, now, dropped);
  const added = rest.length ? await d.add(rest, now) : [];
  if (recap.drafts.length) await d.saveStudioSetting({ key: PATTERN_RECAP_KEY, value: { at: new Date(now).toISOString(), signature: recap.signature }, actor: "cta-agent" }, now);
  const drafts = [...pat.drafts, ...rest];
  // What the run read, for its log every hour (orchestrator review, 2026-11-25, after the 07:09 UTC miss): each chart's
  // latest close and how many zones it has, and each draft left out with why.
  const read = analysisRead(analysis);
  return { zones: analysis?.zones?.length ?? 0, patterns: analysis?.patterns?.length ?? 0, ...read, ...(recap.skipped ? { recap: recap.skipped } : {}), drafts: drafts.map((x) => ({ id: x.id, status: x.status })), added: [...pat.added, ...added], ...(dropped.length ? { dropped } : {}) };
}

/** Pure: each chart's latest close (PublicProjection.analysis().closed) and its zone count (zones_by_chart), H1, H4, D1. */
export function analysisRead(analysis) {
  const charts = ["H1", "H4", "D1"];
  return {
    closed: Object.fromEntries(charts.map((c) => [c, typeof analysis?.closed?.[c] === "string" ? analysis.closed[c] : null])),
    zones_by_chart: Object.fromEntries(charts.map((c) => [c, Array.isArray(analysis?.zones_by_chart?.[c]) ? analysis.zones_by_chart[c].length : null]))
  };
}

/**
 * The per-channel scheduler (src/scheduler.mjs), every 5 minutes: for each channel with posting slots, each slot due
 * now is claimed once and publishes the channel's oldest approved draft (one post per slot). Nothing while publishing
 * is off. Never throws for one channel's failure (publishDraft records a failed post).
 */
export async function runSchedule(env, { now = Date.now(), fetcher } = {}) {
  // Aged analysis drafts are marked expired every run, publishing on or off, so the studio shows them as such.
  try { await desk(env).expireStale(now); } catch { /* the next run tries again */ }
  if (!publishOn(env)) return { status: "publishing_off" };
  const { settings } = await channelSettings(env, { strict: true });
  const d = desk(env);
  // cta-write first (src/agent/write.mjs): a written draft's auto-approve window starts again after it.
  const written = await agentWrite(env, { now, fetcher }).catch((e) => ({ status: "error", error: String(e?.message ?? e).slice(0, 160) }));
  const auto = await autoApprove(env, settings, { now, fetcher });
  const slots = [];
  for (const channel of channelsOf(env)) {
    const s = settings[channel];
    if (!s?.enabled || !s.schedule?.length || !publishesTo(env, channel)) continue;
    for (const slot of dueSlots(s.schedule, now)) {
      if (!(await d.claimSlot({ key: slot.key, channel, at: slot.at }, now))) continue;
      const draft = await d.nextApproved(channel, now);
      if (!draft) { await d.slotOutcome({ key: slot.key, channel, outcome: "empty" }); slots.push({ channel, slot: slot.key, outcome: "empty" }); continue; }
      const r = await publishDraft(env, draft, { now, fetcher, slot: true });
      const outcome = r?.status ?? "unknown";
      await d.slotOutcome({ key: slot.key, channel, draftId: draft.id, outcome: r?.held ? `held:${r.held}` : outcome });
      slots.push({ channel, slot: slot.key, id: draft.id, outcome, ...(r?.held ? { held: r.held } : {}) });
    }
  }
  return { status: "ran", slots, ...(auto.length ? { auto } : {}), ...(written?.status === "ran" && (written.written || written.kept) ? { written } : written?.status === "error" ? { written } : {}) };
}

/**
 * The agent's auto-approve (src/agent/auto-approve.mjs), at each scheduler run: per publishing channel, each pending
 * draft of a kind it approves automatically that is ready (AUTO_WINDOW_MINUTES, 0 since 2026-11-25) is approved as a person's approval is
 * (the guardian again; an aged analysis draft expires), then published at once or left for the channel's next slot.
 */
/** The auto-approve kinds with their family: Chart pattern brings the invalidated post and the hourly recap (owner 2026-11-27). */
export const withFamily = (kinds) => [...new Set([...(kinds ?? []), ...Object.keys(KIND_FAMILY).filter((k) => (kinds ?? []).includes(KIND_FAMILY[k]))])];
export async function autoApprove(env, settings, { now = Date.now(), fetcher } = {}) {
  const d = desk(env), out = [];
  for (const channel of publishChannels(env)) {
    const kinds = withFamily(settings[channel]?.enabled === false ? [] : settings[channel]?.auto_approve ?? []);
    if (!kinds.length) continue;
    for (const c of dueNow(await d.autoCandidates({ channel, kinds }), now)) {
      const r = await d.decide({ id: c.id, decision: "approve", actor: AUTO_ACTOR, reason: `rule: ${channel} approves ${c.kind} once it is ready and checked` }, now);
      const row = { channel, id: c.id, kind: c.kind, decided_by: AUTO_ACTOR, status: r?.status ?? "unknown" };
      if (r?.status === "approved") {
        const p = await publishDraft(env, await d.get(c.id), { now, ...(fetcher ? { fetcher } : {}) });
        row.publish = p?.status ?? null; if (p?.held) row.held = p.held;
      }
      out.push(row);
    }
  }
  return out;
}

/** Each channel's next slots, the approved drafts waiting and the next one, and the latest slot runs (the studio). */
export async function studioSchedule(env, { now = Date.now() } = {}) {
  const { settings } = await channelSettings(env, { strict: true });
  const d = desk(env);
  try { await d.expireStale(now); } catch { /* shown as approved until the next run */ }
  const waiting = await d.approvedCounts();
  const channels = {};
  for (const c of channelsOf(env)) {
    const s = settings[c];
    const next = s?.enabled && s.schedule?.length ? nextSlots(s.schedule, now, 3) : [];
    const draft = s?.schedule?.length ? await d.nextApproved(c, now) : null;
    channels[c] = { scheduled: Boolean(s?.schedule?.length), enabled: Boolean(s?.enabled), next: next.map((x) => ({ at: new Date(x.at).toISOString(), wib: x.key })),
      waiting: waiting[c] ?? 0, next_draft: draft ? { id: draft.id, kind: draft.kind, text: draft.text.slice(0, 160) } : null };
  }
  return { publish: publishOn(env) ? "on" : "off", publish_channels: publishChannels(env), channels, recent: await d.recentSlots(20) };
}

/** Refreshes Threads' and Instagram's long-lived tokens after REFRESH_AFTER_DAYS (only while publishing is on). */
export async function refreshTokens(env, { now = Date.now() } = {}) {
  if (!publishOn(env)) return { status: "publishing_off" };
  const out = {};
  for (const channel of channelsOf(env).filter((c) => c === "threads" || c === "instagram")) {
    const account = await accountFor(env, channel, { now });
    if (!account) { out[channel] = "not_configured"; continue; }
    if (channel === "instagram" && isBusinessToken(account.access_token)) { out[channel] = "does_not_expire"; continue; }
    const age = account.refreshed_at ? now - Date.parse(account.refreshed_at) : Infinity;
    if (age < REFRESH_AFTER_DAYS * 86_400_000) { out[channel] = "fresh"; continue; }
    try { await saveTokenSealed(env, channel, await refreshToken({ channel, token: account.access_token }), now); out[channel] = "refreshed"; }
    catch (e) { out[channel] = `failed: ${String(e?.message ?? e).slice(0, 120)}`; }
  }
  // TikTok's refresh token lives 180 days and rotates on use: refreshed here too when no post used it lately.
  if (channelsOf(env).includes("tiktok")) {
    const account = await accountFor(env, "tiktok", { now });
    const age = account?.refreshed_at ? now - Date.parse(account.refreshed_at) : Infinity;
    if (!account) out.tiktok = "not_configured";
    else if (age < REFRESH_AFTER_DAYS * 86_400_000) out.tiktok = "fresh";
    else {
      try { await saveTokenSealed(env, "tiktok", await tiktokAccessToken({ account, fetcher: (...a) => fetch(...a) }), now); out.tiktok = "refreshed"; }
      catch (e) { out.tiktok = `failed: ${String(e?.message ?? e).slice(0, 120)}`; }
    }
  }
  return out;
}

/**
 * Reads the metrics of the posts published in the last INSIGHTS_DAYS days (the channels in CONTENT_INSIGHTS) and
 * stores them. A channel without an account, or one whose read fails, is reported and skipped; never throws.
 */
export async function collectInsights(env, { now = Date.now(), fetcher = (...a) => fetch(...a), limit = 60 } = {}) {
  const d = desk(env);
  const since = new Date(now - INSIGHTS_DAYS * 86_400_000).toISOString();
  const posts = (await d.publishedSince(since, limit)).filter((p) => p.remote_id);
  const channels = insightChannelsOf(env);
  const out = { posts: posts.length, read: 0, skipped: {}, failed: [] };
  const accounts = {}, tokens = {};
  for (const p of posts) {
    if (!channels.includes(p.channel)) { out.skipped[p.channel] = "not_read"; continue; }
    try {
      if (!(p.channel in accounts)) accounts[p.channel] = await accountFor(env, p.channel, { now, fetcher });
      const account = accounts[p.channel];
      if (!account) { out.skipped[p.channel] = "account_not_configured"; continue; }
      if (p.channel === "youtube" && !tokens.youtube) tokens.youtube = await googleAccessToken({ account, fetcher });
      const metrics = await postInsights(p.channel, { account, remoteId: p.remote_id, token: tokens[p.channel] ?? null, fetcher });
      if (metrics && await d.saveMetrics({ id: p.id, channel: p.channel, metrics }, now)) out.read += 1;
    } catch (e) { out.failed.push({ id: p.id, channel: p.channel, error: String(e?.message ?? e).slice(0, 160) }); }
  }
  return out;
}

/** The studio's performance report over the last INSIGHTS_DAYS days. */
export async function studioPerformance(env, { now = Date.now() } = {}) {
  const posts = await desk(env).publishedSince(new Date(now - INSIGHTS_DAYS * 86_400_000).toISOString(), 500);
  return { ...performanceReport(posts, { channels: channelsOf(env) }), read: insightChannelsOf(env), posts: posts.slice(0, 50).map((p) => ({ id: p.id, channel: p.channel, kind: p.kind, published_at: p.published_at, metrics: p.metrics, metrics_at: p.metrics_at })) };
}

/**
 * Each channel's connection for the Channels page: how it connects (OAuth or a bot), whether the provider app's
 * secrets and the token key are set, the connected account's name, scopes and expiry, and the redirect URI to
 * register with the provider. Never a token, a secret, or an app secret's value.
 */
export async function studioConnections(env) {
  const conns = await desk(env).connections().catch(() => ({}));
  const entered = await desk(env).credsStatus().catch(() => ({}));
  const keyReady = await encryptionReady(env);
  const out = {};
  for (const c of CHANNELS) {
    const p = PROVIDERS[c];
    const conn = conns[c] ?? null;
    const account = await accountFor(env, c).catch(() => null);
    const app = p ? await appFor(env, c).catch(() => null) : null;
    const manual = entered[c]?.manual ?? null;
    out[c] = {
      name: CHANNEL_SPECS[c].name,
      method: BOT_CHANNELS.includes(c) ? "bot" : "oauth",
      provider: p?.name ?? "Telegram Bot API",
      app_configured: p ? Boolean(app) : Boolean((env?.TELEGRAM_BOT_TOKEN && env?.TELEGRAM_CHAT_ID) || manual),
      // Where the app comes from (platform secrets or entered in the studio) and its masked id; never the secret.
      app_source: p ? (app?.source ?? null) : (env?.TELEGRAM_BOT_TOKEN && env?.TELEGRAM_CHAT_ID ? "platform" : manual ? "studio" : null),
      app_hint: app?.source === "studio" ? (entered[c]?.app?.hint ?? null) : null,
      app_secrets: p ? [p.app.id, p.app.secret] : ["TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"],
      app_labels: p ? (p.pkce || c === "youtube" ? ["Client ID", "Client secret"] : c === "tiktok" ? ["Client key", "Client secret"] : ["App ID", "App secret"]) : null,
      paste_fields: PASTE_FIELDS[c] ?? [],
      manual: manual ? { hint: manual.hint, updated_at: manual.updated_at, updated_by: manual.updated_by } : null,
      scopes_asked: p?.scopes ?? [],
      connected: Boolean(account),
      via: conn ? "oauth" : manual && account ? "studio" : account ? "secrets" : null,
      account_name: conn?.account_name ?? null,
      scopes: conn?.scopes ?? null,
      connected_at: conn?.connected_at ?? null,
      connected_by: conn?.connected_by ?? null,
      expires_at: conn?.expires_at ?? null
    };
  }
  return { channels: out, redirect_uri: redirectUri(originOf(env)), token_key_set: keyReady, key_secret: "TOKEN_ENC_KEY" };
}

/** The studio's status: publishing, channels (configured or not, never a token), counts. */
export async function studioStatus(env) {
  const channels = {};
  const { settings } = await channelSettings(env);
  for (const c of CHANNELS) {
    const spec = CHANNEL_SPECS[c];
    const account = await accountFor(env, c);
    channels[c] = {
      name: spec.name, enabled: channelsOf(env).includes(c), media: spec.media, publisher: spec.publisher, note: spec.note,
      // The formats a person may choose for this channel, and the one its settings use (the Create page's default).
      formats: FORMATS[c], format: settings[c]?.format ?? FORMATS[c][0],
      configured: Boolean(account),
      quota: account && publishOn(env) && (c === "threads" || c === "instagram") ? await publishingQuota({ channel: c, account }) : null
    };
  }
  const brand = brandOf(DEFAULT_BRAND);
  return { publish: publishOn(env) ? "on" : "off", publish_channels: publishChannels(env), brand: { id: brand.id, name: brand.name, handles: brand.handles }, delay_hours: delayOf(env), channels, counts: await desk(env).counts() };
}

/**
 * What a composed post needs from the projection: the recap window's decision times (the guardian's delay rule) for
 * a recap, the analysis for a template's card (the same numbers as its text).
 */
async function composeContext(env, kind, { now, analysis = false, ref = null }) {
  // War Room (owner 2026-11-18): the source's latest reading; an AI Worker without the method answers as "not yet".
  if (kind === "warroom") {
    if (!analysis) return { decisionTimes: [] };
    let warroom;
    try { warroom = typeof env.PROJECTION?.warroom === "function" ? await env.PROJECTION.warroom({ source: sourceOf(ref) }) : { error: "the AI Worker has no War Room reading yet" }; }
    catch { warroom = { error: "the AI Worker did not answer" }; }
    return { warroom, decisionTimes: [] };
  }
  if (kind === "daily_recap") {
    const p = await env.PROJECTION.recaps({ days: 2, limit: RECAPS_LIMIT });
    const recapDelayHours = Number.isFinite(Number(p?.delay_hours)) ? Number(p.delay_hours) : 24;
    return { recaps: p?.recaps ?? [], recapDelayHours, decisionTimes: recapWindow(p?.recaps ?? [], now, recapDelayHours).summary?.decision_times ?? [] };
  }
  if (analysis && (kind === "key_levels" || kind === "pattern")) return { analysis: await env.PROJECTION.analysis(), decisionTimes: [] };
  return { decisionTimes: [] };
}
const textOf = (v) => (typeof v === "string" ? v.slice(0, 6000) : "");

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
const STUDIO_ROUTES = ["/api/studio/agent/replies", "/api/studio/agent/model", "/api/studio/agent", "/api/studio/connections", "/api/studio/connect/app", "/api/studio/connect/token", "/api/studio/connect/start", "/api/studio/connect/disconnect", "/api/studio/connect/check", "/api/studio/growth", "/api/studio/links", "/api/studio/hashtag-sets", "/api/studio/mix", "/api/studio/schedule", "/api/studio/library", "/api/studio/edit", "/api/studio/duplicate", "/api/studio/calendar", "/api/studio/media-library", "/api/studio/templates", "/api/studio/check", "/api/studio/compose", "/api/studio/settings", "/api/studio/performance", "/api/studio/insights-now", "/api/studio/drafts", "/api/studio/draft", "/api/studio/preview", "/api/studio/status", "/api/studio/decide", "/api/studio/publish-now", "/api/studio/draft-now", "/api/studio/render-now", "/api/studio/media", "/api/studio/whoami"];
/** The public origin of the cards Instagram fetches (GET /media/<id>.jpg). */
export const originOf = (env) => String(env?.PUBLIC_ORIGIN || "https://cta.cryptophys.work").replace(/\/+$/, "");
const MEDIA_PATH = /^\/media\/([0-9a-f]{32})\.(jpg|webm)$/;
/** A published post's card as a path on this site, or null (a video, or no card). */
export const cardPathOf = (imageUrl) => { const m = /\/media\/([0-9a-f]{32})\.jpg$/.exec(String(imageUrl ?? "")); return m ? `/media/${m[1]}.jpg` : null; };
const randomHex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");

/**
 * Renders the cards of the drafts waiting for one (oldest first, at most `limit` a run) and attaches them; each
 * draft then waits for a person. A card that fails (the chart did not load, the text does not fit) leaves its
 * draft waiting, with the reason in its history. `launch` opens a browser (Browser Run over BROWSER).
 */
export async function renderImages(env, { now = Date.now(), launch, limit = 3, retry = false, render = renderCard, renderMovie = renderVideo } = {}) {
  if (typeof launch !== "function") return { status: "no_browser" };
  const d = desk(env);
  const waiting = await d.needingImage(limit, retry);
  const brand = brandOf(DEFAULT_BRAND);
  const out = [];
  for (const draft of waiting) {
    try {
      const disclaimers = [DISCLAIMER, ANALYSIS_DISCLAIMER];
      // A video channel (YouTube, TikTok): the card, then the 9:16 video made from it; otherwise the card.
      const video = draft.status === "needs_video" ? await renderMovie(draft, brand, { launch, disclaimers }) : null;
      const bytes = video ? video.bytes : await render(draft, brand, { launch, disclaimers });
      const mediaId = randomHex(16);
      const r = await d.attachImage({ id: draft.id, mediaId, data: toBase64(bytes), bytes: bytes.length, contentType: video ? video.mime : "image/jpeg",
        imageUrl: `${originOf(env)}/media/${mediaId}.${video ? "webm" : "jpg"}`, delayHours: delayOf(env) }, now);
      out.push({ id: draft.id, status: r.ok ? r.status : "error", ...(r.ok ? {} : { error: r.error }) });
    } catch (error) {
      const reason = String(error?.message ?? error).slice(0, 200);
      await d.note({ id: draft.id, action: "render_failed", detail: reason }, now).catch(() => {});
      out.push({ id: draft.id, status: "render_failed", error: reason });
    }
  }
  return { waiting: waiting.length, rendered: out };
}

const image = (m, cache) => new Response(fromBase64(m.data), { status: 200, headers: { "content-type": m.content_type, "cache-control": cache, "x-content-type-options": "nosniff" } });

/** The HTTP face. `deps` lets tests inject the desk, the clock and the JWT check's fetch. */
export async function handle(request, env, { fetchImpl = fetch, now, launch, cache = globalThis.caches?.default } = {}) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const route = `${request.method} ${path}`;
  if (route === "GET /health") return json({ ok: true, service: "cryptophys-cta", publish: publishOn(env) ? "on" : "off", publish_channels: publishChannels(env) });

  // The public face: the brand's profile and the published archive. Nothing private.
  if (route === "GET /api/public/profile") {
    const brand = brandOf(DEFAULT_BRAND);
    return json({ brand: { id: brand.id, name: brand.name, tagline: brand.tagline, capacity: brand.capacity, disclaimer: brand.disclaimer }, links: profileLinks(brand) });
  }
  // A card, for Instagram to fetch: only once its draft is approved (Instagram fetches it at publishing) or published.
  const media = request.method === "GET" ? MEDIA_PATH.exec(path) : null;
  if (media) {
    const m = await desk(env).media(media[1]).catch(() => null);
    // Served while the post is going out too (status publishing, the claim of #93): Threads and Instagram fetch the
    // card during the publish call; without it they answered "400 An unknown error occurred" (2026-11-25 15:15, 16:10).
    if (!m || !PUBLIC_MEDIA.includes(m.draft_status)) return json({ error: "not_found" }, 404);
    // A post the Archive leaves out (its text fails the guardian's level checks, owner 2026-11-27) is not served either.
    if (levelFailures(m.draft_text).length) return json({ error: "not_found" }, 404);
    if ((media[2] === "webm") !== (m.content_type === "video/webm")) return json({ error: "not_found" }, 404);
    return image(m, "public, max-age=86400");
  }
  // A tracked link (src/marketing.mjs): count the click (link, channel, WIB day; nothing about the person) and send
  // the visitor on with UTM tags. Only links made in the studio, to our own or the brand's profile hosts.
  const go = request.method === "GET" || request.method === "HEAD" ? GO_PATH.exec(path) : null;
  if (go) {
    const link = await desk(env).link(go[1]).catch(() => null);
    if (!link) return json({ error: "not_found" }, 404);
    if (request.method === "GET") await desk(env).click({ slug: go[1], channel: go[2] }, now ? now * 1000 : Date.now()).catch(() => {});
    return new Response(null, { status: 302, headers: { location: redirectTarget(link, go[2]), "cache-control": "no-store", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" } });
  }
  // The holo war room (the home page): the rooms' latest public scenes, cached at the edge for a minute, so visitors
  // never reach the AI Worker more than once a minute per data centre. No per-visitor AI call.
  if (route === "GET /api/public/warroom-scene") return warroomScene(env, request, cache);
  // The simulated track record (the Performance page and the header's average strip): aggregates in R, cached a minute.
  if (route === "GET /api/public/track-record") return trackRecord(env, request, cache);
  if (route === "GET /api/public/archive") {
    // Each post with its card's path (owner 2026-11-23, the Archive as a digest: the card on click), only when it is our
    // own JPEG card (/media/<id>.jpg, public once the post is published); a video or no card: null. Never the stored URL.
    return rpc(async () => ({ posts: (await desk(env).archive(Number(url.searchParams.get("limit")) || 30)).map(({ image_url, ...p }) => ({ ...p, image: cardPathOf(image_url) })) }), "archive_failed");
  }

  if (isStudio(path)) {
    const v = await verifyAccessJwt(request.headers.get("cf-access-jwt-assertion"), env, { fetchImpl, ...(now ? { now } : {}) });
    if (!v.ok) {
      // A person opening the studio page without a valid sign-in gets the sign-in page (still 403, nothing private);
      // the API and every other caller keep the JSON refusal. Once Access covers the studio paths, Access shows its
      // own login before the Worker; this page then only appears for an expired or refused sign-in.
      if (!path.startsWith("/api/") && (request.method === "GET" || request.method === "HEAD")) return asset(env, request, url, "/signin", 403); // the assets serve signin.html at /signin (auto-trailing-slash)
      return json({ error: "access_denied", reason: v.reason }, 403);
    }
    const identity = v.identity;
    const role = roleOf(env, identity);
    if (path.startsWith("/api/studio/")) {
      if (route === "GET /api/studio/whoami") return json({ subject: identity.subject, type: identity.type, role, can_decide: role === "approver", can_write: role !== "service", roles_set: Boolean(String(env?.STUDIO_APPROVERS ?? "").trim()) });
      if (route === "GET /api/studio/status") return rpc(() => studioStatus(env), "status_failed");
      if (route === "GET /api/studio/drafts") {
        const status = url.searchParams.get("status") || null;
        const channel = CHANNELS.includes(url.searchParams.get("channel")) ? url.searchParams.get("channel") : null;
        return rpc(async () => {
          const d = desk(env);
          const drafts = await d.list({ status, channel, limit: 50 });
          // When each pending draft under a channel's auto-approve rule goes out by itself (null: it waits for a person).
          const { settings } = await channelSettings(env);
          const autoBy = {};
          for (const c of new Set(drafts.filter((x) => x.status === "pending").map((x) => x.channel))) {
            const kinds = withFamily(publishChannels(env).includes(c) ? settings[c]?.auto_approve ?? [] : []);
            for (const a of kinds.length ? await d.autoCandidates({ channel: c, kinds }) : []) autoBy[a.id] = autoAt(a);
          }
          return { drafts: drafts.map((x) => (x.id in autoBy ? { ...x, auto_at: autoBy[x.id] } : x)), counts: await d.counts(), by_channel: await d.channelCountsByStatus(), can_decide: role === "approver", can_write: role !== "service" };
        }, "drafts_failed");
      }
      if (route === "GET /api/studio/draft") return rpc(async () => (await desk(env).get(String(url.searchParams.get("id") || "").slice(0, 160))) ?? { ok: false, error: "no such draft" }, "draft_failed");
      if (route === "GET /api/studio/preview") {
        return rpc(async () => {
          const d = await desk(env).get(String(url.searchParams.get("id") || "").slice(0, 160));
          if (!d) return { ok: false, error: "no such draft" };
          if (CHANNEL_SPECS[d.channel]?.publisher !== "built") return { ok: true, id: d.id, channel: d.channel, dry_run: true, requests: [], note: "publisher not built yet" };
          const account = { user_id: "<user>", access_token: "[token]", bot_token: "[token]", chat_id: "<channel>" };
          return { ok: true, id: d.id, channel: d.channel, ...(await publishTo(d.channel, { account, draft: d, dryRun: true, media: () => mediaBytes(env, d) })) };
        }, "preview_failed");
      }
      if (route === "POST /api/studio/decide") {
        const r = await personJson(request, url, identity);
        if (r.response) return r.response;
        const denied = approverOnly(role);
        if (denied) return denied;
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
      // Publish now (owner 2026-11-17: an approval made while publishing was off waited with no way out): an approver
      // sends one approved (or failed, tried again) draft now, slots or not. Only a channel in PUBLISH_CHANNELS.
      if (route === "POST /api/studio/publish-now") {
        const r = await personJson(request, url, identity);
        if (r.response) return r.response;
        const denied = approverOnly(role);
        if (denied) return denied;
        const id = typeof r.body.id === "string" ? r.body.id.slice(0, 160) : "";
        if (!id) return json({ error: "id is required" }, 400);
        return rpc(async () => {
          const at = now ? now * 1000 : Date.now();
          const d = desk(env);
          let draft = await d.get(id);
          if (!draft) return { ok: false, error: "no such draft" };
          if (!publishesTo(env, draft.channel)) return { ok: false, error: `${CHANNEL_SPECS[draft.channel]?.name ?? draft.channel} does not publish yet (PUBLISH_CHANNELS)` };
          if (draft.status === "failed") { await d.requeue({ id, actor: identity.subject }, at); draft = await d.get(id); }
          if (draft.status !== "approved") return { ok: false, error: `only an approved or failed draft can be sent (this one is ${draft.status})` };
          const out = await publishDraft(env, draft, { now: at, slot: true, fetcher: fetchImpl });
          if (out?.status === "published") return { ok: true, ...out };
          // Why it did not go out, in the answer (2026-11-18: a TikTok refusal showed only "HTTP 400" in the studio).
          const after = await d.get(id).catch(() => null);
          return { ok: false, ...out, error: String(out?.error ?? after?.error ?? out?.held ?? "not published").slice(0, 300) };
        }, "publish_failed");
      }
      // Channel accounts (src/oauth.mjs): Connect, Disconnect and Check by an approver; the status for anyone signed in.
      if (route === "GET /api/studio/connections") return rpc(async () => ({ ...(await studioConnections(env)), can_connect: role === "approver", role, who: identity.subject ?? null }), "connections_failed");
      // Entered in the studio (2026-11-17, owner: "klik connect muncul ... untuk input token API ataupun OAuth"): an
      // approver sets a channel's OAuth app (id and secret) or pastes its token or bot. Sealed with TOKEN_ENC_KEY in
      // the desk, POST only, never echoed back: the answer and the page carry a masked hint at most.
      if (route === "POST /api/studio/connect/app" || route === "POST /api/studio/connect/token") {
        const r = await personJson(request, url, identity, 4096);
        if (r.response) return r.response;
        const denied = approverOnly(role);
        if (denied) return denied;
        const b = r.body || {};
        const channel = typeof b.channel === "string" ? b.channel : "";
        if (!CHANNELS.includes(channel)) return json({ error: "unknown channel" }, 400);
        const at = now ? now * 1000 : Date.now();
        if (!(await encryptionReady(env))) return json({ error: "TOKEN_ENC_KEY is not set yet: the platform sets it once (32 random bytes, base64); nothing is stored unencrypted" }, 409);
        const str = (v, max) => (typeof v === "string" ? v.trim() : "").slice(0, max);
        if (route === "POST /api/studio/connect/app") {
          if (!PROVIDERS[channel]) return json({ error: `${CHANNEL_SPECS[channel].name} has no OAuth app: use Set bot` }, 400);
          if (b.clear === true) return rpc(() => saveCredsSealed(env, { channel, kind: "app", value: null, actor: identity.subject }, at), "app_failed");
          const id = str(b.app_id, 300), secret = str(b.app_secret, 500);
          if (!/^[A-Za-z0-9._:-]{4,300}$/.test(id)) return json({ error: "the app/client id looks wrong (letters, digits, . _ : -)" }, 400);
          if (secret.length < 8 || /\s/.test(secret)) return json({ error: "the app/client secret looks wrong" }, 400);
          return rpc(async () => ({ ...(await saveCredsSealed(env, { channel, kind: "app", value: { id, secret }, hint: hintOf(id), actor: identity.subject }, at)), hint: hintOf(id) }), "app_failed");
        }
        const fields = PASTE_FIELDS[channel];
        if (!fields) return json({ error: `${CHANNEL_SPECS[channel].name} connects by OAuth only (Set up app, then Connect)` }, 400);
        if (b.clear === true) return rpc(() => saveCredsSealed(env, { channel, kind: "manual", value: null, actor: identity.subject }, at), "token_failed");
        const value = Object.fromEntries(fields.map((f) => [f, str(b[f], 4000)]));
        // The account id of Threads and Instagram is optional: the provider's answer gives it.
        const missing = fields.filter((f) => (f === "user_id" ? value[f] && /\s/.test(value[f]) : !value[f] || /\s/.test(value[f])));
        if (missing.length) return json({ error: `missing or malformed: ${missing.join(", ")}` }, 400);
        if (channel === "telegram") { const problem = telegramChatIdProblem(value.chat_id); if (problem) return json({ error: problem }, 400); }
        // Checked with the provider before it is kept: a token that does not work is never stored.
        let check;
        try {
          check = channel === "telegram"
            ? await checkTelegram({ bot_token: value.bot_token, chat_id: value.chat_id }, { fetcher: fetchImpl })
            : await identify(channel, { access_token: value.access_token, user_id: value.user_id }, { fetcher: fetchImpl });
        } catch (e) {
          const msg = String(e?.message ?? e).slice(0, 160);
          if (channel === "telegram" && /chat not found/i.test(msg)) return json({ error: TELEGRAM_CHAT_NOT_FOUND }, 400);
          return json({ error: `the provider refused it: ${msg}` }, 400);
        }
        if (channel === "telegram" && check?.can_post === false) return json({ error: `The bot cannot post in that chat (${check.chat_type ?? "chat"}, bot is ${check.status ?? "not a member"}). ${check.advice ?? "Make the bot an administrator with Post Messages, then press Set bot again."}` }, 400);
        if ("user_id" in value && !value.user_id) value.user_id = check?.id || "";
        if ("user_id" in value && !value.user_id) return json({ error: "the provider gave no account id: enter it" }, 400);
        const hint = hintOf(value.access_token ?? value.bot_token);
        return rpc(async () => {
          await desk(env).removeConnection({ channel, actor: identity.subject }, at).catch(() => null); // one way per channel
          await saveCredsSealed(env, { channel, kind: "manual", value, hint, actor: identity.subject }, at);
          return { ok: true, channel, hint, check: channel === "telegram" ? { bot: check?.bot ?? null, chat: check?.chat ?? null, can_post: check?.can_post ?? null } : { name: check?.name ?? null, id: check?.id ?? null } };
        }, "token_failed");
      }
      if (route === "POST /api/studio/connect/start" || route === "POST /api/studio/connect/disconnect" || route === "POST /api/studio/connect/check") {
        const r = await personJson(request, url, identity, 512);
        if (r.response) return r.response;
        const denied = approverOnly(role);
        if (denied) return denied;
        const channel = typeof r.body.channel === "string" ? r.body.channel : "";
        if (!CHANNELS.includes(channel)) return json({ error: "unknown channel" }, 400);
        const at = now ? now * 1000 : Date.now();
        if (route === "POST /api/studio/connect/disconnect") {
          return rpc(async () => {
            const r = await desk(env).removeConnection({ channel, actor: identity.subject }, at);
            if (PASTE_FIELDS[channel]) await saveCredsSealed(env, { channel, kind: "manual", value: null, actor: identity.subject }, at).catch(() => null);
            return r;
          }, "disconnect_failed");
        }
        if (route === "POST /api/studio/connect/check") {
          return rpc(async () => {
            try {
              if (channel === "telegram") {
                const bot = await accountFor(env, "telegram", { now: at });
                if (!bot) return { ok: false, error: "no bot yet: Set bot (its token and the channel's chat id)" };
                return { ok: true, check: await checkTelegram({ bot_token: bot.bot_token, chat_id: bot.chat_id }, { fetcher: fetchImpl }) };
              }
              const account = await accountFor(env, channel, { now: at });
              if (!account) return { ok: false, error: "not connected" };
              let token = account.access_token;
              if (channel === "youtube") token = await googleAccessToken({ account, fetcher: fetchImpl });
              if (channel === "tiktok") { const t = await tiktokAccessToken({ account, fetcher: fetchImpl }); await saveTokenSealed(env, "tiktok", t, at); token = t.access_token; }
              return { ok: true, check: await identify(channel, { access_token: token }, { fetcher: fetchImpl }) };
            } catch (e) { return { ok: false, error: String(e?.message ?? e).slice(0, 200) }; }
          }, "check_failed");
        }
        // Start: the provider's sign-in URL for a one-time state (PKCE for X). The tokens never reach this page.
        if (BOT_CHANNELS.includes(channel)) return json({ error: "Telegram connects with a bot token (Set bot), not OAuth" }, 400);
        const app = await appFor(env, channel);
        if (!app) return json({ error: `the ${PROVIDERS[channel].name} app is not set up: enter its ${PROVIDERS[channel].app.id} and ${PROVIDERS[channel].app.secret} with "Set up app"` }, 400);
        if (!(await encryptionReady(env))) return json({ error: "TOKEN_ENC_KEY is not set yet: the platform sets it once (32 random bytes, base64) before any account is connected" }, 400);
        return rpc(async () => {
          const attempt = await newAttempt(channel);
          await desk(env).putOAuthState({ state: attempt.state, channel, verifier: attempt.verifier, actor: identity.subject }, at);
          return { ok: true, url: authorizeUrl(channel, { clientId: app.id, redirect: redirectUri(originOf(env)), state: attempt.state, challenge: attempt.challenge }) };
        }, "connect_failed");
      }
      // The CTA agent (owner 2026-11-25: "setuju semua, mulai dari Checks"): the Threads drafts' checks (src/agent/checks.mjs).
      // Read only; posts still come from the xauusd templates and nothing here changes a draft.
      // Audit and Plan (src/agent/audit.mjs): the last complete WIB week on the channel against its own median, and the
      // week's suggested mix and slots; a suggested slot is added by a person through POST /api/studio/settings.
      // One agent for every channel (owner 2026-11-25): `?channel=`; it manages AGENT_CHANNELS (phase 1: Threads), and a
      // channel it does not manage yet shows as such, with no data.
      if (route === "GET /api/studio/agent") {
        return rpc(async () => {
          const at = now ? now * 1000 : Date.now();
          const asked = url.searchParams.get("channel");
          const channel = CHANNELS.includes(asked) ? asked : AGENT_CHANNELS[0];
          const base = { channel, active: AGENT_CHANNELS.includes(channel), channels: agentChannels(), model: await modelStatus(env, modelStore(env, at), { now: at }), can_edit: role === "approver" };
          if (!base.active) return { ...base, skills: agentChecks([], { channel }).skills };
          const d = desk(env);
          const posts = await d.measuredPosts();
          const audit = auditChannel(posts, { channel, now: at });
          const schedule = (await channelSettings(env)).settings[channel]?.schedule ?? [];
          const summary = (await d.studioSetting(summaryKey(channel)))?.value ?? null;
          const rs = (await d.studioSetting("agent_replies")) ?? null;
          const replies = REPLY_CHANNELS.includes(channel) ? { ...replyMode(env, rs?.value ?? null, at), caps: REPLY_CAPS, dry_run_hours: DRY_RUN_HOURS, switched_by: rs?.updated_by ?? null, switched_at: rs?.updated_at ?? null,
            sent_today: await d.repliesSentSince(new Date(at - 86_400_000).toISOString()), recent: (await d.recentReplies(30)).filter((x) => x.channel === channel) } : null;
          const ws = (await d.studioSetting("agent_write")) ?? null;
          const write = WRITE_CHANNELS.includes(channel) ? { ...writeMode(env, ws?.value ?? null, rs?.value ?? null), enabled: ws?.value?.enabled === true, kinds_all: WRITE_KINDS, lede_ok: rs?.value?.about_lede_ok === true,
            switched_by: ws?.updated_by ?? null, switched_at: ws?.updated_at ?? null, recent: (await d.recentWrites(20)).filter((x) => x.channel === channel) } : null;
          return { ...base, ...agentChecks(await d.list({ channel, limit: 30 }), { channel }), write, audit: { ...audit, summary: summary?.week === audit.week.from ? summary.text : null },
            plan: planChannel(audit, posts, { now: at, schedule }), replies };
        }, "agent_failed");
      }
      // The Replies' switch (src/agent/replies.mjs): an approver stops or resumes the autonomous replies; logged.
      if (route === "POST /api/studio/agent/replies") {
        const r = await personJson(request, url, identity);
        if (r.response) return r.response;
        const denied = approverOnly(role);
        if (denied) return denied;
        const patch = {};
        if ("enabled" in r.body) { if (typeof r.body.enabled !== "boolean") return json({ error: "enabled must be true or false" }, 400); patch.enabled = r.body.enabled; }
        // The About lede's gate (orchestrator review of #80): set once the owner's words for it are on the page.
        if ("about_lede_ok" in r.body) { if (typeof r.body.about_lede_ok !== "boolean") return json({ error: "about_lede_ok must be true or false" }, 400); patch.about_lede_ok = r.body.about_lede_ok; }
        if (!Object.keys(patch).length) return json({ error: "nothing to change" }, 400);
        // Set only while the Worker's own /about carries the owner's sentence (orchestrator review of #85); the settings
        // event keeps who set it and when.
        if (patch.about_lede_ok === true) {
          if (!(await aboutLedeLive(env, url))) return json({ error: "lede_not_live", detail: "the About page does not show the approved sentence yet" }, 409);
          patch.about_lede_set_by = identity.subject; patch.about_lede_set_at = new Date(now ? now * 1000 : Date.now()).toISOString();
        }
        return rpc(async () => {
          const cur = (await desk(env).studioSetting("agent_replies"))?.value ?? {};
          return desk(env).saveStudioSetting({ key: "agent_replies", value: { ...cur, ...patch }, actor: identity.subject }, now ? now * 1000 : Date.now());
        }, "replies_switch_failed");
      }
      // cta-write's switch (src/agent/write.mjs), the kill switch: off means every post keeps its template. An approver.
      if (route === "POST /api/studio/agent/write") {
        const r = await personJson(request, url, identity);
        if (r.response) return r.response;
        const denied = approverOnly(role);
        if (denied) return denied;
        if (typeof r.body.enabled !== "boolean") return json({ error: "enabled must be true or false" }, 400);
        if ("kinds" in r.body && (!Array.isArray(r.body.kinds) || r.body.kinds.some((k) => !WRITE_KINDS.includes(k)))) return json({ error: `kinds must be among ${WRITE_KINDS.join(", ")}` }, 400);
        return rpc(async () => {
          const cur = (await desk(env).studioSetting("agent_write"))?.value ?? {};
          const value = { ...cur, enabled: r.body.enabled, kinds: r.body.kinds ?? cur.kinds ?? [...WRITE_KINDS], reason: r.body.enabled ? null : "turned off in the studio: posts use the template" };
          return desk(env).saveStudioSetting({ key: "agent_write", value, actor: identity.subject }, now ? now * 1000 : Date.now());
        }, "write_switch_failed");
      }
      // The model's switch (src/agent/router.mjs): an approver turns it off or on; the studio's event log keeps who and when.
      if (route === "POST /api/studio/agent/model") {
        const r = await personJson(request, url, identity);
        if (r.response) return r.response;
        const denied = approverOnly(role);
        if (denied) return denied;
        if (typeof r.body.enabled !== "boolean") return json({ error: "enabled must be true or false" }, 400);
        return rpc(() => desk(env).saveStudioSetting({ key: "agent_model", value: { enabled: r.body.enabled, reason: r.body.enabled ? null : "turned off in the studio" }, actor: identity.subject }, now ? now * 1000 : Date.now()), "model_switch_failed");
      }
      // Growth (src/growth.mjs): A/B results, best posting times per channel, evergreen suggestions.
      if (route === "GET /api/studio/growth") {
        return rpc(async () => {
          const at = now ? now * 1000 : Date.now();
          const d = desk(env);
          const posts = await d.measuredPosts();
          const copied = new Set(await d.copiedSince(new Date(at - EVERGREEN_MIN_DAYS * 86_400_000).toISOString()));
          return { ab: (await d.abTests()).map((g) => ({ grp: g.grp, channel: g.channel, created_at: g.created_at, ...abResult(g.a, g.b), text_a: g.a?.text?.slice(0, 160) ?? null, text_b: g.b?.text?.slice(0, 160) ?? null })),
            best_times: bestTimes(posts), evergreen: evergreen(posts, { now: at, copiedSince: copied }), measured: posts.length };
        }, "growth_failed");
      }
      // Marketing (src/marketing.mjs): tracked links, hashtag sets, the weekly content mix.
      if (route === "GET /api/studio/links") {
        return rpc(async () => ({ links: (await desk(env).links()).map((l) => ({ ...l, short: Object.fromEntries(channelsOf(env).map((c) => [c, shortUrl(originOf(env), l.slug, c)])) })),
          hosts: linkHosts(env), can_edit: identity.type === "user" }), "links_failed");
      }
      if (route === "POST /api/studio/links") {
        const r = await personJson(request, url, identity);
        if (r.response) return r.response;
        const n = normalizeLink(r.body, { hosts: linkHosts(env) });
        if (!n.ok) return json({ error: n.error }, 400);
        return rpc(async () => {
          for (let i = 0; i < 3; i++) {
            const out = await desk(env).addLink({ slug: randomSlug(), link: n.link, actor: identity.subject }, now ? now * 1000 : Date.now());
            if (out.ok) return out;
          }
          return { ok: false, error: "could not make a short link; try again" };
        }, "links_failed");
      }
      if (route === "GET /api/studio/hashtag-sets") return rpc(async () => ({ sets: await desk(env).hashtagSets(), max: MAX_SETS }), "sets_failed");
      if (route === "POST /api/studio/hashtag-sets") {
        const r = await personJson(request, url, identity);
        if (r.response) return r.response;
        const remove = r.body.remove === true;
        const n = remove ? { ok: typeof r.body.name === "string" && r.body.name.trim() !== "", set: { name: String(r.body.name ?? "").trim().slice(0, 40) }, error: "name is required" } : normalizeHashtagSet(r.body);
        if (!n.ok) return json({ error: n.error }, 400);
        return rpc(() => desk(env).saveHashtagSet({ set: n.set, remove, actor: identity.subject, max: MAX_SETS }, now ? now * 1000 : Date.now()), "sets_failed");
      }
      if (route === "GET /api/studio/mix") {
        return rpc(async () => {
          const at = now ? now * 1000 : Date.now();
          const stored = await desk(env).studioSetting("mix");
          const targets = stored?.value ?? DEFAULT_MIX;
          const week = wibWeek(at);
          return { targets, kinds: MIX_KINDS, updated_at: stored?.updated_at ?? null, updated_by: stored?.updated_by ?? null, week, ...mixReport(targets, await desk(env).kindMix(week.from, week.to)) };
        }, "mix_failed");
      }
      if (route === "POST /api/studio/mix") {
        const r = await personJson(request, url, identity);
        if (r.response) return r.response;
        const denied = approverOnly(role);
        if (denied) return denied;
        const n = normalizeMix(r.body.targets);
        if (!n.ok) return json({ error: n.error }, 400);
        return rpc(() => desk(env).saveStudioSetting({ key: "mix", value: n.mix, actor: identity.subject }, now ? now * 1000 : Date.now()), "mix_failed");
      }
      if (route === "GET /api/studio/schedule") return rpc(() => studioSchedule(env, { now: now ? now * 1000 : Date.now() }), "schedule_failed");
      // Content management: the library (filters, words, WIB days), a person's edit (the guardian again; a media
      // channel's card is made again), a copy of any draft, the calendar and the media library.
      if (route === "GET /api/studio/library") {
        const p = (k) => url.searchParams.get(k) || null;
        return rpc(async () => ({ ...(await desk(env).library({ status: p("status"), channel: p("channel"), kind: p("kind"), q: p("q"), from: p("from"), to: p("to"), offset: Number(p("offset")) || 0, limit: 30 })),
          can_edit: identity.type === "user" }), "library_failed");
      }
      if (route === "POST /api/studio/edit" || route === "POST /api/studio/duplicate") {
        const r = await personJson(request, url, identity, 16_000);
        if (r.response) return r.response;
        const id = typeof r.body.id === "string" ? r.body.id.slice(0, 160) : "";
        if (!id) return json({ error: "id is required" }, 400);
        const at = now ? now * 1000 : Date.now();
        const checkOptions = { delayHours: delayOf(env), now: at };
        if (route === "POST /api/studio/edit") return rpc(() => desk(env).edit({ id, text: textOf(r.body.text), actor: identity.subject, checkOptions }, at), "edit_failed");
        const newId = `manual:${new Date(at).toISOString().slice(0, 10)}:${randomHex(4)}`;
        return rpc(() => desk(env).duplicate({ id, newId, actor: identity.subject, checkOptions }, at), "duplicate_failed");
      }
      if (route === "GET /api/studio/calendar") {
        const month = url.searchParams.get("month") || new Date((now ? now * 1000 : Date.now()) + 7 * 3_600_000).toISOString().slice(0, 7);
        return rpc(() => desk(env).calendar(month), "calendar_failed");
      }
      if (route === "GET /api/studio/media-library") return rpc(() => desk(env).mediaList({ offset: Number(url.searchParams.get("offset")) || 0 }), "media_failed");
      // Create: a template filled with the current analysis (or a blank post), each channel's text checked by the
      // guardian as it is typed, and the post sent to the queue (a person only; every channel must pass).
      if (route === "GET /api/studio/templates") {
        const kind = url.searchParams.get("kind") || "custom";
        if (!COMPOSE_KINDS.includes(kind)) return json({ error: `kind must be one of ${COMPOSE_KINDS.join(", ")}` }, 400);
        const channels = String(url.searchParams.get("channels") || "").split(",").filter((c) => channelsOf(env).includes(c));
        return rpc(async () => {
          const at = now ? now * 1000 : Date.now();
          const ctx = await composeContext(env, kind, { now: at, analysis: true, ref: url.searchParams.get("ref") });
          const { settings } = await channelSettings(env);
          return { ...templateTexts(kind, { channels, settings, analysis: ctx.analysis, recaps: ctx.recaps, recapDelayHours: ctx.recapDelayHours, warroom: ctx.warroom, ref: url.searchParams.get("ref"), now: at }), kinds: COMPOSE_KINDS, kind_names: COMPOSE_KIND_NAMES };
        }, "template_failed");
      }
      if (route === "POST /api/studio/check") {
        const r = await personJson(request, url, identity, 16_000);
        if (r.response) return r.response;
        const kind = String(r.body.kind ?? ""), channel = String(r.body.channel ?? "");
        return rpc(async () => {
          const at = now ? now * 1000 : Date.now();
          const ctx = COMPOSE_KINDS.includes(kind) ? await composeContext(env, kind, { now: at }) : { decisionTimes: [] };
          const c = checkPost({ channel, kind, text: textOf(r.body.text), decisionTimes: ctx.decisionTimes, delayHours: delayOf(env), now: at });
          return { channel: c.channel, length: c.length, limit: c.limit, guardian: c.guardian };
        }, "check_failed");
      }
      if (route === "POST /api/studio/compose") {
        const r = await personJson(request, url, identity, 48_000);
        if (r.response) return r.response;
        const kind = String(r.body.kind ?? "");
        const ref = typeof r.body.ref === "string" ? r.body.ref.slice(0, 160) : null;
        const posts = Array.isArray(r.body.posts) ? r.body.posts.map((p) => ({ channel: String(p?.channel ?? ""), text: textOf(p?.text), ...(typeof p?.text_b === "string" ? { text_b: textOf(p.text_b) } : {}), ...(typeof p?.format === "string" ? { format: p.format } : {}) })) : null;
        // The format a person chose for each channel's post (text, image, video), before it is made; else the channel's setting.
        for (const p of posts ?? []) if (p.format != null && !FORMATS[p.channel]?.includes(p.format)) return json({ error: `${CHANNEL_SPECS[p.channel]?.name ?? p.channel} cannot post ${p.format} yet` }, 400);
        return rpc(async () => {
          const at = now ? now * 1000 : Date.now();
          const ctx = COMPOSE_KINDS.includes(kind) ? await composeContext(env, kind, { now: at, analysis: true }) : { decisionTimes: [] };
          const made = composeDrafts({ kind, posts, allowed: channelsOf(env), decisionTimes: ctx.decisionTimes, delayHours: delayOf(env), now: at,
            overlay: () => overlayFor(kind, ctx.analysis, ref), id: randomHex(4) });
          if (!made.ok) return made;
          const { settings } = await channelSettings(env);
          const chosen = Object.fromEntries((posts ?? []).map((p) => [p.channel, p.format ?? settings[p.channel]?.format]));
          made.drafts = made.drafts.map((d) => withFormat(d, chosen[d.channel], { recheck: (x) => recheck(x, { delayHours: delayOf(env), now: at }) }));
          const added = await desk(env).add(made.drafts, at, identity.subject);
          for (const t of made.ab) await desk(env).addAbTest(t, at);
          return { ok: true, added, drafts: made.drafts.map((d) => ({ id: d.id, channel: d.channel, status: d.status })), ab: made.ab };
        }, "compose_failed");
      }
      // The Channels page: each channel's settings, what it can take, and who changed them last. Never a token.
      if (route === "GET /api/studio/settings") {
        return rpc(async () => ({ ...(await channelSettings(env, { strict: true })), formats: FORMATS, planned: PLANNED_FORMATS, kinds: KINDS, kind_names: KIND_NAMES, auto_kinds: AUTO_KINDS, auto_kind_names: AUTO_KIND_NAMES, days: DAYS,
          timezone: TIMEZONE, max_per_day: MAX_PER_DAY, max_slots: MAX_SLOTS, can_edit: role === "approver" }), "settings_failed");
      }
      if (route === "POST /api/studio/settings") {
        const r = await personJson(request, url, identity);
        if (r.response) return r.response;
        const denied = approverOnly(role);
        if (denied) return denied;
        const channel = typeof r.body.channel === "string" ? r.body.channel : "";
        const n = normalizeSettings(channel, r.body.settings);
        if (!n.ok) return json({ error: n.error }, 400);
        return rpc(() => desk(env).saveSettings({ channel, settings: n.settings, actor: identity.subject }, now ? now * 1000 : Date.now()), "settings_failed");
      }
      if (route === "GET /api/studio/performance") return rpc(() => studioPerformance(env, { now: now ? now * 1000 : Date.now() }), "performance_failed");
      if (route === "POST /api/studio/insights-now") {
        const r = await personJson(request, url, identity, 256);
        if (r.response) return r.response;
        return rpc(() => collectInsights(env, { now: now ? now * 1000 : Date.now(), fetcher: fetchImpl }), "insights_failed");
      }
      if (route === "GET /api/studio/media") {
        const m = await desk(env).media(String(url.searchParams.get("id") || "")).catch(() => null);
        return m ? image(m, "private, no-store") : json({ error: "not_found" }, 404);
      }
      if (route === "POST /api/studio/render-now") {
        const r = await personJson(request, url, identity, 256);
        if (r.response) return r.response;
        return rpc(() => renderImages(env, { launch, retry: true, now: now ? now * 1000 : Date.now() }), "render_failed");
      }
      if (route === "POST /api/studio/draft-now") {
        const r = await personJson(request, url, identity, 256);
        if (r.response) return r.response;
        // The cards too, as the scheduled run does right after drafting (2026-11-17: drafts made here waited for the next
        // hourly run with "Needs image", and an analysis expires 2 hours after it was read).
        return rpc(async () => {
          const at = now ? now * 1000 : Date.now();
          const recap = await draftDay(env), analysis = await draftAnalysis(env);
          return { recap, analysis, cards: await renderImages(env, { launch, now: at }) };
        }, "draft_failed");
      }
      if (STUDIO_ROUTES.includes(path)) return json({ error: "method_not_allowed" }, 405);
      return json({ error: "not_found" }, 404);
    }
    // The provider's redirect after the person signed in (src/oauth.mjs): the one-time state, then the code is
    // exchanged here, server-side; the tokens are stored encrypted and the person returns to the Channels page.
    if (path === CALLBACK_PATH && request.method === "GET") return oauthCallback(env, url, identity, role, { fetchImpl, now: now ? now * 1000 : Date.now() });
    // /studio: the studio page; /studio/<file> (studio.js): that asset itself. Both after the JWT check. Before
    // 2026-11-16 every /studio/* path got the page, so /studio/studio.js came back as HTML and the studio never ran.
    return asset(env, request, url, path === "/studio" ? "/studio/" : null);
  }

  if (request.method === "GET" || request.method === "HEAD") return asset(env, request, url, path === "/" ? "/index.html" : null);
  return json({ error: "not_found" }, 404);
}

/** The OAuth callback: never shows a token; any failure returns to the Channels page with a short reason. */
async function oauthCallback(env, url, identity, role, { fetchImpl, now }) {
  const back = (params) => new Response(null, { status: 302, headers: { location: `/studio?${new URLSearchParams(params)}#channels`, "cache-control": "no-store", "referrer-policy": "no-referrer" } });
  const state = url.searchParams.get("state") || "";
  if (role !== "approver") return back({ oauth: "error", reason: "only an approver connects accounts" });
  if (!STATE_RE.test(state)) return back({ oauth: "error", reason: "missing or malformed state" });
  const taken = await desk(env).takeOAuthState({ state, actor: identity.subject }, now).catch(() => ({ ok: false, error: "the desk did not answer" }));
  if (!taken.ok) return back({ oauth: "error", reason: taken.error });
  const channel = taken.channel;
  if (url.searchParams.get("error")) return back({ oauth: "error", channel, reason: String(url.searchParams.get("error_description") || url.searchParams.get("error")).slice(0, 160) });
  const code = url.searchParams.get("code") || "";
  if (!code || code.length > 2048) return back({ oauth: "error", channel, reason: "no code from the provider" });
  const app = await appFor(env, channel);
  if (!app || !(await encryptionReady(env))) return back({ oauth: "error", channel, reason: "the app or TOKEN_ENC_KEY is not set" });
  try {
    const t = await exchangeCode(channel, { code, verifier: taken.verifier, app, redirect: redirectUri(originOf(env)), fetcher: fetchImpl });
    await desk(env).saveConnection({ channel, account_id: t.account_id, account_name: t.account_name, scopes: t.scopes, actor: identity.subject,
      token: { access_token: await sealToken(env, t.access_token), refresh_token: t.refresh_token ? await sealToken(env, t.refresh_token) : null, expires_in: t.expires_in } }, now);
    // An OAuth connection replaces a token pasted before (one way per channel at a time).
    if (PASTE_FIELDS[channel]) await desk(env).saveCreds({ channel, kind: "manual", data: null, actor: identity.subject }, now).catch(() => null);
    return back({ oauth: "ok", channel });
  } catch (e) {
    console.error("oauth_exchange_failed", channel, String(e?.message ?? e).slice(0, 160));
    return back({ oauth: "error", channel, reason: String(e?.message ?? e).slice(0, 160) });
  }
}

/** How long the edge keeps the war room's scene (the rooms conclude every 15 minutes at the most). */
export const SCENE_TTL_S = 60;
const SCENE_FIELDS = ["source", "label", "at", "bias", "moderator", "analysts"];
const ANALYST_FIELDS = ["id", "bias", "metrics", "claim", "rebuttal", "rebuts"];
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o?.[k] !== undefined).map((k) => [k, o[k]]));
/**
 * The scene as the page reads it: only the fields PublicProjection.warroomScene documents (it already filters every
 * sentence; nothing else it might grow, such as a stance or a confidence, is passed on), cached for SCENE_TTL_S.
 */
const sceneHeaders = (ok) => ({ "content-type": "application/json; charset=utf-8", "cache-control": ok ? `public, max-age=${SCENE_TTL_S}` : "no-store", "x-content-type-options": "nosniff" });
export async function warroomScene(env, request, cache) {
  const key = new Request(new URL("/api/public/warroom-scene", request.url).toString(), { method: "GET" });
  // A copy from the edge cache comes back with the zone's browser TTL (4 hours, seen live 2026-11-19), which would
  // freeze a visitor's scene: its headers are set again here, so a browser never keeps it longer than a minute.
  const hit = await cache?.match(key).catch(() => null);
  if (hit) return new Response(hit.body, { status: hit.status, headers: sceneHeaders(true) });
  let body, ok = true;
  try {
    if (typeof env.PROJECTION?.warroomScene !== "function") throw new Error("the AI Worker has no war room scene yet");
    const s = await env.PROJECTION.warroomScene();
    const rooms = {};
    for (const [source, room] of Object.entries(s?.rooms ?? {})) {
      if (!["15m", "1h", "4h", "1d"].includes(source) || !room || typeof room !== "object") continue;
      rooms[source] = { ...pick(room, SCENE_FIELDS), analysts: (Array.isArray(room.analysts) ? room.analysts : []).map((a) => pick(a, ANALYST_FIELDS)) };
    }
    body = { rooms, notice: "Analysis, not a signal." };
  } catch (error) {
    ok = false;
    console.error("warroom_scene_failed", String(error?.message ?? error).slice(0, 160));
    body = { rooms: {}, error: "the war room scene is not available", notice: "Analysis, not a signal." };
  }
  const res = new Response(JSON.stringify(body), { status: ok ? 200 : 502, headers: sceneHeaders(ok) });
  if (ok && cache) await cache.put(key, res.clone()).catch(() => {});
  return res;
}

/**
 * How long the edge and the browser keep the track record: a minute (owner 2026-11-25: "harus realtime", as Nexus's;
 * the AI Worker counts every closed plan at once), the pages read it again each minute (site/home/live.js).
 */
export const TRACK_TTL_S = 60;
const TRACK_IDS = ["first", "second", "managed"];
const TRACK_NUMBERS = ["count", "won", "lost", "even", "win_rate", "expectancy_r", "net_r", "avg_win_r", "avg_loss_r", "profit_factor"];
const TRACK_NOTICE = "Simulated, in R. Not advice and not an invitation to trade.";
const trackHeaders = (cacheable) => ({ "content-type": "application/json; charset=utf-8", "cache-control": cacheable ? `public, max-age=${TRACK_TTL_S}` : "no-store", "x-content-type-options": "nosniff" });
const num = (x) => (typeof x === "number" && Number.isFinite(x) ? x : null);
// A string passed on: short, and never an internal name.
const word = (x, max = 120) => (typeof x === "string" && !/\b(nexus|omega)/i.test(x) ? x.slice(0, max) : null);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/**
 * Pure: the track record as the page reads it, from PublicProjection.trackRecord (xauusd-ai-trading-assistant #499):
 * only the documented fields, numbers only as finite numbers, R only. The managed exit carries numbers only when both
 * the replay check and its own `shown` say so; otherwise `{ id, label, shown: false, note }`. Null when there is no
 * record to show (no method yet, the AI Worker's "unavailable", another unit).
 */
export function publicTrackRecord(raw) {
  if (!raw || typeof raw !== "object" || raw.status === "unavailable" || raw.unit !== "R" || !Array.isArray(raw.scenarios)) return null;
  const replayShown = raw.replay_check?.shown === true;
  const scenarios = TRACK_IDS.map((id) => {
    const s = raw.scenarios.find((x) => x?.id === id);
    if (!s) return null;
    const label = word(s.label);
    if (s.shown !== true || (id === "managed" && !replayShown) || num(s.count) === null) return { id, label, shown: false, note: word(s.note) ?? "Shown once the replay matches the live account." };
    return { id, label, shown: true, since: DAY.test(s.since) ? s.since : null, ...Object.fromEntries(TRACK_NUMBERS.map((k) => [k, num(s[k])])) };
  }).filter(Boolean);
  if (!scenarios.some((s) => s.shown)) return null;
  return {
    available: true, version: word(raw.version), unit: "R", simulated: true,
    delay_hours: num(raw.delay_hours) ?? 24, updated_at: word(raw.updated_at, 40), count: num(raw.count), since: DAY.test(raw.since) ? raw.since : null,
    replay_check: { status: word(raw.replay_check?.status, 40), shown: replayShown },
    scenarios, notice: TRACK_NOTICE
  };
}
/**
 * GET /api/public/track-record: PublicProjection.trackRecord() through publicTrackRecord, cached TRACK_TTL_S at the edge
 * (Cache API) and in the browser. Without a record (an AI Worker without the method, a failure, nothing shown yet) it
 * answers 200 `{ available: false }`, not cached, so the page says the numbers are not available yet.
 */
export async function trackRecord(env, request, cache) {
  const key = new Request(new URL("/api/public/track-record", request.url).toString(), { method: "GET" });
  const hit = await cache?.match(key).catch(() => null);
  if (hit) return new Response(hit.body, { status: hit.status, headers: trackHeaders(true) });
  let body = null;
  try {
    if (typeof env.PROJECTION?.trackRecord !== "function") throw new Error("the AI Worker has no track record yet");
    body = publicTrackRecord(await env.PROJECTION.trackRecord());
  } catch (error) {
    console.error("track_record_failed", String(error?.message ?? error).slice(0, 160));
  }
  const res = new Response(JSON.stringify(body ?? { available: false, unit: "R", simulated: true, scenarios: [], notice: TRACK_NOTICE }), { status: 200, headers: trackHeaders(Boolean(body)) });
  if (body && cache) await cache.put(key, res.clone()).catch(() => {});
  return res;
}

/** Whether the Worker's own About page (its static assets) carries the owner's sentence about the model. */
export async function aboutLedeLive(env, url) {
  if (!env?.ASSETS) return false;
  try {
    let res = await env.ASSETS.fetch(new Request(new URL("/about", url.origin).toString()));
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) res = await env.ASSETS.fetch(new Request(new URL(res.headers.get("location"), url.origin).toString()));
    return res.ok && (await res.text()).includes(ABOUT_LEDE);
  } catch { return false; }
}

/** The draft statuses whose card is public: approved, being published (the platform fetches it then), published. */
export const PUBLIC_MEDIA = Object.freeze(["approved", "publishing", "published"]);

async function asset(env, request, url, rewrite, status) {
  if (!env.ASSETS) return json({ error: "not_found" }, 404);
  const target = rewrite ? new Request(new URL(rewrite, url.origin).toString(), { method: request.method, headers: request.headers }) : request;
  const res = await env.ASSETS.fetch(target);
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
  if (status) headers.set("cache-control", "no-store");
  return new Response(res.body, { status: status && res.ok ? status : res.status, headers });
}


/** The router's store on the Desk (src/agent/router.mjs): the switch, the call log and the spend. */
export const modelStore = (env, now = Date.now()) => {
  const d = desk(env);
  return { setting: (k) => d.studioSetting(k), saveSetting: (i) => d.saveStudioSetting(i, now), record: (c) => d.recordModelCall(c, now), spendSince: (s) => d.modelSpendSince(s), recent: (n) => d.recentModelCalls(n) };
};
/**
 * cta-write (src/agent/write.mjs), at each scheduler run while it is on: rewords up to 3 fresh template drafts per
 * channel it writes, behind rule 4's guards; the template stays on any failure.
 */
export async function agentWrite(env, { now = Date.now(), fetcher } = {}) {
  const d = desk(env);
  const mode = writeMode(env, (await d.studioSetting("agent_write"))?.value ?? null, (await d.studioSetting("agent_replies"))?.value ?? null);
  if (mode.mode === "off") return { status: "off", why: mode.why };
  const out = { status: "ran", written: 0, kept: 0, channels: {} };
  const store = modelStore(env, now);
  for (const channel of WRITE_CHANNELS) {
    const r = await runWrite(channel, {
      candidates: () => d.writeCandidates({ channel, kinds: mode.kinds, sinceIso: new Date(now - WRITE_WINDOW_MINUTES * 60_000).toISOString() }),
      ask: (messages) => askModel(env, store, { purpose: `write:${channel}`, messages, maxTokens: 1200, now, ...(fetcher ? { fetcher } : {}) }),
      check: (x) => recheck(x, { delayHours: delayOf(env), now }),
      record: ({ draft, ...x }) => d.recordWrite({ ...x, ...(x.text && draft ? { guardian: recheck({ ...draft, text: x.text }, { delayHours: delayOf(env), now }) } : {}), actor: WRITE_ACTOR }, now)
    });
    out.channels[channel] = r; out.written += r.written; out.kept += r.kept;
    if (r.stopped) { out.stopped = r.stopped; break; }
  }
  return out;
}

/** The Audit's weekly summary (src/agent/weekly.mjs), at the daily run: once a WIB week per channel the agent manages, only with the model's key. */
export async function agentWeekly(env, { now = Date.now(), fetcher } = {}) {
  if (!String(env?.REFLECTION_API_KEY ?? "").trim()) return { status: "no_key" };
  const posts = await desk(env).measuredPosts();
  const out = {};
  for (const channel of AGENT_CHANNELS) out[channel] = await weeklySummary(env, modelStore(env, now), posts, { channel, now, ...(fetcher ? { fetcher } : {}) });
  return { status: Object.values(out).every((r) => r.status === "done_already") ? "done_already" : "ran", channels: out };
}

/**
 * The CTA agent's Replies (src/agent/replies.mjs), every 15 minutes: per reply channel, the replies under our posts of
 * the last REPLY_WINDOW_DAYS, answered within the caps. The first run starts the dry run (DRY_RUN_HOURS); a live answer
 * goes out only on a channel that publishes (PUBLISH_CHANNELS).
 */
export async function agentReplies(env, { now = Date.now(), fetcher, sleep } = {}) {
  const d = desk(env);
  const setting = (await d.studioSetting("agent_replies"))?.value ?? null;
  let mode = replyMode(env, setting, now);
  if (mode.mode === "off") return { status: "off", why: mode.why };
  if (!mode.since) {
    const value = { ...(setting ?? {}), since: new Date(now).toISOString() };
    await d.saveStudioSetting({ key: "agent_replies", value, actor: "cta-agent" }, now);
    mode = replyMode(env, value, now);
  }
  const out = {};
  for (const channel of REPLY_CHANNELS) {
    if (mode.mode === "live" && !publishChannels(env).includes(channel)) { out[channel] = { status: "channel_not_publishing" }; continue; }
    const account = await accountFor(env, channel, { now, ...(fetcher ? { fetcher } : {}) }).catch(() => null);
    if (!account?.access_token) { out[channel] = { status: "account_not_configured" }; continue; }
    const recent = (await d.publishedSince(new Date(now - REPLY_WINDOW_DAYS * 86_400_000).toISOString(), 50)).filter((p) => p.channel === channel && /^\d+$/.test(String(p.remote_id ?? "")));
    const posts = [];
    for (const p of recent) posts.push({ id: p.id, remote_id: String(p.remote_id), text: (await d.get(p.id))?.text ?? "" });
    const store = modelStore(env, now);
    const f = fetcher ? { fetcher } : {};
    out[channel] = await runReplies(channel, mode, {
      posts,
      fetchReplies: (mediaId) => threadsReplies({ account, mediaId, ...f }),
      seen: (id) => d.replySeen(id), answeredInThread: (postId, author) => d.answeredInThread(postId, author),
      sentSince: (s) => d.repliesSentSince(s), record: (r) => d.recordReply(r),
      ask: (messages) => askModel(env, store, { purpose: `reply:${channel}`, messages, maxTokens: 1500, now, ...f }),
      room: async (source) => (typeof env.PROJECTION?.warroom === "function" ? env.PROJECTION.warroom({ source }) : null),
      send: (text, replyToId) => publishThreadsReply({ account, text, replyToId, ...f, ...(sleep ? { sleep } : {}) })
    }, { now });
  }
  return { status: mode.mode, channels: out };
}
/** Forgets the usernames and texts of replies older than KEEP_DAYS (Privacy), at the daily run. */
export const forgetOldReplies = (env, { now = Date.now() } = {}) => desk(env).forgetReplies(new Date(now - KEEP_DAYS * 86_400_000).toISOString());
