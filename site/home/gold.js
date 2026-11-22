// The live gold quote (owner 2026-11-20: "Widget only, core without a price"). TradingView licenses its market data for
// display only and allows public display through its own widgets with their attribution, so the page shows the price
// only through TradingView's Single Quote widget, in TradingView's own frame (the CSP's one frame-src), on the scene's
// core (owner 2026-11-20: "widget hanya ditempatkan dalam core") and never in the header. The page runs no TradingView script. Pure.

/** The only element on the public page that may carry a gold price: TradingView's quote (test/gold.test.mjs). */
export const GOLD_PRICE_IDS = Object.freeze(['gold-live']);
export const TV_FRAME_HOST = 'https://www.tradingview-widget.com';
export const TV_QUOTE_SETTINGS = Object.freeze({ symbol: 'OANDA:XAUUSD', width: '100%', colorTheme: 'dark', isTransparent: true, height: 60 });
/**
 * Pure: the URL TradingView's Single Quote embed (s3.tradingview.com/external-embedding/embed-widget-single-quote.js)
 * gives its iframe: the widget host, /embed-widget/single-quote/, the locale as a query and the settings as the hash.
 */
export function tvQuoteSrc(pageUri = 'cta.cryptophys.work/') {
  return `${TV_FRAME_HOST}/embed-widget/single-quote/?locale=en#${encodeURIComponent(JSON.stringify({ ...TV_QUOTE_SETTINGS, 'page-uri': pageUri }))}`;
}

/**
 * Pure: where the quote strip sits on a wide screen (owner 2026-11-22, "CTA home: more air"): `gap` px above the
 * headline, never above `min` (the scene's top edge), in px from the hero's top. `titleTop` is the headline's top and
 * `height` the strip's, both in the hero's px.
 */
export function quoteTop({ titleTop, height, gap = 28, min = 16 }) {
  if (!Number.isFinite(titleTop) || !Number.isFinite(height)) return null;
  return Math.max(min, Math.round(titleTop - height - gap));
}
