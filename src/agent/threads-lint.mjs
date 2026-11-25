// The Threads linter of the CTA agent's Checks skill (owner 2026-11-25: "setuju semua, mulai dari Checks"). The rules
// of instagram-agent-skill's skills/ig-caption/caption.py (MIT, Copyright (c) 2026 Jake Schincariol:
// src/agent/LICENSE-instagram-agent-skill), retuned to Threads' own limits (Meta's Threads API documentation):
//   - 500 characters a post, an emoji counting by its UTF-8 bytes;
//   - one topic tag a post, set through the API (`topic_tag`); an in-text hashtag is "not preferred" and only the
//     first one counts, so the CTA's Threads posts carry none (owner 2026-11-25, the topic tag XAUUSD);
//   - at most 5 links a post.
// Pure: the studio's Agent page shows the result for each Threads draft. A FAIL is a draft Threads would refuse or that
// breaks a rule above; the publisher still refuses only what Threads refuses (the length), as before.
import { cleanInvisible } from "./humanizer.mjs";

export const THREADS_LIMIT = 500;
export const THREADS_LINKS = 5;
/** The CTA's Threads topic tag (owner 2026-11-25: "setuju semua", the Agent mockup: one topic tag, XAUUSD). */
export const THREADS_TOPIC_TAG = "XAUUSD";

const HASHTAG = /(?:^|\s)(#[A-Za-z0-9_]+)/g;
const MENTION = /(?:^|\s)(@[A-Za-z0-9_.]+)/g;
const LINK = /https?:\/\/\S+|\bwww\.\S+|\b[a-z0-9-]+\.(?:com|co|io|net|org|ai|app|work)\/\S*/gi;
const EMOJI = /\p{Extended_Pictographic}/gu;
const all = (s, re) => [...String(s).matchAll(re)].map((m) => m[1] ?? m[0]);
const utf8 = (s) => new TextEncoder().encode(s).length;

/** Threads' count of a post: each character once, an emoji by its UTF-8 bytes (Meta: "emojis count by UTF-8 bytes"). */
export function threadsLength(text) {
  let n = 0;
  for (const ch of String(text ?? "")) n += /\p{Extended_Pictographic}/u.test(ch) ? utf8(ch) : 1;
  return n;
}

/** A topic tag Threads accepts: 1 to 50 characters, no period and no ampersand. */
export const validTopicTag = (t) => typeof t === "string" && t.length >= 1 && t.length <= 50 && !/[.&]/.test(t);

/**
 * The checks of one Threads post: { characters, limit, checks: [{ check, status: PASS|WARN|FAIL, detail }], verdict:
 * READY|REVIEW|FIX }. `topicTag`: the tag the post goes out with.
 */
export function lintThreads(text, { topicTag = THREADS_TOPIC_TAG } = {}) {
  const raw = String(text ?? "");
  const body = raw.trim();
  const chars = threadsLength(body);
  const first = body.split("\n")[0].trim();
  const tags = all(body, HASHTAG), mentions = all(body, MENTION), links = all(body, LINK), emoji = all(body, EMOJI);
  const { removed } = cleanInvisible(raw);
  const checks = [];
  const add = (check, status, detail) => checks.push({ check, status, detail });

  add("LENGTH", chars > THREADS_LIMIT ? "FAIL" : "PASS", `${chars} / ${THREADS_LIMIT} characters${chars > THREADS_LIMIT ? `, ${chars - THREADS_LIMIT} over: Threads refuses it` : ""}`);
  if (!first) add("FIRST LINE", "FAIL", "the post opens on a blank line");
  else if (/^[#@]/.test(first)) add("FIRST LINE", "FAIL", "opens on a hashtag or a mention, the one position worth a sentence");
  else add("FIRST LINE", "PASS", `${first.length} characters`);
  if (!validTopicTag(topicTag)) add("TOPIC TAG", "FAIL", "no valid topic tag (1 to 50 characters, no period or ampersand)");
  else if (tags.length) add("TOPIC TAG", "WARN", `${tags.length} in-text hashtag(s) (${tags.slice(0, 3).join(" ")}); Threads uses only the first, and the topic tag ${topicTag} is set already`);
  else add("TOPIC TAG", "PASS", `topic tag ${topicTag}, no in-text hashtag`);
  add("LINKS", links.length > THREADS_LINKS ? "FAIL" : "PASS", `${links.length} link(s)${links.length > THREADS_LINKS ? `, over Threads' ${THREADS_LINKS}` : ""}`);
  add("MENTIONS", mentions.length ? "WARN" : "PASS", mentions.length ? `${mentions.length} mention(s): a post from the analysis names no account` : "none");
  const density = (emoji.length * 100) / Math.max(chars, 1);
  add("EMOJI", density > 4 ? "WARN" : "PASS", `${emoji.length} emoji, ${density.toFixed(1)} per 100 characters${density > 4 ? ": reads as decoration" : ""}`);
  add("INVISIBLE", removed ? "WARN" : "PASS", removed ? `${removed} invisible character(s): removed when it is published` : "none");
  add("EM DASH", /—/.test(body) ? "WARN" : "PASS", /—/.test(body) ? "an em dash, the commonest machine tell" : "none");

  const fails = checks.filter((c) => c.status === "FAIL").length, warns = checks.filter((c) => c.status === "WARN").length;
  return { characters: chars, limit: THREADS_LIMIT, topic_tag: topicTag, checks, verdict: fails ? "FIX" : warns ? "REVIEW" : "READY" };
}

/**
 * What a draft's text becomes on Threads: without a closing hashtag-only line (drafts made before the topic tag
 * carried "#XAUUSD #gold #education" there) and without invisible characters. The words are unchanged.
 */
export function threadsText(text) {
  const lines = String(text ?? "").replace(/\s+$/, "").split("\n");
  if (lines.length > 1 && /^\s*(#[A-Za-z0-9_]+\s*)+$/.test(lines.at(-1))) lines.pop();
  return cleanInvisible(lines.join("\n").replace(/\s+$/, "")).text;
}
