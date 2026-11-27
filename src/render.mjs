// The card's screenshot (Browser Run). The browser is given the card page (src/card.mjs): the schematic is drawn in the
// page itself from the draft's own numbers (owner 2026-11-27: "setuju kartu skematik B"; before, TradingView's chart
// widget, which took about 7 s a card to load and measure), so it waits only for the panel to fit; a card whose text
// does not fit is never stored. `launch` returns a Puppeteer-style browser (the Worker passes `@cloudflare/puppeteer`
// over the BROWSER binding; the tests a fake).
import { videoHtml, videoScript, VIDEO_WIDTH, VIDEO_HEIGHT, VIDEO_SECONDS } from "./video.mjs";
import { setWebmDuration, webmDuration } from "./webm.mjs";
import { cardHtml, CARD_WIDTH, CARD_HEIGHT } from "./card.mjs";

/** Instagram takes a JPEG up to 8 MB; a card under 20 KB is a blank page, not a card. */
export const MIN_CARD_BYTES = 20_000;
export const MAX_CARD_BYTES = 8_000_000;

/** Renders one draft's card to JPEG bytes. Throws with a short reason when the card is not right. */
export async function renderCard(draft, brand, { launch, disclaimers = [], timeoutMs = 30_000 } = {}) {
  if (typeof launch !== "function") throw new Error("no browser");
  const html = cardHtml(draft, brand, { disclaimers, footerDisclaimer: brand.card_disclaimer });
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: CARD_WIDTH, height: CARD_HEIGHT, deviceScaleFactor: 1 });
    // The page needs no network: the schematic is inline SVG and the fit runs on load.
    await page.setContent(html, { waitUntil: "load", timeout: timeoutMs });
    const fit = await page.evaluate(() => document.body.getAttribute("data-fit"));
    if (fit !== "ok") throw new Error(`the panel does not fit (${fit ?? "no fit result"})`);
    const shot = await page.screenshot({ type: "jpeg", quality: 85 });
    const bytes = shot instanceof Uint8Array ? shot : new Uint8Array(shot);
    if (bytes.length < MIN_CARD_BYTES) throw new Error(`the card is too small (${bytes.length} bytes)`);
    if (bytes.length > MAX_CARD_BYTES) throw new Error(`the card is too large (${bytes.length} bytes)`);
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error("the card is not a JPEG");
    return bytes;
  } finally {
    await browser.close().catch(() => {});
  }
}

/** Base64 of bytes (the desk keeps the card as text: one form for the Durable Object and node:sqlite). */
export function toBase64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function fromBase64(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i);
  return out;
}

// ---- The video (YouTube Shorts, TikTok): the card, then a 9:16 recording built from it (src/video.mjs) ----------
/** A video under 200 KB is an empty recording; the publishers take one chunk up to 64 MB. */
export const MIN_VIDEO_BYTES = 200_000;
export const MAX_VIDEO_BYTES = 60_000_000;

/**
 * Renders one draft's video: its card first (the same checks as an Instagram card), then the recording, with the
 * WebM's duration written. Returns { bytes, mime, card }. Throws with a short reason when either is not right.
 */
export async function renderVideo(draft, brand, { launch, disclaimers = [], timeoutMs = 30_000, seconds = VIDEO_SECONDS, sleep, card = null } = {}) {
  if (typeof launch !== "function") throw new Error("no browser");
  const cardBytes = card ?? await renderCard(draft, brand, { launch, disclaimers, timeoutMs });
  void sleep;
  const html = videoHtml(`data:image/jpeg;base64,${toBase64(cardBytes)}`, videoScript(draft, brand, { disclaimers }), { seconds });
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: VIDEO_WIDTH, height: VIDEO_HEIGHT, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: "load", timeout: timeoutMs });
    await page.waitForFunction(() => document.body.getAttribute("data-video"), { timeout: (seconds + 30) * 1000, polling: 500 });
    const out = await page.evaluate(() => ({ state: document.body.getAttribute("data-video"), data: window.__video || null }));
    if (!String(out?.state).startsWith("ok:") || !out.data) throw new Error(`the video was not recorded (${String(out?.state ?? "no state").slice(0, 60)})`);
    const raw = fromBase64(out.data);
    if (raw.length < MIN_VIDEO_BYTES) throw new Error(`the video is too small (${raw.length} bytes)`);
    if (raw.length > MAX_VIDEO_BYTES) throw new Error(`the video is too large (${raw.length} bytes)`);
    const bytes = setWebmDuration(raw, seconds * 1000);
    if (Math.round(webmDuration(bytes)) !== seconds * 1000) throw new Error("the video's duration could not be written");
    return { bytes, mime: "video/webm", card: cardBytes };
  } finally {
    await browser.close().catch(() => {});
  }
}
