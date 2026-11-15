// The Instagram card (owner 2026-11-14: the chart image is a TradingView screenshot with attribution; "fokus pada
// hasil analytics dan key level"). One 1080 x 1350 (4:5) page:
//   - the brand and what the post is (pattern, key-level map, daily recap);
//   - TradingView's own Advanced Chart widget for the draft's timeframe: TradingView draws its chart from its own
//     data; this engine never sends it a bar, a price or a drawing (never Yahoo, the account's bars or MT5 bars);
//   - the Cryptophys panel: the draft's own text, which the content guardian already checked, without its
//     hashtags; the disclaimer and "Chart oleh TradingView" in the footer.
// Pure: the HTML is built from the draft and the brand only. The screenshot is taken in src/render.mjs.
export const CARD_WIDTH = 1080;
export const CARD_HEIGHT = 1350;
/** The chart's height: shorter when the panel has more lines, so the panel's text keeps a readable size. */
export const chartHeightFor = (lines) => (lines <= 7 ? 700 : lines <= 11 ? 600 : 520);
export const CARD_VERSION = "cryptophys.cta-card.v1";

const KIND_LABEL = { pattern: "Pola chart", key_levels: "Peta level kunci", daily_recap: "Rekap harian" };
/** TradingView widget intervals. */
const INTERVAL = { M15: "15", H1: "60", H4: "240", D1: "D" };

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** The chart timeframe of a draft: a pattern's own chart; the key-level map on H4; the daily recap on H1. */
export function chartOf(draft) {
  if (draft?.kind === "pattern") {
    const m = /^pattern:(M15|H1|H4|D1):/.exec(String(draft.id ?? ""));
    if (m) return m[1];
  }
  if (draft?.kind === "key_levels") return "H4";
  return "H1";
}

/**
 * The panel's lines: the draft text without its hashtag line, its disclaimer lines and an attribution line
 * (the footer carries those), and without trailing blank lines. The first line is the title.
 */
export function panelLines(text, { disclaimers = [] } = {}) {
  const drop = new Set(disclaimers.map((d) => d.trim()).filter(Boolean));
  const lines = String(text ?? "").split("\n").map((l) => l.trimEnd())
    .filter((l) => !/^#\S/.test(l.trim()) && !drop.has(l.trim()) && !/^chart\s+oleh\s+tradingview/i.test(l.trim()));
  while (lines.length && !lines.at(-1).trim()) lines.pop();
  while (lines.length && !lines[0].trim()) lines.shift();
  return lines;
}

/** The TradingView Advanced Chart widget's settings: read-only, no toolbar, no symbol change, no drawing. */
export function widgetConfig({ symbol, chart, height = 700 }) {
  // Locale "en": the chart's price scale reads 4,098.20 like the panel's 4098.20, not 4.098,200.
  return {
    width: CARD_WIDTH, height, symbol, interval: INTERVAL[chart] ?? "60", timezone: "Etc/UTC",
    theme: "dark", style: "1", locale: "en", hide_top_toolbar: true, hide_side_toolbar: true, hide_legend: false,
    allow_symbol_change: false, save_image: false, calendar: false, hide_volume: true, withdateranges: false,
    details: false, hotlist: false, support_host: "https://www.tradingview.com"
  };
}

/** Pure: the card page for one draft. `disclaimers` are the template disclaimers the footer replaces. */
export function cardHtml(draft, brand, { disclaimers = [], footerDisclaimer } = {}) {
  const chart = chartOf(draft);
  const lines = panelLines(draft?.text, { disclaimers });
  const [title = "", ...body] = lines;
  // The panel's type size follows its length, so a long recap still fits the 4:5 card.
  const chars = body.join(" ").length;
  const size = chars > 520 ? 25 : chars > 380 ? 28 : chars > 240 ? 31 : 34;
  const chartHeight = chartHeightFor(body.length);
  const cfg = JSON.stringify(widgetConfig({ symbol: brand.chart_symbol, chart, height: chartHeight }));
  const bodyHtml = body.map((l) => (l.trim() ? `<p>${esc(l)}</p>` : `<p class="gap"></p>`)).join("");
  return `<!doctype html>
<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=${CARD_WIDTH}">
<title>${esc(title)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${CARD_WIDTH}px;height:${CARD_HEIGHT}px;overflow:hidden;background:#0b0f17;color:#e6e9ef;font-family:"Inter","Segoe UI","Helvetica Neue",Arial,sans-serif}
.card{display:flex;flex-direction:column;width:${CARD_WIDTH}px;height:${CARD_HEIGHT}px}
header{display:flex;align-items:center;justify-content:space-between;height:110px;padding:0 48px;border-bottom:1px solid #1d2533}
.brand{font-size:34px;font-weight:700;letter-spacing:.3px}.brand span{color:#d4af37}
.kind{font-size:24px;font-weight:600;color:#0b0f17;background:#d4af37;border-radius:999px;padding:10px 22px}
.chart{width:${CARD_WIDTH}px;height:${chartHeight}px;background:#131722}
.panel{flex:1;padding:30px 48px 0;overflow:hidden}
.panel h1{font-size:${size + 6}px;line-height:1.25;font-weight:700;margin-bottom:14px;color:#fff}
.panel p{font-size:${size}px;line-height:1.38;color:#cfd5df}.panel p.gap{height:${Math.round(size * 0.55)}px}
footer{height:110px;padding:14px 48px;border-top:1px solid #1d2533;font-size:20px;line-height:1.4;color:#8b93a3}
footer b{color:#d4af37;font-weight:600}
</style></head>
<body><div class="card">
<header><div class="brand">${esc(brand.name).replace("·", "<span>·</span>")}</div><div class="kind">Edukasi · ${esc(KIND_LABEL[draft?.kind] ?? "Analisa")}</div></header>
<div class="chart" id="chart"><div class="tradingview-widget-container"><div class="tradingview-widget-container__widget"></div>
<script type="text/javascript" src="https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js" async>${cfg.replace(/</g, "\\u003c")}</script></div></div>
<section class="panel"><h1>${esc(title)}</h1>${bodyHtml}</section>
<footer><div><b>${esc(brand.chart_attribution)}</b> · ${esc(footerDisclaimer ?? brand.disclaimer)}</div><div>cta.cryptophys.work</div></footer>
</div>
<script>
// Fit: lower the panel's type size until its text fits above the footer (the screenshot waits for this).
(function () {
  var panel = document.querySelector(".panel"), size = ${size};
  function apply(s) { panel.style.setProperty("--s", s + "px"); panel.querySelectorAll("p").forEach(function (p) { p.style.fontSize = s + "px"; if (p.className === "gap") p.style.height = Math.round(s * 0.55) + "px"; }); panel.querySelector("h1").style.fontSize = (s + 6) + "px"; }
  while (size > 18 && panel.scrollHeight > panel.clientHeight) { size -= 1; apply(size); }
  document.body.setAttribute("data-fit", panel.scrollHeight > panel.clientHeight ? "overflow" : "ok");
})();
</script></body></html>`;
}
