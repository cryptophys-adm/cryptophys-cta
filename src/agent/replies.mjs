// The CTA agent's Replies (owner 2026-11-25: "semua autonomous jadi reply tanpa approval"; caps "10 an hour, 40 a day";
// "By themselves after 3 days"; after instagram-agent-skill's ig-reply, MIT: src/agent/LICENSE-instagram-agent-skill).
// One agent for every channel (src/agent/rules.mjs); phase 1 answers on Threads only (REPLY_CHANNELS).
//
// What it does, every 15 minutes: reads the replies under our posts of the last REPLY_WINDOW_DAYS, sorts each one
// (ig-reply's triage: market, question, substance, support, noise), and answers only what deserves it:
//   - market (buy, sell, entry, target, stop, a price prediction): always the fixed MARKET_REPLY, never model text;
//   - question and substance: a short model answer (Beam through src/agent/router.mjs) that must pass checkReply, or none;
//   - room (what the room reads: the bias, the outlook, the War Room; owner 2026-11-25: "War room opsional jika ada
//     pertanyaan butuh reply", then "Yes, from a fixed template"): the latest War Room reading of the chart it names
//     (daily if none), filled into the fixed ROOM template from PublicProjection.warroom, never model text;
//   - support and noise: no answer (a reply is reach, and reach is what bait came for).
// The guards (orchestrator review of the plan, 2026-11-25): no number, price, level or direction in model text; the
// guardian's rules and a reply-quality rule on every answer, and the disclaimer on each; at most 1 answer per person per
// thread, REPLY_CAPS an hour and a day, and the model's own daily cap; never a DM, never another account's thread;
// the first DRY_RUN_HOURS write and log what they would send and send nothing, then the agent goes live by itself;
// the studio's switch (studio setting `agent_replies`, an approver, logged) and the Worker var AGENT_REPLIES ("off"
// stops it at the next deploy) turn it off.
import { checkContentDraft } from "../guardian.mjs";
import { cleanInvisible, humanize } from "./humanizer.mjs";

export const REPLY_CHANNELS = Object.freeze(["threads"]);
export const REPLY_CAPS = Object.freeze({ hour: 10, day: 40, per_person_per_thread: 1 });
export const DRY_RUN_HOURS = 72;
export const REPLY_WINDOW_DAYS = 3;
export const KEEP_DAYS = 30;
export const REPLY_MAX = 280;
export const DISCLAIMER = "Not financial advice.";
/** The fixed answer to anything about buying, selling or where the price goes. */
export const MARKET_REPLY = "Thanks for asking. We don't give buy or sell calls: our posts are education, a reading of the chart, and how you use it is your call. Not financial advice.";

