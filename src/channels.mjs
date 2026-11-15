// The channels of the CTA engine (owner 2026-11-15: Threads, Instagram, X, Telegram channel, YouTube and TikTok).
// One place says what each channel takes: its text limit, the media it needs, and whether its publisher is
// built. A draft for a channel that needs media it does not have yet waits ("needs_image", "needs_video");
// a channel whose publisher is not built yet can be drafted and approved, never published.
export const CHANNEL_SPECS = Object.freeze({
  threads: Object.freeze({ name: "Threads", text_limit: 500, media: "none", publisher: "built", note: "Meta Threads API, two steps (container, publish)." }),
  instagram: Object.freeze({ name: "Instagram", text_limit: 2200, media: "image", publisher: "built", note: "Instagram Graph API, image post; needs a public JPEG URL." }),
  x: Object.freeze({ name: "X", text_limit: 280, media: "none", publisher: "built", note: "X API v2 POST /2/tweets with a user token; billed per post." }),
  telegram: Object.freeze({ name: "Telegram channel", text_limit: 4096, media: "none", publisher: "built", note: "Bot API sendMessage to the channel; the bot must be a channel admin." }),
  youtube: Object.freeze({ name: "YouTube Shorts", text_limit: 5000, media: "video", publisher: "planned", note: "YouTube Data API upload; a short video from the chart card (later phase)." }),
  tiktok: Object.freeze({ name: "TikTok", text_limit: 2200, media: "video", publisher: "planned", note: "TikTok Content Posting API; an unaudited app posts privately only (later phase)." })
});
export const CHANNELS = Object.freeze(Object.keys(CHANNEL_SPECS));
export const TEXT_LIMITS = Object.freeze(Object.fromEntries(Object.entries(CHANNEL_SPECS).map(([k, v]) => [k, v.text_limit])));
export const HASHTAGS = Object.freeze({
  threads: "#XAUUSD #emas #edukasi",
  instagram: "#XAUUSD #emas #gold #edukasi #analisisteknikal",
  x: "#XAUUSD #gold",
  telegram: "#XAUUSD #emas",
  youtube: "#XAUUSD #emas #shorts #edukasi",
  tiktok: "#XAUUSD #emas #edukasi #trading"
});

/** The status a new draft starts in, once the guardian passed: what the channel still needs. */
export function initialStatus(channel) {
  const media = CHANNEL_SPECS[channel]?.media;
  return media === "image" ? "needs_image" : media === "video" ? "needs_video" : "pending";
}
