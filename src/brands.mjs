// Brands (owner 2026-11-15: "XAUUSD dulu, siap multi-brand"). A brand is a public identity with its accounts per
// channel and the analysis source its drafts come from. One brand today; another is a new entry here plus its
// source binding, reviewed in a PR.
export const BRANDS = Object.freeze({
  "xauusd-ai-cta": Object.freeze({
    id: "xauusd-ai-cta",
    name: "XAUUSD AI · Cryptophys",
    tagline: "Analisa emas (XAUUSD) dari sistem AI Cryptophys: level kunci, pola chart, dan rekap harian. Edukasi, bukan ajakan transaksi.",
    // The analysis source: the xauusd AI Worker's PublicProjection (recaps after 24 hours; real-time analysis).
    source: "xauusd",
    // Public handles (not secrets). The numeric ids and tokens are Worker secrets.
    handles: Object.freeze({ threads: "xauusd-ai-cta" }),
    capacity: "edukasi",
    disclaimer: "Konten ini adalah edukasi dan analisa dari sistem Cryptophys, bukan ajakan jual atau beli dan bukan saran investasi. Keputusan dan risiko transaksi sepenuhnya milik Anda.",
    chart_attribution: "Chart oleh TradingView"
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