const MARKET = /\b(buy|sell|long|short|entry|enter|exit|tp|sl|take[- ]?profit|stop[- ]?loss|target|signal|lot ?size|lots? of \d|leverage|should i|will (it|gold|xau\w*) (go|rise|fall|drop|pump|dump|hit|reach)|where (is|will) (it|gold|price)|price (target|prediction)|moon|pump|dump)\b/i;
const ROOM = /\b(war ?room|the room|room'?s|bias|outlook|sentiment|bullish or bearish|bearish or bullish|what do (you|the analysts|your analysts) (think|see|read)|your (view|read|reading|take))\b/i;
const NOISE = /(https?:\/\/|www\.|t\.me\/|wa\.me\/|\bdm me\b|\bmessage me\b|\bsignal group\b|\bjoin (my|our)\b|\bguaranteed\b|\b\d+%\s*(daily|weekly|monthly|profit)\b|\bfollow (me|back)\b|\bcheck my (bio|profile)\b)/i;
const SUPPORT = /^(\W|\p{Extended_Pictographic}|nice|great|good|thanks|thank you|thx|cool|wow|love (it|this)|agreed?|true|facts|👍|🔥)+$/iu;
const DIRECTION = /\b(bullish|bearish|rally|crash|breakout|break out|breakdown|surge|plunge|soar|tank|uptrend|downtrend|going (up|down)|go (up|down)|will (rise|fall|drop|climb)|higher|lower|support|resistance|level|zone|price)\b/i;
const LINKISH = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|ai|co|me|app|link|ly|gg|xyz|work)\b|t\.me\/|wa\.me\/)/i;
const QUALITY = /\b(guarantee\w*|promise\w*|risk[- ]?free|sure win|can't lose|cannot lose|we recommend|you should (buy|sell|trade|invest))\b/i;

/** ig-reply's triage of one reply: "market", "room", "question", "substance", "support" or "noise". */
export function triage(text) {
  const t = cleanInvisible(String(text ?? "")).text.trim();
  if (!t) return "noise";
  if (NOISE.test(t)) return "noise";
  if (MARKET.test(t)) return "market";
  if (ROOM.test(t)) return "room";
  if (SUPPORT.test(t) || t.split(/\s+/).length <= 3 && !/\?/.test(t)) return "support";
  if (/\?/.test(t)) return "question";
  return t.split(/\s+/).length >= 5 ? "substance" : "support";
}

/**
 * Whether an answer may go out. Model text (`fromModel`): no digit at all, no direction or level word, no trading
 * vocabulary; every answer: the guardian's rules (no instruction, signal words, promised return, account data,
 * internal name or secret), the reply-quality rule (no promise or "guarantee"), at most REPLY_MAX characters, and the
 * disclaimer. Returns { ok, failures }.
 */
export function checkReply(text, { fromModel = true } = {}) {
  const t = String(text ?? "").trim();
  const failures = [];
  if (!t) failures.push("empty");
  if ([...t].length > REPLY_MAX) failures.push("length");
  if (!t.endsWith(DISCLAIMER)) failures.push("disclaimer");
  if (QUALITY.test(t.replace(DISCLAIMER, ""))) failures.push("quality");
  if (fromModel) {
    const body = t.replace(DISCLAIMER, "");
    // The comment is untrusted (orchestrator review of #80): whatever it asked for, model text carries no link, no
    // mention and no hashtag either.
    if (LINKISH.test(body)) failures.push("link");
    if (/(^|\s)@\w/.test(body)) failures.push("mention");
    if (/(^|\s)#\w/.test(body)) failures.push("hashtag");
    if (/\d/.test(body)) failures.push("number");
    if (DIRECTION.test(body)) failures.push("direction");
    if (MARKET.test(body)) failures.push("market");
  }
  // The guardian's own rules, read on the answer as on a post (education and disclaimer are the reply's own above).
  const g = checkContentDraft({ text: `Education. ${t}` });
  for (const f of g.failures ?? []) if (!["capacity", "disclaimer", "too_recent", "attribution"].includes(f.check)) failures.push(`guardian:${f.check}`);
  return { ok: !failures.length, failures };
}

/** The model's answer made safe to check: one paragraph, the disclaimer at its end; null for SKIP. */
export function shapeAnswer(text) {
  const t = cleanInvisible(String(text ?? "")).text.replace(/\s+/g, " ").trim().replace(/^["']|["']$/g, "");
  if (!t || /^skip\.?$/i.test(t)) return null;
  const body = t.replace(/\s*Not financial advice\.?\s*$/i, "").trim();
  return `${body}${/[.!?]$/.test(body) ? "" : "."} ${DISCLAIMER}`;
}

const ROOM_NAMES = Object.freeze({ "15m": "15-minute", "1h": "1-hour", "4h": "4-hour", "1d": "daily" });
const BIAS = Object.freeze({ bullish: "Bullish", bearish: "Bearish", neutral: "Neutral" });
/** The War Room the comment names (the 15-minute, 1-hour, 4-hour or daily chart), or the daily one. */
export function roomOf(text) {
  const t = String(text ?? "").toLowerCase();
  if (/\b(15 ?m|15[- ]?min\w*|m15)\b/.test(t)) return "15m";
  if (/\b(1 ?h|h1|hourly|1[- ]?hour)\b/.test(t)) return "1h";
  if (/\b(4 ?h|h4|4[- ]?hour)\b/.test(t)) return "4h";
  return "1d";
}
/** How old a room's reading may be, in minutes: one bar of its chart plus 15 (orchestrator review of #82). */
export const ROOM_MAX_AGE_MIN = Object.freeze({ "15m": 30, "1h": 75, "4h": 255, "1d": 1455 });
/**
 * The fixed War Room answer from a reading (PublicProjection.warroom): the room, its bias, how many analysts were heard,
 * the close it was read at, and that it is no call; null without a usable reading, and null when the reading has no
 * close or is older than one bar of its chart plus 15 minutes, so an old bias is never shown as the room's latest.
 */
export function roomReply(reading, { now = Date.now() } = {}) {
  const room = ROOM_NAMES[reading?.source], bias = BIAS[reading?.bias];
  if (!room || !bias || reading?.error) return null;
  const at = Date.parse(reading.at ?? "");
  if (!Number.isFinite(at) || now - at > ROOM_MAX_AGE_MIN[reading.source] * 60_000 || at > now + 60_000) return null;
  const close = ` at the ${new Date(at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "UTC" }).replace(/\u202f/g, " ")} UTC close`;
  const heard = Number.isFinite(reading.analysts) && reading.analysts > 0 ? `, ${reading.analysts} analysts heard` : "";
  return `The room's latest reading of the ${room} chart${close}: ${bias}${heard}. It's a reading for education, not a call to buy or sell. ${DISCLAIMER}`;
}

/** The messages for the model: the post's first line and the reply, nothing else. */
export function replyPrompt({ postHead, reply }) {
  return [
    { role: "system", content: "You answer one comment under an educational post about gold (XAUUSD) on Threads, for the account Cryptophys. Write one or two short, friendly, plain English sentences, at most 200 characters. Answer only what the comment asks about the post's method or wording, or thank them for adding to it. Never write any number, price, level, zone, direction, forecast, buy or sell idea, promise, or advice. If the comment needs any of those, or you are unsure, answer exactly SKIP." },
    { role: "user", content: JSON.stringify({ post: String(postHead ?? "").slice(0, 140), comment: String(reply ?? "").slice(0, 500) }) }
  ];
}

/** The replies mode: "off" (the switch or AGENT_REPLIES), "dry_run" for the first DRY_RUN_HOURS, then "live". */
export function replyMode(env, setting, now = Date.now()) {
  if (String(env?.AGENT_REPLIES ?? "off").toLowerCase() !== "on") return { mode: "off", why: "AGENT_REPLIES is not on" };
  if (setting?.enabled === false) return { mode: "off", why: "stopped in the studio" };
  const since = Date.parse(setting?.since ?? "");
  if (!Number.isFinite(since)) return { mode: "dry_run", since: null, live_at: null };
  const liveAt = since + DRY_RUN_HOURS * 3_600_000;
  const base = { since: new Date(since).toISOString(), live_at: new Date(liveAt).toISOString() };
  if (now < liveAt) return { mode: "dry_run", ...base };
  // Live also waits for the About page's lede to match (orchestrator review of #80): while "No post is written freely
  // by a model" is the public sentence, the dry run continues. An approver sets `about_lede_ok` once the owner's words ship.
  if (setting?.about_lede_ok !== true) return { mode: "dry_run", ...base, waiting: "about_lede" };
  return { mode: "live", ...base };
}

/** An author's id for the caps, without keeping more than needed: a SHA-256 of the channel and the username. */
export async function authorKey(channel, username) {
  const data = new TextEncoder().encode(`${channel}:${String(username ?? "").toLowerCase()}`);
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", data))].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

/**
 * One run over one channel. `deps`: { posts: [{ remote_id, id, text }], fetchReplies(mediaId), seen(replyId),
 * answeredInThread(postId, author), sentSince(iso), record(row), ask(messages), send(text, replyToId) }.
 * In "dry_run" nothing is sent: each answer is logged as it would go. Returns what it did.
 */
export async function runReplies(channel, mode, deps, { now = Date.now() } = {}) {
  const out = { channel, mode: mode.mode, read: 0, answered: 0, logged: 0, skipped: {} };
  if (mode.mode === "off") return out;
  const skip = (why) => { out.skipped[why] = (out.skipped[why] ?? 0) + 1; };
  const room = async () => {
    const hour = await deps.sentSince(new Date(now - 3_600_000).toISOString()), day = await deps.sentSince(new Date(now - 86_400_000).toISOString());
    return hour < REPLY_CAPS.hour && day < REPLY_CAPS.day;
  };
  for (const post of deps.posts) {
    let replies = [];
    try { replies = await deps.fetchReplies(post.remote_id); } catch (e) { out.error = String(e?.message ?? e).slice(0, 160); break; }
    for (const r of replies) {
      if (r.own) continue;
      if (await deps.seen(r.id)) continue;
      out.read += 1;
      const author = await authorKey(channel, r.username);
      const bucket = triage(r.text);
      const row = { reply_id: r.id, channel, post_id: post.id, author, username: r.username, text: r.text, bucket, at: new Date(now).toISOString() };
      if (bucket === "support" || bucket === "noise") { await deps.record({ ...row, status: "no_answer" }); skip(bucket); continue; }
      if (await deps.answeredInThread(post.id, author)) { await deps.record({ ...row, status: "capped_person" }); skip("per_person"); continue; }
      if (!(await room())) { skip("cap"); break; }
      let answer = MARKET_REPLY, fromModel = false;
      if (bucket === "room") {
        const reading = deps.room ? await deps.room(roomOf(r.text)).catch(() => null) : null;
        answer = roomReply(reading, { now });
        if (!answer) { await deps.record({ ...row, status: "no_reading" }); skip("no_reading"); continue; }
      } else if (bucket !== "market") {
        const m = await deps.ask(replyPrompt({ postHead: String(post.text ?? "").split("\n")[0], reply: r.text }));
        if (!m.ok) { await deps.record({ ...row, status: "no_model", detail: m.skipped ?? m.error }); skip("no_model"); continue; }
        answer = shapeAnswer(m.text); fromModel = true;
        if (!answer) { await deps.record({ ...row, status: "model_skipped" }); skip("model_skipped"); continue; }
      }
      answer = humanize(answer).text;
      const c = checkReply(answer, { fromModel });
      if (!c.ok) { await deps.record({ ...row, answer, status: "blocked", detail: c.failures.join(",") }); skip("blocked"); continue; }
      if (mode.mode === "dry_run") { await deps.record({ ...row, answer, status: "dry_run" }); out.logged += 1; continue; }
      try {
        const sent = await deps.send(answer, r.id);
        await deps.record({ ...row, answer, status: "sent", remote_id: sent.remote_id });
        out.answered += 1;
      } catch (e) {
        await deps.record({ ...row, answer, status: "send_failed", detail: String(e?.message ?? e).slice(0, 160) });
        skip("send_failed");
      }
    }
    if (out.skipped.cap) break;
  }
  return out;
}
