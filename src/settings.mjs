// Channel settings (owner 2026-11-16: "setting konfigurasi channel ... content creation terjadwal untuk masing-masing
// channel beserta format contentnya apakah video/image/text only"). Pure: the shape of one channel's settings, their
// validation, and how the drafting applies them. Stored in the ContentDesk (table channel_settings, src/desk.mjs);
// edited in the studio's Channels page by a person.
//
//   enabled      the channel gets drafts (and, once publishing is on, posts); CONTENT_CHANNELS still bounds it
//   format       text | image | video: only the formats the channel's publisher can post today (FORMATS); the others
//                are listed as planned (PLANNED_FORMATS) and refused until their publisher is built
//   kinds        which drafts the channel gets: key-level map, chart pattern, daily recap
//   max_per_day  at most this many drafts a day for the channel (all kinds)
//   schedule     posting slots: days of the week and times in WIB (UTC+7). The per-channel scheduler
//                (src/scheduler.mjs) publishes the channel's oldest approved post at each slot; no slots: at approval
//   hashtags     the hashtag line of the channel's drafts (only #words; the guardian checks the draft again)
// Never a token or account id: accounts are Worker secrets set through the platform, shown only as connected or not.
import { CHANNELS, CHANNEL_SPECS, HASHTAGS, initialStatus } from "./channels.mjs";
import { CHART_CREDIT } from "./drafts.mjs";

export const KINDS = Object.freeze(["key_levels", "pattern", "daily_recap"]);
export const KIND_NAMES = Object.freeze({ key_levels: "Key-level map", pattern: "Chart pattern", daily_recap: "Daily recap" });
/**
 * The kinds a channel may approve automatically, 15 minutes after a draft is ready (owner 2026-11-25: "Chart pattern
 * (confirmed), Key-level map, Daily recap, War Room"; src/agent/auto-approve.mjs). Never a custom post.
 */
