// The CTA agent's rules per channel (owner 2026-11-25: "Agent jangan dedicated ke thread, harus untuk semua channel
// jadi menghandle semua channel, hanya fase 1 ini thread dulu nanti dikembangkan berikutnya"). One agent for every
// channel of src/channels.mjs; AGENT_CHANNELS says which ones it manages now. A channel joins in its own owner PR.
//
// Each channel's rules, from its own platform (the linter of src/agent/lint.mjs reads them):
//   limit        the text limit (CHANNEL_SPECS.text_limit); Threads counts an emoji by its UTF-8 bytes (Meta);
//   tags         "topic_tag": one tag through the API, none in the text (Threads, owner 2026-11-25: XAUUSD);
//                "in_text": hashtags in the text, `max` the platform's cap (Instagram 5 since 18 Dec 2025;
//                YouTube ignores every hashtag past 60), or null for no published cap;
//   links        the most links a post may hold (Threads 5), or null; `dead_links`: the platform shows links as text
//                (Instagram captions), so any link is a warning;
//   window       the characters a feed shows before "more", where the platform documents it (Instagram's 125), or null.
import { CHANNEL_SPECS, CHANNELS } from "../channels.mjs";

/** The channels the agent manages now: phase 1 is Threads (owner 2026-11-25). */
export const AGENT_CHANNELS = Object.freeze(["threads"]);
/** The topic tag of the channels that take one through the API. */
export const TOPIC_TAGS = Object.freeze({ threads: "XAUUSD" });

const RULES = {
  threads: { emoji_bytes: true, tags: { mode: "topic_tag" }, links: 5, dead_links: false, window: null },
  instagram: { emoji_bytes: false, tags: { mode: "in_text", max: 5 }, links: null, dead_links: true, window: 125 },
  x: { emoji_bytes: false, tags: { mode: "in_text", max: null }, links: null, dead_links: false, window: null },
  telegram: { emoji_bytes: false, tags: { mode: "in_text", max: null }, links: null, dead_links: false, window: null },
  youtube: { emoji_bytes: false, tags: { mode: "in_text", max: 60 }, links: null, dead_links: false, window: null },
  tiktok: { emoji_bytes: false, tags: { mode: "in_text", max: null }, links: null, dead_links: false, window: null }
};

/** One channel's rules (its name and limit from src/channels.mjs), or null for a channel the CTA does not know. */
export function rulesOf(channel) {
  const spec = CHANNEL_SPECS[channel], r = RULES[channel];
  if (!spec || !r) return null;
  return { channel, name: spec.name, limit: spec.text_limit, ...r, topic_tag: TOPIC_TAGS[channel] ?? null };
}
/** Every channel, with whether the agent manages it now. */
export const agentChannels = () => CHANNELS.map((c) => ({ id: c, name: CHANNEL_SPECS[c].name, active: AGENT_CHANNELS.includes(c) }));
