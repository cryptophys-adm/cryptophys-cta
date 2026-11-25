// The CTA agent's linter, one for every channel (owner 2026-11-25: "Agent ... harus untuk semua channel ... hanya fase 1
// ini thread dulu"). The rules of instagram-agent-skill's skills/ig-caption/caption.py (MIT, Copyright (c) 2026 Jake
// Schincariol: src/agent/LICENSE-instagram-agent-skill), read against each channel's own limits (src/agent/rules.mjs).
// Pure: the studio's Agent page shows the result for each draft of a channel the agent manages. A FAIL is a post the
// platform would refuse or that breaks a rule; the publishers still refuse only what the platform refuses, as before.
import { cleanInvisible } from "./humanizer.mjs";
import { rulesOf, TOPIC_TAGS, SEARCH_TERMS } from "./rules.mjs";

/** Threads' limit and topic tag, as the publisher uses them. */
export const THREADS_LIMIT = 500;
export const THREADS_TOPIC_TAG = TOPIC_TAGS.threads;

const HASHTAG = /(?:^|\s)(#[A-Za-z0-9_]+)/g;
const MENTION = /(?:^|\s)(@[A-Za-z0-9_.]+)/g;
const LINK = /https?:\/\/\S+|\bwww\.\S+|\b[a-z0-9-]+\.(?:com|co|io|net|org|ai|app|work)\/\S*/gi;
const EMOJI = /\p{Extended_Pictographic}/gu;
// caption.py's HOOK IS CONCRETE and ONE ASK, as written there.
const CONCRETE = /\$\s?\d|\b\d[\d,.]*\b|(?<!^)\b[A-Z][a-z]{2,}\b/m;
const CONCRETE_ALL = /\$\s?\d|\b\d[\d,.]*\b|(?<!^)\b[A-Z][a-z]{2,}\b/gm;
export const ASKS = Object.freeze([
  [/\bcomment (?:the word |")?[A-Z0-9]{2,}\b/i, "comment a keyword"],
  [/\b(?:dm|message) me\b/i, "DM me"],
  [/\bsave (?:this|it)\b/i, "save this"],
  [/\bshare (?:this|it)\b/i, "share this"],
  [/\bfollow (?:me|for)\b/i, "follow"],
  [/\blink in (?:my )?bio\b/i, "link in bio"],
  [/\b(?:swipe|tap) (?:through|left|right|for|to)\b/i, "swipe or tap"],
  [/\btell me\b|\bwhat would you\b|\bwhich one\b/i, "answer a question"]
]);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const all = (s, re) => [...String(s).matchAll(re)].map((m) => m[1] ?? m[0]);
const utf8 = (s) => new TextEncoder().encode(s).length;

/** A post's length as a channel counts it: each character once, or (Threads) an emoji by its UTF-8 bytes. */
export function postLength(text, { emojiBytes = false } = {}) {
  if (!emojiBytes) return [...String(text ?? "")].length;
  let n = 0;
  for (const ch of String(text ?? "")) n += /\p{Extended_Pictographic}/u.test(ch) ? utf8(ch) : 1;
  return n;
}
export const threadsLength = (text) => postLength(text, { emojiBytes: true });

/** A topic tag Threads accepts: 1 to 50 characters, no period and no ampersand. */
export const validTopicTag = (t) => typeof t === "string" && t.length >= 1 && t.length <= 50 && !/[.&]/.test(t);

/**
 * The checks of one post on one channel: { channel, characters, limit, checks: [{ check, status: PASS|WARN|FAIL, detail }],
 * verdict: READY|REVIEW|FIX }. `topicTag` overrides the channel's own (Threads).
 */
export function lintPost(channel, text, { topicTag, keywords = SEARCH_TERMS } = {}) {
  const r = rulesOf(channel);
  if (!r) return { channel, characters: 0, limit: 0, checks: [{ check: "CHANNEL", status: "FAIL", detail: "an unknown channel" }], verdict: "FIX" };
  const raw = String(text ?? ""), body = raw.trim();
  const chars = postLength(body, { emojiBytes: r.emoji_bytes });
  const first = body.split("\n")[0].trim();
  const tags = all(body, HASHTAG), mentions = all(body, MENTION), links = all(body, LINK), emoji = all(body, EMOJI);
  const { removed } = cleanInvisible(raw);
  const checks = [];
  const add = (check, status, detail) => checks.push({ check, status, detail });

  // The part a reader sees before tapping: the channel's documented window, else the first line.
  const window = r.window ? body.slice(0, r.window) : first;
  add("LENGTH", chars > r.limit ? "FAIL" : "PASS", `${chars} / ${r.limit} characters${chars > r.limit ? `, ${chars - r.limit} over: ${r.name} refuses it` : ""}`);
  if (!first) add("FIRST LINE", "FAIL", "the post opens on a blank line");
  else if (/^[#@]/.test(first)) add("FIRST LINE", "FAIL", "opens on a hashtag or a mention, the one position worth a sentence");
  else if (r.window && first.length > r.window) add("FIRST LINE", "WARN", `${first.length} characters: the feed cuts it at ${r.window}`);
  else add("FIRST LINE", "PASS", `${first.length} characters`);
  if (r.tags.mode === "topic_tag") {
    const tag = topicTag ?? r.topic_tag;
    if (!validTopicTag(tag)) add("TOPIC TAG", "FAIL", "no valid topic tag (1 to 50 characters, no period or ampersand)");
    else if (tags.length) add("TOPIC TAG", "WARN", `${tags.length} in-text hashtag(s) (${tags.slice(0, 3).join(" ")}); ${r.name} uses only the first, and the topic tag ${tag} is set already`);
    else add("TOPIC TAG", "PASS", `topic tag ${tag}, no in-text hashtag`);
  } else if (r.tags.max != null && tags.length > r.tags.max) add("HASHTAGS", "FAIL", `${tags.length} hashtags, over ${r.name}'s ${r.tags.max}`);
  else add("HASHTAGS", "PASS", `${tags.length} hashtag(s)${r.tags.max != null ? ` of at most ${r.tags.max}` : ""}`);
  add("HOOK IS CONCRETE", CONCRETE.test(window) ? "PASS" : "WARN", `${(window.match(CONCRETE_ALL) || []).length} number(s) or name(s) in the visible ${r.window ? "window" : "first line"}${CONCRETE.test(window) ? "" : ": nothing checkable before the tap"}`);
  if (!tags.length) add("TAG PLACEMENT", "PASS", "no tags to place");
  else if (tags.some((t) => new RegExp(`(?:^|\\s)${escapeRe(t)}\\b`).test(window))) add("TAG PLACEMENT", "WARN", "a hashtag is inside the visible window, spending feed space on a label");
  else add("TAG PLACEMENT", "PASS", "tags are below the fold");
  if (r.links != null && links.length > r.links) add("LINKS", "FAIL", `${links.length} links, over ${r.name}'s ${r.links}`);
  else if (r.dead_links && links.length) add("LINKS", "WARN", `${links.length} link(s): ${r.name} shows them as plain text`);
  else add("LINKS", "PASS", `${links.length} link(s)`);
  add("MENTIONS", mentions.length ? "WARN" : "PASS", mentions.length ? `${mentions.length} mention(s): a post from the analysis names no account` : "none");
  const asks = ASKS.filter(([re]) => re.test(body)).map(([, name]) => name);
  if (asks.length === 1) add("ONE ASK", "PASS", `one call to action: ${asks[0]}`);
  else if (!asks.length) add("ONE ASK", "WARN", "no call to action. Decide what this post is for");
  else add("ONE ASK", "WARN", `${asks.length} asks (${asks.join(", ")}). Two asks is the same as none`);
  const density = (emoji.length * 100) / Math.max(chars, 1);
  add("EMOJI", density > 4 ? "WARN" : "PASS", `${emoji.length} emoji, ${density.toFixed(1)} per 100 characters${density > 4 ? ": reads as decoration" : ""}`);
  add("INVISIBLE", removed ? "WARN" : "PASS", removed ? `${removed} invisible character(s)${channel === "threads" ? ": removed when it is published" : ""}` : "none");
  const terms = (keywords || []).map((k) => String(k).trim()).filter(Boolean);
  if (terms.length) {
    const low = body.toLowerCase(), win = window.toLowerCase();
    const found = terms.filter((k) => low.includes(k.toLowerCase())), missing = terms.filter((k) => !low.includes(k.toLowerCase()));
    const inWindow = found.filter((k) => win.includes(k.toLowerCase()));
    add("SEARCH TERMS", !missing.length ? "PASS" : found.length ? "WARN" : "FAIL", `${found.length}/${terms.length} present${found.length ? `, ${inWindow.length} in the visible window` : ""}${missing.length ? `. Missing: ${missing.join(", ")}` : ""}`);
  }
  add("EM DASH", /—/.test(body) ? "WARN" : "PASS", /—/.test(body) ? "an em dash, the commonest machine tell" : "none");

  const fails = checks.filter((c) => c.status === "FAIL").length, warns = checks.filter((c) => c.status === "WARN").length;
  return { channel, characters: chars, limit: r.limit, ...(r.tags.mode === "topic_tag" ? { topic_tag: topicTag ?? r.topic_tag } : {}), checks, verdict: fails ? "FIX" : warns ? "REVIEW" : "READY" };
}
export const lintThreads = (text, options) => lintPost("threads", text, options);

/**
 * What a draft's text becomes on Threads: without a closing hashtag-only line (drafts made before the topic tag
 * carried "#XAUUSD #gold #education" there) and without invisible characters. The words are unchanged.
 */
export function threadsText(text) {
  const lines = String(text ?? "").replace(/\s+$/, "").split("\n");
  if (lines.length > 1 && /^\s*(#[A-Za-z0-9_]+\s*)+$/.test(lines.at(-1))) lines.pop();
  return cleanInvisible(lines.join("\n").replace(/\s+$/, "")).text;
}
/** What a draft's text becomes on its channel: Threads' own form; the others as drafted. */
export const textFor = (channel, text) => (channel === "threads" ? threadsText(text) : String(text ?? ""));
