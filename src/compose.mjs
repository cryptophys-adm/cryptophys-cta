// Create (owner 2026-11-16: "belum ada menu ... content creation"; person-written posts allowed: "Boleh, tetap
// guardian"). A person writes a post for one or more channels, from a blank post or from a template filled with the
// current analysis (the same fixed templates the engine uses; no model writes public text). Each channel's text is
// checked by the guardian the way the engine's drafts are (price levels only in the analysis kinds; TradingView's
// credit where the post is the chart card or its video) and must fit the channel. A post is saved only when every
// channel passes; it then waits in the queue for approval like any draft. Pure, except for the data `context` holds.
import { checkContentDraft } from "./guardian.mjs";
import { CHANNELS, CHANNEL_SPECS, TEXT_LIMITS } from "./channels.mjs";
import { KINDS } from "./settings.mjs";
import { swapHashtags } from "./settings.mjs";
import { CHART_CREDIT, SHORT_DISCLAIMER, dailyRecapText, summarizeDay, recapSpan } from "./drafts.mjs";
import { ANALYSIS_DISCLAIMER, keyLevelsText, patternText, postablePatterns, patternKey, overlayOf, hasImage } from "./analysis-drafts.mjs";
import { LEVEL_KINDS } from "./desk.mjs";
import { initialStatus } from "./channels.mjs";
import { WARROOM_SOURCES, WARROOM_CHART, sourceOf, warroomText } from "./warroom-drafts.mjs";

export const COMPOSE_KINDS = Object.freeze(["custom", ...KINDS, "warroom"]);
export const COMPOSE_KIND_NAMES = Object.freeze({ custom: "Custom post", key_levels: "Key-level map", pattern: "Chart pattern", daily_recap: "Daily recap", warroom: "War Room" });
export const MAX_COMPOSE_CHANNELS = CHANNELS.length;

/** The blank post: a title line, room to write, TradingView's credit where the post is the chart card, the disclaimer, the hashtags. */
export function customTemplate(channel, hashtags) {
  return ["Education · XAUUSD", "", "", "", ...(hasImage(channel) ? [CHART_CREDIT] : []), channel === "x" ? SHORT_DISCLAIMER : ANALYSIS_DISCLAIMER, ...[hashtags].filter(Boolean)].join("\n");
}

/** The recap window the engine uses (the 24 hours that end the projection's delay before now; drafts.mjs recapSpan) and its summary. */
export function recapWindow(recaps, now, delayHours = 24) {
  const { from, to } = recapSpan(now, delayHours);
  return { from, to, summary: summarizeDay(recaps ?? [], { from, to }) };
}

/**
 * Pure: a template's text per channel. `analysis` (key levels, patterns) and `recaps` come from the projection.
 * Returns { kind, ref, options, texts: { channel: text | null }, note }.
 */
export function templateTexts(kind, { channels, settings, analysis = null, recaps = null, recapDelayHours = 24, warroom = null, ref = null, now = Date.now() }) {
  const tags = (c) => settings?.[c]?.hashtags;
  const out = { kind, ref: null, options: [], texts: {}, note: null };
  if (kind === "custom") { for (const c of channels) out.texts[c] = customTemplate(c, tags(c)); return out; }
  if (kind === "key_levels") {
    for (const c of channels) out.texts[c] = keyLevelsText(analysis, { channel: c });
    if (!(analysis?.zones ?? []).length) out.note = "No key zone in the analysis right now.";
  } else if (kind === "pattern") {
    const list = postablePatterns(analysis);
    out.options = list.map((p) => ({ ref: patternKey(p), label: `${p.chart} · ${p.name} · ${p.status}` }));
    const p = list.find((x) => patternKey(x) === ref) ?? list[0] ?? null;
    out.ref = p ? patternKey(p) : null;
    for (const c of channels) out.texts[c] = p ? patternText(p, analysis, { channel: c }) : null;
    if (!p) out.note = "No pattern to post right now (confirmed on M15, H1, H4, D1; forming on H4, D1).";
  } else if (kind === "warroom") {
    // Owner 2026-11-18 ("Real-time analysis"): the source's latest reading, never its decision.
    out.options = WARROOM_SOURCES.map((s) => ({ ...s }));
    out.ref = sourceOf(ref);
    for (const c of channels) out.texts[c] = warroomText(warroom, { channel: c });
    if (!warroom || warroom.error) out.note = `No reading from this source right now${warroom?.error ? ` (${warroom.error})` : ""}.`;
    else if (warroom.at) out.at = warroom.at;
  } else if (kind === "daily_recap") {
    const w = recapWindow(recaps, now, recapDelayHours);
    for (const c of channels) out.texts[c] = dailyRecapText(w.summary, { channel: c, dayIso: w.to });
    if (!w.summary?.bars) out.note = `No recap: the projection has no decisions in the recap window (${Number(recapDelayHours) > 0 ? `${Number(recapDelayHours) + 24} to ${Number(recapDelayHours)} hours ago` : "the last 24 hours"}).`;
  } else return { ...out, error: "unknown kind" };
  for (const c of channels) if (out.texts[c]) out.texts[c] = swapHashtags(out.texts[c], c, tags(c));
  if (analysis?.at && kind !== "daily_recap" && kind !== "warroom") out.at = analysis.at;
  return out;
}

