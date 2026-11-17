// The channels of the CTA engine (owner 2026-11-15: Threads, Instagram, X, Telegram channel, YouTube and TikTok).
// One place says what each channel takes: its text limit, the media it needs, and whether its publisher is
// built. A draft for a channel that needs media it does not have yet waits ("needs_image", "needs_video");
// a channel whose publisher is not built yet can be drafted and approved, never published.
export const CHANNEL_SPECS = Object.freeze({
  threads: Object.freeze({ name: "Threads", text_limit: 500, media: "none", publisher: "built", note: "Meta Threads API, two steps (container, publish); TEXT, or IMAGE from the card's public URL when the format is Image." }),
  instagram: Object.freeze({ name: "Instagram", text_limit: 2200, media: "image", publisher: "built", note: "Instagram Graph API, image post; needs a public JPEG URL." }),
  x: Object.freeze({ name: "X", text_limit: 280, media: "none", publisher: "built", note: "X API v2 POST /2/tweets with a user token, the card first through POST /2/media/upload when the format is Image (scope media.write); billed per post." }),
  telegram: Object.freeze({ name: "Telegram channel", text_limit: 4096, media: "none", publisher: "built", note: "Bot API sendMessage, or sendPhoto with the card when the channel's format is Image; the bot must be able to post." }),
  youtube: Object.freeze({ name: "YouTube Shorts", text_limit: 5000, media: "video", publisher: "built", note: "YouTube Data API resumable upload of the 9:16 card video (WebM); private until the API project is verified by Google." }),
  tiktok: Object.freeze({ name: "TikTok", text_limit: 2200, media: "video", publisher: "built", note: "TikTok Content Posting API, Direct Post with FILE_UPLOAD (one chunk); private (SELF_ONLY) until the app passes TikTok's audit." })
});
export const CHANNELS = Object.freeze(Object.keys(CHANNEL_SPECS));
export const TEXT_LIMITS = Object.freeze(Object.fromEntries(Object.entries(CHANNEL_SPECS).map(([k, v]) => [k, v.text_limit])));
export const HASHTAGS = Object.freeze({
  threads: "#XAUUSD #gold #education",
  instagram: "#XAUUSD #gold #goldprice #technicalanalysis #education",
  x: "#XAUUSD #gold",
  telegram: "#XAUUSD #gold",
  youtube: "#XAUUSD #gold #shorts #education",
  tiktok: "#XAUUSD #gold #education #trading"
});

/**
 * The status an edited or copied draft goes back to: the media it was made with (a Telegram post set to Image keeps
 * waiting for its card), else what the channel needs.
 */
export function mediaStatusOf(d) {
  const url = String(d?.image_url ?? "");
  if (d?.status === "needs_video" || /\.webm$/.test(url)) return "needs_video";
  if (d?.status === "needs_image" || /\.jpg$/.test(url)) return "needs_image";
  return initialStatus(d?.channel);
}

/** The status a new draft starts in, once the guardian passed: what the channel still needs. */
export function initialStatus(channel) {
  const media = CHANNEL_SPECS[channel]?.media;
  return media === "image" ? "needs_image" : media === "video" ? "needs_video" : "pending";
}