export const AUTO_KINDS = Object.freeze(["key_levels", "pattern", "daily_recap", "warroom"]);
export const AUTO_KIND_NAMES = Object.freeze({ ...KIND_NAMES, warroom: "War Room" });
/** The channels that approve automatically by default: the agent's phase 1, Threads, with the four kinds the owner chose. */
export const AUTO_DEFAULTS = Object.freeze({ threads: AUTO_KINDS });
export const DAYS = Object.freeze(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
export const TIMEZONE = "Asia/Jakarta";
const MEDIA_FORMAT = { none: "text", image: "image", video: "video" };
/**
 * What each channel's publisher can post today: its own media first (the default), then what a person may choose
 * instead (owner 2026-11-17: Telegram with the card image, "user/owner/admin yang menentukan" the format).
 */
const EXTRA_FORMATS = { telegram: ["image"], threads: ["image"], x: ["image"] };
export const FORMATS = Object.freeze(Object.fromEntries(CHANNELS.map((c) => [c, Object.freeze([MEDIA_FORMAT[CHANNEL_SPECS[c].media], ...(EXTRA_FORMATS[c] ?? [])])])));
/** Formats the channel's API allows but our publisher does not post yet (shown as planned, refused when saved). */
export const PLANNED_FORMATS = Object.freeze({
  threads: Object.freeze(["video"]), instagram: Object.freeze(["video"]), x: Object.freeze(["video"]),
  telegram: Object.freeze(["video"]), youtube: Object.freeze([]), tiktok: Object.freeze([])
});
// Up to 96 slots a channel (owner 2026-11-25: "slot bisa 24H sekitar 24x4 slot per hari": every 15 minutes of a day).
export const MAX_SLOTS = 96;
/** The grid's quarter hours ("00:00" to "23:45"), the studio's schedule editor (owner 2026-11-25). */
export const QUARTERS = Object.freeze(Array.from({ length: 96 }, (_, i) => `${String(Math.floor(i / 4)).padStart(2, "0")}:${String((i % 4) * 15).padStart(2, "0")}`));
// Up to 32 (owner 2026-11-25, the key maps "All of H1, 4H and D1": up to 24 maps a day on Threads, plus up to 4 confirmed
// patterns and the recap: 29); the channel's own number stays the owner's to set in Channels.
export const MAX_PER_DAY = 32;

/** The defaults: what the engine did before settings existed. */
export function defaultSettings(channel) {
  return {
    enabled: true,
    format: FORMATS[channel]?.[0] ?? "text",
    kinds: [...KINDS],
    max_per_day: 6,
    schedule: [],
    hashtags: HASHTAGS[channel] ?? "",
    auto_approve: [...(AUTO_DEFAULTS[channel] ?? [])]
  };
}

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const TAG = /^#[A-Za-z0-9_]{1,40}$/;

/** Validates a person's settings for one channel. Returns { ok, settings } or { ok: false, error }. */
export function normalizeSettings(channel, input) {
  if (!CHANNELS.includes(channel)) return { ok: false, error: "unknown channel" };
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "settings must be an object" };
  const out = defaultSettings(channel);
  if ("enabled" in input) {
    if (typeof input.enabled !== "boolean") return { ok: false, error: "enabled must be true or false" };
    out.enabled = input.enabled;
  }
  if ("format" in input) {
    if (!FORMATS[channel].includes(input.format)) {
      return { ok: false, error: PLANNED_FORMATS[channel].includes(input.format) ? `${input.format} on ${CHANNEL_SPECS[channel].name} is planned, not built yet` : `format must be ${FORMATS[channel].join(" or ")}` };
    }
    out.format = input.format;
  }
  if ("kinds" in input) {
    if (!Array.isArray(input.kinds) || input.kinds.some((k) => !KINDS.includes(k))) return { ok: false, error: `kinds must be among ${KINDS.join(", ")}` };
    out.kinds = KINDS.filter((k) => input.kinds.includes(k));
  }
  if ("max_per_day" in input) {
    const n = Number(input.max_per_day);
    if (!Number.isInteger(n) || n < 1 || n > MAX_PER_DAY) return { ok: false, error: `max_per_day must be 1 to ${MAX_PER_DAY}` };
    out.max_per_day = n;
  }
  if ("schedule" in input) {
    if (!Array.isArray(input.schedule) || input.schedule.length > MAX_SLOTS) return { ok: false, error: `schedule holds at most ${MAX_SLOTS} slots` };
    const slots = [];
    for (const s of input.schedule) {
      if (!s || typeof s !== "object" || !TIME.test(String(s.time ?? ""))) return { ok: false, error: "each slot needs a time HH:MM (WIB)" };
      if (!Array.isArray(s.days) || !s.days.length || s.days.some((d) => !DAYS.includes(d))) return { ok: false, error: "each slot needs one or more days (mon to sun)" };
      slots.push({ days: DAYS.filter((d) => s.days.includes(d)), time: s.time });
    }
    const seen = new Set();
    out.schedule = slots.filter((s) => { const k = s.days.join(",") + "@" + s.time; if (seen.has(k)) return false; seen.add(k); return true; })
      .sort((a, b) => a.time.localeCompare(b.time));
  }
  if ("auto_approve" in input) {
    if (!Array.isArray(input.auto_approve) || input.auto_approve.some((k) => !AUTO_KINDS.includes(k))) return { ok: false, error: `auto_approve: kinds among ${AUTO_KINDS.join(", ")}` };
    out.auto_approve = AUTO_KINDS.filter((k) => input.auto_approve.includes(k));
  }
  // Threads takes one topic tag instead (owner 2026-11-25): its hashtag line stays empty, whatever was stored.
  if ("hashtags" in input && channel !== "threads") {
    const tags = String(input.hashtags ?? "").trim().split(/\s+/).filter(Boolean);
    if (tags.length > 8 || tags.some((t) => !TAG.test(t))) return { ok: false, error: "hashtags: up to 8 words that start with # (letters, digits, _)" };
    // Never the internal names in public (the guardian holds a draft that has them; refused here first).
    if (tags.some((t) => /nexus|omega/i.test(t))) return { ok: false, error: "hashtags: internal names are never public" };
    out.hashtags = tags.join(" ");
  }
  return { ok: true, settings: out };
}

/** Merges stored settings over the defaults (a stored row from an older shape keeps working). */
export function effectiveSettings(stored = {}) {
  return Object.fromEntries(CHANNELS.map((c) => {
    const s = stored[c];
    const n = s ? normalizeSettings(c, s) : null;
    return [c, n?.ok ? n.settings : defaultSettings(c)];
  }));
}

/** The channels that get drafts: in CONTENT_CHANNELS and enabled in the settings. */
export function draftingChannels(channels, settings) {
  return channels.filter((c) => settings[c]?.enabled !== false);
}

