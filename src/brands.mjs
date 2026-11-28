// Brands (owner 2026-11-15: "XAUUSD dulu, siap multi-brand"). A brand is a public identity with its accounts per
// channel and the analysis source its drafts come from. One brand today; another is a new entry here plus its
// source binding, reviewed in a PR.
export const BRANDS = Object.freeze({
  "xauusd-ai-cta": Object.freeze({
    id: "xauusd-ai-cta",
    name: "XAUUSD AI · Cryptophys",
    // All public content is in English (owner 2026-11-15: "Semua content in english").
    tagline: "Gold (XAUUSD) analysis from the Cryptophys AI system: key levels, chart patterns and the daily recap. Education, not an invitation to trade.",
    // The analysis source: the xauusd AI Worker's PublicProjection (the daily recap of the last 24 hours; real-time analysis).
    source: "xauusd",
    // Public handles (not secrets). The numeric ids and tokens are Worker secrets.
    // Threads: the account the Threads token posts as (owner 2026-11-20: "@cryptophys.adm"; there is no @xauusd-ai-cta).
    handles: Object.freeze({ threads: "cryptophys.adm" }),
    capacity: "education",
    disclaimer: "This content is education and analysis from the Cryptophys system. It is not an invitation to buy or sell and not financial advice. Trading decisions and their risks are entirely your own.",
    chart_attribution: "Chart by TradingView",
    // The symbol of TradingView's own chart widget on the Instagram card (TradingView draws it from its own data).
    chart_symbol: "OANDA:XAUUSD",
    card_disclaimer: "Education and analysis. Not an invitation to buy or sell, and not financial advice."
  })
});
export const DEFAULT_BRAND = "xauusd-ai-cta";
export const brandOf = (id) => BRANDS[id] ?? BRANDS[DEFAULT_BRAND];

/** Public profile links (the CTA page). Only handles that exist are linked. */
export function profileLinks(brand) {
  const h = brand?.handles ?? {};
  const out = [];
  if (h.threads) out.push({ channel: "threads", label: "Threads", url: `https://www.threads.net/@${h.threads}` });
  if (h.instagram) out.push({ channel: "instagram", label: "Instagram", url: `https://www.instagram.com/${h.instagram}` });
  if (h.x) out.push({ channel: "x", label: "X", url: `https://x.com/${h.x}` });
  if (h.telegram) out.push({ channel: "telegram", label: "Telegram", url: `https://t.me/${h.telegram}` });
  if (h.youtube) out.push({ channel: "youtube", label: "YouTube", url: `https://www.youtube.com/@${h.youtube}` });
  if (h.tiktok) out.push({ channel: "tiktok", label: "TikTok", url: `https://www.tiktok.com/@${h.tiktok}` });
  return out;
}
