// The card's screenshot (Browser Run; owner 2026-11-14: the chart image is a TradingView screenshot). The browser
// is given the card page (src/card.mjs) and waits for TradingView's own widget to draw its chart, then for the
// panel to fit; a card whose chart did not load, or whose text does not fit, is never stored. `launch` returns a
// Puppeteer-style browser (the Worker passes `@cloudflare/puppeteer` over the BROWSER binding; the tests a fake).
import { videoHtml, videoScript, VIDEO_WIDTH, VIDEO_HEIGHT, VIDEO_SECONDS } from "./video.mjs";
import { setWebmDuration, webmDuration } from "./webm.mjs";
import { cardHtml, chartOf, CARD_WIDTH, CARD_HEIGHT, CARD_BARS, overlayPrices, overlayTimes, measureInChart, geometryProblem, overlaySvg } from "./card.mjs";

/** Instagram takes a JPEG up to 8 MB; a card under 20 KB is a blank page, not a chart. */
export const MIN_CARD_BYTES = 20_000;
export const MAX_CARD_BYTES = 8_000_000;

/** Renders one draft's card to JPEG bytes. Throws with a short reason when the card is not right. */
export async function renderCard(draft, brand, { launch, disclaimers = [], timeoutMs = 30_000, settleMs = 2_500, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  if (typeof launch !== "function") throw new Error("no browser");
  const html = cardHtml(draft, brand, { disclaimers, footerDisclaimer: brand.card_disclaimer });
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: CARD_WIDTH, height: CARD_HEIGHT, deviceScaleFactor: 1 });
    // "load", not "networkidle0": TradingView's widget keeps its data connections open, so the network is often never
    // idle for half a second and the card failed with "Navigation timeout of 30000 ms exceeded" (2026-11-16 to 11-19,
    // Threads, Instagram and YouTube drafts). What the card needs is waited for below: the chart's frame, then its canvas.
    // One deadline for the page and the chart's frame (orchestrator review): a bad render fails within timeoutMs, as before.
    const started = Date.now();
    await page.setContent(html, { waitUntil: "load", timeout: timeoutMs });
    const frame = await chartFrame(page, { timeoutMs: Math.max(1_000, timeoutMs - (Date.now() - started)), sleep });
    if (!frame) throw new Error("the TradingView chart did not load");
    await frame.waitForSelector("canvas", { timeout: timeoutMs });
    await sleep(settleMs);
    // The overlay: the chart's own price mapping (read in TradingView's frame), then our SVG layer over it.
    const prices = overlayPrices(draft?.overlay);
    if (prices.length) {
      const confirmed = draft.overlay.pattern?.status === "confirmed" && draft.overlay.pattern.projection != null;
      const geo = await frame.evaluate(measureInChart, { prices, futureShare: confirmed ? 0.3 : draft.overlay.pattern ? 0.22 : 0.08, bars: CARD_BARS[chartOf(draft)] ?? 70, times: overlayTimes(draft.overlay) });
      const problem = geometryProblem(geo, prices);
      if (problem) throw new Error(`the overlay cannot be placed (${problem})`);
      const offset = await page.evaluate(() => {
        const f = document.querySelector("#chart iframe")?.getBoundingClientRect(), c = document.getElementById("chart").getBoundingClientRect();
        return f ? { x: f.x - c.x, y: f.y - c.y } : null;
      });
      if (!offset) throw new Error("the overlay cannot be placed (no chart frame)");
      await page.evaluate((svg) => { document.getElementById("overlay").innerHTML = svg; }, overlaySvg(draft.overlay, geo, { frame: offset }));
      await sleep(Math.min(settleMs, 800)); // TradingView repaints the widened view
    }
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

/** The TradingView widget's frame, which its embed script adds after the page loads; polled every 250 ms up to the timeout. */
export async function chartFrame(page, { timeoutMs = 30_000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), everyMs = 250 } = {}) {
  for (let i = 0, n = Math.max(1, Math.ceil(timeoutMs / everyMs)); i <= n; i++) {
    const frame = page.frames().find((f) => /tradingview/i.test(f.url()));
    if (frame) return frame;
    if (i < n) await sleep(everyMs);
  }
  return null;
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
  const cardBytes = card ?? await renderCard(draft, brand, { launch, disclaimers, timeoutMs, ...(sleep ? { sleep } : {}) });
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
