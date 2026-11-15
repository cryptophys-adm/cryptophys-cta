// The card's screenshot (Browser Run; owner 2026-11-14: the chart image is a TradingView screenshot). The browser
// is given the card page (src/card.mjs) and waits for TradingView's own widget to draw its chart, then for the
// panel to fit; a card whose chart did not load, or whose text does not fit, is never stored. `launch` returns a
// Puppeteer-style browser (the Worker passes `@cloudflare/puppeteer` over the BROWSER binding; the tests a fake).
import { cardHtml, CARD_WIDTH, CARD_HEIGHT } from "./card.mjs";

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
    await page.setContent(html, { waitUntil: "networkidle0", timeout: timeoutMs });
    const frame = page.frames().find((f) => /tradingview/i.test(f.url()));
    if (!frame) throw new Error("the TradingView chart did not load");
    await frame.waitForSelector("canvas", { timeout: timeoutMs });
    await sleep(settleMs);
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