/** The template's own lines (title, credit, disclaimers, hashtags): a custom post needs words of its own besides them. */
const BOILERPLATE = new Set(["Education · XAUUSD", CHART_CREDIT, SHORT_DISCLAIMER, ANALYSIS_DISCLAIMER]);
export const MIN_BODY = 20;
export function bodyLength(text) {
  return String(text ?? "").split("\n").map((l) => l.trim()).filter((l) => l && !BOILERPLATE.has(l) && !/^(#\w+\s*)+$/.test(l)).join(" ").length;
}

/** The guardian's check of one channel's text, as the queue will check it again. Never throws. */
export function checkPost({ channel, kind, text, decisionTimes = [], delayHours = 24, now = Date.now() }) {
  const limit = TEXT_LIMITS[channel] ?? 500;
  const t = typeof text === "string" ? text.replace(/\r\n/g, "\n") : "";
  const guardian = checkContentDraft({ text: t, chart: hasImage(channel), decisionTimes, delayHours, allowLevels: LEVEL_KINDS.includes(kind), now });
  const failures = [...guardian.failures];
  if (!CHANNELS.includes(channel)) failures.unshift({ check: "channel", detail: "unknown channel" });
  if (t.length > limit) failures.unshift({ check: "length", detail: `${t.length}/${limit} characters` });
  if (kind === "custom" && bodyLength(t) < MIN_BODY) failures.unshift({ check: "body", detail: `write the post (at least ${MIN_BODY} characters besides the template lines)` });
  if (!COMPOSE_KINDS.includes(kind)) failures.unshift({ check: "kind", detail: "unknown kind" });
  return { channel, text: t, length: t.length, limit, guardian: { ...guardian, pass: failures.length === 0, failures } };
}

/**
 * Pure: the drafts of one composed post, or the per-channel failures. `posts` [{ channel, text }]; `allowed` the
 * channels this Worker serves; `overlay(channel)` the card's numbers for a template post; `id` a fresh random id.
 */
export function composeDrafts({ kind, posts, allowed = CHANNELS, decisionTimes = [], delayHours = 24, overlay = () => null, now = Date.now(), id }) {
  if (!COMPOSE_KINDS.includes(kind)) return { ok: false, error: `kind must be one of ${COMPOSE_KINDS.join(", ")}` };
  if (!Array.isArray(posts) || !posts.length) return { ok: false, error: "choose at least one channel" };
  if (posts.length > MAX_COMPOSE_CHANNELS) return { ok: false, error: "too many channels" };
  const seen = new Set();
  for (const p of posts) {
    if (!p || typeof p !== "object" || !CHANNELS.includes(p.channel)) return { ok: false, error: "unknown channel" };
    if (!allowed.includes(p.channel)) return { ok: false, error: `${CHANNEL_SPECS[p.channel].name} is not enabled in this Worker` };
    if (seen.has(p.channel)) return { ok: false, error: "a channel appears twice" };
    seen.add(p.channel);
  }
  // A/B captions (src/growth.mjs): a second text for a channel is variant B, checked the same way.
  const results = {};
  for (const p of posts) {
    results[p.channel] = checkPost({ channel: p.channel, kind, text: p.text, decisionTimes, delayHours, now });
    if (typeof p.text_b === "string" && p.text_b.trim()) {
      const b = checkPost({ channel: p.channel, kind, text: p.text_b, decisionTimes, delayHours, now });
      results[`${p.channel}:b`] = b;
      if (b.text === results[p.channel].text) results[`${p.channel}:b`] = { ...b, guardian: { ...b.guardian, pass: false, failures: [{ check: "variant", detail: "variant B is the same as A" }, ...b.guardian.failures] } };
    }
  }
  if (Object.values(results).some((r) => !r.guardian.pass)) {
    return { ok: false, error: "the guardian refused one or more channels; nothing was saved", results: Object.fromEntries(Object.entries(results).map(([c, r]) => [c, { length: r.length, limit: r.limit, guardian: r.guardian }])) };
  }
  const day = new Date(now).toISOString().slice(0, 10);
  const drafts = [], ab = [];
  const draftOf = (channel, r, suffix) => ({ id: `manual:${day}:${id}${suffix}:${channel}`, kind, channel, text: r.text, image_url: null, window: null, decision_times: decisionTimes,
    guardian: r.guardian, overlay: overlay(channel), status: initialStatus(channel) });
  for (const p of posts) {
    const a = draftOf(p.channel, results[p.channel], "");
    drafts.push(a);
    const rb = results[`${p.channel}:b`];
    if (rb) { const b = draftOf(p.channel, rb, "-b"); drafts.push(b); ab.push({ grp: `ab:${day}:${id}:${p.channel}`, a: a.id, b: b.id, channel: p.channel }); }
  }
  return { ok: true, drafts, ab };
}

/** The card's numbers for a template post (the same as the engine's), or null for a custom post. */
export function overlayFor(kind, analysis, ref) {
  // War Room: no levels on the chart, only its timeframe (the card's chart).
  if (kind === "warroom") return { chart: WARROOM_CHART[sourceOf(ref)] };
  if (kind === "key_levels" && analysis) return overlayOf(analysis, { maxZones: 3 });
  if (kind === "pattern" && analysis) {
    const p = postablePatterns(analysis).find((x) => patternKey(x) === ref);
    return p ? overlayOf(analysis, { pattern: p }) : null;
  }
  return null;
}

/**
 * The guardian's check of an edited or copied draft, as for a composed post: its kind's rules, the decisions it covers
 * (the recap's delay rule, counted from now), TradingView's credit where its post is the chart card or video, its
 * channel's limit. A custom post still needs its own words. Runs inside the desk (functions do not cross RPC).
 */
export function editCheck(draft, { delayHours = 24, now = Date.now() } = {}) {
  return checkPost({ channel: draft.channel, kind: COMPOSE_KINDS.includes(draft.kind) ? draft.kind : "custom", text: draft.text, decisionTimes: draft.decision_times ?? [], delayHours, now });
}