/**
 * Applies the settings to fresh drafts: drops a kind the channel does not take and anything over its daily maximum
 * (`today`: drafts already made today per channel), and puts the channel's hashtag line in place of the default one.
 * `recheck(draft)` runs the guardian on a changed text; if it fails, the draft keeps its default hashtags. Pure.
 * `dropped`, when given, collects each draft left out with why ({ id, channel, reason }: "channel_off", "kind_off",
 * "max_per_day"), for the run's log (orchestrator review, 2026-11-25: a miss must be visible).
 */
export function applySettings(drafts, settings, { today = {}, recheck = null, dropped = null } = {}) {
  const count = { ...today };
  const out = [];
  for (const d of drafts) {
    const s = settings[d.channel];
    const drop = (reason) => dropped?.push({ id: d.id, channel: d.channel, reason, ...(reason === "max_per_day" ? { max: s.max_per_day } : {}) });
    if (!s || !s.enabled) { drop("channel_off"); continue; }
    if (!s.kinds.includes(d.kind)) { drop("kind_off"); continue; }
    if ((count[d.channel] ?? 0) >= s.max_per_day) { drop("max_per_day"); continue; }
    let draft = d;
    // A draft the guardian held is queued as it is (the studio shows why); only a passing draft gets the hashtags.
    const base = HASHTAGS[d.channel];
    if (d.status !== "blocked" && s.hashtags !== base && base && d.text.endsWith(base)) {
      const text = d.text.slice(0, d.text.length - base.length) + s.hashtags;
      const limit = CHANNEL_SPECS[d.channel].text_limit;
      if (text.trimEnd().length <= limit) {
        const changed = { ...d, text: text.trimEnd() };
        const guardian = recheck ? recheck(changed) : d.guardian;
        // The channel's own hashtags failed the guardian: the draft keeps the default line it passed with.
        if (!guardian || guardian.pass !== false) draft = { ...changed, guardian };
      }
    }
    // The channel's format, chosen by a person before anything is drafted, scheduled or not.
    draft = withFormat(draft, s.format, { recheck });
    count[d.channel] = (count[d.channel] ?? 0) + 1;
    out.push(draft);
  }
  return out;
}

/**
 * Pure: a draft in the format a person chose for it (the channel's setting, or the Create page's choice). Only a
 * text channel switched to a media format changes: the draft waits for its card (needs_image) or video, and its text
 * names TradingView (the chart's attribution, the guardian's rule) before the disclaimer. A held draft, a format the
 * channel cannot post, a text over the channel's limit, or a guardian refusal leave the draft as it was.
 */
export function withFormat(d, format, { recheck = null } = {}) {
  const media = format === "image" ? "needs_image" : format === "video" ? "needs_video" : null;
  if (!media || !d || d.status === "blocked" || initialStatus(d.channel) !== "pending" || !FORMATS[d.channel]?.includes(format)) return d;
  let text = d.text;
  if (!/tradingview/i.test(text)) {
    const lines = text.split("\n");
    lines.splice(Math.max(1, lines.length - 2), 0, CHART_CREDIT);
    text = lines.join("\n");
  }
  if (text.length > CHANNEL_SPECS[d.channel].text_limit) return d;
  const changed = { ...d, text, status: media };
  const guardian = recheck ? recheck(changed) : d.guardian;
  if (guardian && guardian.pass === false) return d;
  return { ...changed, guardian, format };
}

/** "mon 13:09 WIB" → the same slot in UTC ("mon 06:09"), for the scheduler. */
export function slotUtc(day, time) {
  const [h, m] = time.split(":").map(Number);
  let mins = h * 60 + m - 7 * 60;
  let di = DAYS.indexOf(day);
  if (mins < 0) { mins += 1440; di = (di + 6) % 7; }
  return { day: DAYS[di], time: `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}` };
}

/** The start of the current day in WIB (00:00 Asia/Jakarta, UTC+7, no daylight saving), as an ISO time: the daily maximum's day. */
export function wibDayStart(now = Date.now()) {
  const offset = 7 * 3_600_000;
  return new Date(Math.floor((now + offset) / 86_400_000) * 86_400_000 - offset).toISOString();
}

/** A text with the channel's hashtag line in place of the default one (unchanged if it does not end with it). */
export function swapHashtags(text, channel, hashtags) {
  const base = HASHTAGS[channel];
  if (!text || !base || !hashtags || hashtags === base || !text.endsWith(base)) return text;
  const out = (text.slice(0, text.length - base.length) + hashtags).trimEnd();
  return out.length <= CHANNEL_SPECS[channel].text_limit ? out : text;
}
