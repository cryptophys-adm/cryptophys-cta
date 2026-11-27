// The post card (owner 2026-11-27: "setuju kartu skematik B"; before, a TradingView chart screenshot). One 1080 x 1350
// (4:5) page:
//   - the brand and what the post is (pattern, key-level map, daily recap, War Room);
//   - the schematic: the draft's own published numbers drawn to scale by Cryptophys (zones, pattern lines, measured
//     projection, price when read) on our own price axis, marked "Schematic: our levels to scale, not a price chart";
//     never a price series (candles or a line): no market data is drawn, so none is licensed or sent anywhere;
//   - the Cryptophys panel: the draft's own text, which the content guardian already checked, without its hashtags;
//     the disclaimer and "Chart by Cryptophys" in the footer.
// A draft without numbers to draw (a recap, a War Room reading) has no schematic: the panel takes the card.
// All public content is in English (owner 2026-11-15: "Semua content in english").
// Pure: the HTML and the SVG are built from the draft and the brand. src/render.mjs drives the browser.
export const CARD_WIDTH = 1080;
export const CARD_HEIGHT = 1350;
/** The chart's height: shorter when the panel has more lines, so the panel's text keeps a readable size. */
export const chartHeightFor = (lines) => (lines <= 7 ? 700 : lines <= 11 ? 600 : 520);
export const CARD_VERSION = "cryptophys.cta-card.v3";
/** The schematic's footnote (owner 2026-11-27, option B): what the picture is, and what it is not. */
export const SCHEMATIC_NOTE = "Schematic: our levels to scale, not a price chart";

import { saneProjection } from "./analysis-drafts.mjs";

const KIND_LABEL = { pattern: "Chart pattern", key_levels: "Key-level map", daily_recap: "Daily recap", warroom: "War Room reading" };
/** The charts a card names. */
const INTERVAL = { M15: "15", H1: "60", H4: "240", D1: "D" };

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** The chart timeframe of a draft: a pattern's own chart; the key-level map on its largest chart, else H4; the daily recap on H1. */
export function chartOf(draft) {
  if (draft?.kind === "pattern") {
    const m = /^pattern:(M15|H1|H4|D1):/.exec(String(draft.id ?? ""));
    if (m) return m[1];
  }
  // A key-level map per chart (owner 2026-11-25): its largest chart (D1 for the daily close, H4 for "H4 + H1", H1
  // alone); the daily map of 06:09 on H4, as before.
  if (draft?.kind === "key_levels") return INTERVAL[draft?.overlay?.chart] ? draft.overlay.chart : "H4";
  // War Room (owner 2026-11-18): the source's own timeframe (news on H1).
  if (draft?.kind === "warroom" && INTERVAL[draft?.overlay?.chart]) return draft.overlay.chart;
  return "H1";
}

/**
 * The panel's lines: the draft text without its hashtag line, its disclaimer lines and an attribution line
 * (the footer carries those), and without trailing blank lines. The first line is the title.
 */
export function panelLines(text, { disclaimers = [] } = {}) {
  const drop = new Set(disclaimers.map((d) => d.trim()).filter(Boolean));
  const lines = String(text ?? "").split("\n").map((l) => l.trimEnd())
    .filter((l) => !/^#\S/.test(l.trim()) && !drop.has(l.trim()) && !/^chart\s+by\s+(tradingview|cryptophys)/i.test(l.trim()));
  while (lines.length && !lines.at(-1).trim()) lines.pop();
  while (lines.length && !lines[0].trim()) lines.shift();
  return lines;
}

/** Pure: the card page for one draft. `disclaimers` are the template disclaimers the footer replaces. */
export function cardHtml(draft, brand, { disclaimers = [], footerDisclaimer } = {}) {
  const lines = panelLines(draft?.text, { disclaimers });
  const [title = "", ...body] = lines;
  // The panel's type size follows its length, so a long recap still fits the 4:5 card.
  const chars = body.join(" ").length;
  const overlay = schematicOverlay(draft?.overlay);
  const chartHeight = overlayPrices(overlay).length ? chartHeightFor(body.length) : 0;
  // Without a schematic (a recap) the panel has the card to itself: larger type, which the fit lowers if needed.
  const size = chartHeight ? (chars > 520 ? 25 : chars > 380 ? 28 : chars > 240 ? 31 : 34) : (chars > 900 ? 34 : chars > 500 ? 40 : 46);
  const bodyHtml = body.map((l) => (l.trim() ? `<p>${esc(l)}</p>` : `<p class="gap"></p>`)).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=${CARD_WIDTH}">
<title>${esc(title)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${CARD_WIDTH}px;height:${CARD_HEIGHT}px;overflow:hidden;background:#0b0f17;color:#e6e9ef;font-family:"Inter","Segoe UI","Helvetica Neue",Arial,sans-serif}
.card{display:flex;flex-direction:column;width:${CARD_WIDTH}px;height:${CARD_HEIGHT}px}
header{display:flex;align-items:center;justify-content:space-between;height:110px;padding:0 48px;border-bottom:1px solid #1d2533}
.brand{font-size:34px;font-weight:700;letter-spacing:.3px}.brand span{color:#d4af37}
.kind{font-size:24px;font-weight:600;color:#0b0f17;background:#d4af37;border-radius:999px;padding:10px 22px}
.chart{position:relative;width:${CARD_WIDTH}px;height:${chartHeight}px;background:#131722}
.chart svg{display:block}
.panel{flex:1;padding:30px 48px 0;overflow:hidden}
.panel h1{font-size:${size + 6}px;line-height:1.25;font-weight:700;margin-bottom:14px;color:#fff}
.panel p{font-size:${size}px;line-height:1.38;color:#cfd5df}.panel p.gap{height:${Math.round(size * 0.55)}px}
footer{height:110px;padding:14px 48px;border-top:1px solid #1d2533;font-size:20px;line-height:1.4;color:#8b93a3}
footer b{color:#d4af37;font-weight:600}
</style></head>
<body><div class="card">
<header><div class="brand">${esc(brand.name).replace("·", "<span>·</span>")}</div><div class="kind">Education · ${esc(KIND_LABEL[draft?.kind] ?? "Analysis")}</div></header>
${chartHeight ? `<div class="chart" id="chart">${schematicSvg(overlay, { height: chartHeight })}</div>` : ""}
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

// ---- The overlay -------------------------------------------------------------------------------------------------

/** The prices an overlay draws (for the chart's price range and its pixel mapping). */
export function overlayPrices(overlay) {
  const out = [];
  for (const z of overlay?.zones ?? []) out.push(z.low, z.high);
  const p = overlay?.pattern;
  if (p) out.push(p.upper, p.lower, p.projection, ...(p.lines ? [p.lines.upper?.[0], p.lines.lower?.[0]] : []));
  if (overlay?.price != null) out.push(overlay.price);
  return out.filter((x) => Number.isFinite(x));
}
/** Checks a measured geometry: every price inside the pane, a higher price higher on the chart. */
export function geometryProblem(geo, prices) {
  if (!geo || geo.error) return geo?.error ?? "no geometry";
  const { pane, ys, xLast } = geo;
  if (!pane || !(pane.w > 200 && pane.h > 200)) return "pane too small";
  if (!Number.isFinite(xLast) || xLast <= 0 || xLast >= pane.w) return "last bar off the pane";
  if (!Array.isArray(ys) || ys.length !== prices.length || ys.some((y) => !Number.isFinite(y) || y < 0 || y > pane.h)) return "a level is off the chart";
  if ((geo.xs ?? []).some((x) => x != null && (!Number.isFinite(x) || x < 0 || x > pane.w))) return "a pattern point is off the chart";
  for (let i = 0; i < prices.length; i += 1) for (let j = 0; j < prices.length; j += 1) {
    if (prices[i] > prices[j] + 0.01 && !(ys[i] < ys[j])) return "the price scale is not monotonic";
  }
  return null;
}

const f2 = (x) => Number(x).toFixed(2);
const ZONE_STYLE = {
  supply: { fill: "#f23645", label: "Supply zone · sell area" },
  demand: { fill: "#089981", label: "Demand zone · buy area" },
  at_price: { fill: "#d4af37", label: "Price is in this zone" }
};
const GOLD = "#d4af37";
/** "Supply zone · sell area 3898.00–3902.40": on the chart the zone only (owner 2026-11-15: "di chart cukup zone tidak
 * perlu membawa metrics"); the metric names stay in the text. */
// One price for a zero-width zone, as in the post's text (src/analysis-drafts.mjs zoneRange; owner 2026-11-25: "1. Yes").
const zoneLabel = (z) => `${ZONE_STYLE[z.role]?.label ?? "Zone"} ${f2(z.low) === f2(z.high) ? f2(z.low) : `${f2(z.low)}–${f2(z.high)}`}`;
/** A text label with a dark backing (SVG has no text background); placed later by layoutLabels. */
function tag(x, y, text, { color = "#e6e9ef", anchor = "start", size = 19, weight = 600, alts = [] } = {}) {
  const w = Math.round(text.length * size * 0.56) + 16, h = size + 12;
  const left = anchor === "end" ? x - w : anchor === "middle" ? x - w / 2 : x;
  return { label: true, x: left, y: y - h / 2, w, h, text, color, size, weight, alts };
}
const overlaps = (a, b) => a.x < b.x + b.w + 4 && b.x < a.x + a.w + 4 && a.y < b.y + b.h + 3 && b.y < a.y + a.h + 3;
/**
 * Greedy: each label in turn takes the nearest free spot: first close to its own line (up to 48 px away) at its own
 * position or one of its alternative columns (`alts`, x offsets), then further away in its own column.
 */
export function layoutLabels(labels, { top, bottom }) {
  const placed = [];
  const free = (c) => c.y >= top && c.y + c.h <= bottom && !placed.some((p) => overlaps(c, p));
  for (const l of labels) {
    const base = Math.min(Math.max(l.y, top), bottom - l.h);
    const near = [0, ...(l.alts ?? [])].flatMap((dx) => [0, 1, 2, 3, 4, 5, 6].flatMap((s) => (s ? [s, -s] : [0])).map((s) => ({ ...l, x: l.x + dx, y: base + s * 8 })));
    const far = Array.from({ length: 40 }, (_, i) => i + 7).flatMap((s) => [s, -s]).map((s) => ({ ...l, y: base + s * 8 }));
    placed.push([...near, ...far].find(free) ?? { ...l, y: base });
  }
  return placed;
}
const drawLabel = (l) => `<rect x="${l.x.toFixed(1)}" y="${l.y.toFixed(1)}" width="${l.w}" height="${l.h}" rx="6" fill="#0b0f17" fill-opacity="0.85"/>` +
  `<text x="${(l.x + 8).toFixed(1)}" y="${(l.y + l.h / 2 + l.size * 0.36).toFixed(1)}" font-size="${l.size}" font-weight="${l.weight}" fill="${l.color}" font-family="Inter,Segoe UI,Arial,sans-serif">${esc(l.text)}</text>`;
/** The words the overlay writes on the chart (checked by the guardian in the tests). */
export function overlayLabels(overlay) {
  const out = [];
  for (const z of overlay?.zones ?? []) out.push(zoneLabel(z));
  const p = overlay?.pattern;
  if (p) {
    out.push(`${p.name} · ${p.chart}`, `Upper line ${f2(p.upper)}`, `Lower line ${f2(p.lower)}`);
    if (p.status === "confirmed" && p.projection != null) out.push(`Measured projection ${f2(p.projection)}`, "Projection area");
    if (p.status === "forming") out.push(`Close above ${f2(p.upper)} confirms up`, `Close below ${f2(p.lower)} confirms down`);
  }
  return out;
}

/**
 * Pure: the overlay's SVG, in the chart's pixels. `geo` is the schematic's geometry (schematicGeo) for
 * overlayPrices(overlay), `frame` an offset in the chart container.
 */
export function overlaySvg(overlay, geo, { frame = { x: 0, y: 0 } } = {}) {
  const prices = overlayPrices(overlay);
  const yOf = new Map(prices.map((p, i) => [p, geo.ys[i]]));
  const X = (x) => frame.x + geo.pane.x + x, Y = (p) => frame.y + geo.pane.y + yOf.get(p);
  const left = X(0), right = X(geo.pane.w), now = X(geo.xLast);
  const parts = [];
  const p = overlay?.pattern;
  if (p?.status === "confirmed" && p.projection != null) {
    parts.push(`<rect x="${(now + 6).toFixed(1)}" y="${(frame.y + geo.pane.y).toFixed(1)}" width="${(right - now - 6).toFixed(1)}" height="${geo.pane.h.toFixed(1)}" fill="${GOLD}" fill-opacity="0.06"/>`);
    parts.push(tag(right - 10, frame.y + geo.pane.y + 54, "Projection area", { color: GOLD, anchor: "end", size: 17 }));
  }
  for (const z of overlay?.zones ?? []) {
    const st = ZONE_STYLE[z.role] ?? ZONE_STYLE.at_price;
    const top = Y(z.high), bottom = Y(z.low), h = Math.max(4, bottom - top);
    parts.push(`<rect x="${left.toFixed(1)}" y="${top.toFixed(1)}" width="${(right - left).toFixed(1)}" height="${h.toFixed(1)}" fill="${st.fill}" fill-opacity="0.2" stroke="${st.fill}" stroke-opacity="0.65" stroke-width="1.5"/>`);
    parts.push(tag(left + 12, top + h / 2, zoneLabel(z), { color: st.fill === GOLD ? GOLD : "#ffffff", size: 18, alts: [430] }));
  }
  if (p) {
    // The pattern's lines (owner 2026-11-15: "gambar juga garis pattern di chart"): from its start candle to its last,
    // as fitted (a triangle's lines converge, a channel's slope), carried on to the current candle. Without anchors
    // (an older analysis) the levels are drawn flat over the pattern's span.
    const [x0, x1] = (geo.xs ?? []).map((x) => (x == null ? null : X(x)));
    const anchored = p.lines && x0 != null && x1 != null && x1 > x0 + 4;
    let from = left + (now - left) * 0.42;
    for (const [side, price, label, dy] of [["upper", p.upper, `Upper line ${f2(p.upper)}`, -20], ["lower", p.lower, `Lower line ${f2(p.lower)}`, 20]]) {
      let path;
      if (anchored) {
        const ya = Y(p.lines[side][0]), yb = Y(price);
        const yNow = now > x1 ? yb + ((yb - ya) / (x1 - x0)) * (now - x1) : yb;
        path = [[x0, ya], [Math.max(x1, now), yNow]];
        from = x0;
      } else path = [[from, Y(price)], [now, Y(price)]];
      parts.push(`<line x1="${path[0][0].toFixed(1)}" y1="${path[0][1].toFixed(1)}" x2="${path[1][0].toFixed(1)}" y2="${path[1][1].toFixed(1)}" stroke="${GOLD}" stroke-width="3" stroke-linecap="round"/>`);
      if (anchored) parts.push(`<circle cx="${x0.toFixed(1)}" cy="${path[0][1].toFixed(1)}" r="4" fill="${GOLD}"/>`);
      parts.push(tag(now - 6, path[1][1] + dy, label, { color: GOLD, anchor: "end", size: 18 }));
    }
    parts.push(tag(from, frame.y + geo.pane.y + 54, `${p.name} · ${p.chart}`, { color: GOLD, size: 20, weight: 700 }));
    parts.push(`<defs><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${GOLD}"/></marker></defs>`);
    if (p.status === "confirmed" && p.projection != null) {
      const start = p.direction === "down" ? p.lower : p.upper;
      const end = right - 90;
      parts.push(`<line x1="${now.toFixed(1)}" y1="${Y(start).toFixed(1)}" x2="${end.toFixed(1)}" y2="${Y(p.projection).toFixed(1)}" stroke="${GOLD}" stroke-width="3.5" stroke-dasharray="12 8" marker-end="url(#arrow)"/>`);
      parts.push(`<line x1="${(end - 60).toFixed(1)}" y1="${Y(p.projection).toFixed(1)}" x2="${right.toFixed(1)}" y2="${Y(p.projection).toFixed(1)}" stroke="${GOLD}" stroke-width="1.5" stroke-dasharray="4 4"/>`);
      parts.push(tag(end, Y(p.projection) + (p.direction === "down" ? 26 : -26), `Measured projection ${f2(p.projection)}`, { color: GOLD, anchor: "end", size: 18 }));
    }
    if (p.status === "forming") {
      const tip = 70;
      parts.push(`<line x1="${(now + 18).toFixed(1)}" y1="${Y(p.upper).toFixed(1)}" x2="${(now + 18).toFixed(1)}" y2="${(Y(p.upper) - tip).toFixed(1)}" stroke="${GOLD}" stroke-width="3" stroke-dasharray="8 6" marker-end="url(#arrow)"/>`);
      parts.push(`<line x1="${(now + 18).toFixed(1)}" y1="${Y(p.lower).toFixed(1)}" x2="${(now + 18).toFixed(1)}" y2="${(Y(p.lower) + tip).toFixed(1)}" stroke="${GOLD}" stroke-width="3" stroke-dasharray="8 6" marker-end="url(#arrow)"/>`);
      parts.push(tag(right - 10, Y(p.upper) - tip - 18, `Close above ${f2(p.upper)} confirms up`, { color: GOLD, anchor: "end", size: 17 }));
      parts.push(tag(right - 10, Y(p.lower) + tip + 18, `Close below ${f2(p.lower)} confirms down`, { color: GOLD, anchor: "end", size: 17 }));
    }
  }
  const shapes = parts.filter((x) => typeof x === "string");
  const labels = layoutLabels(parts.filter((x) => x?.label), { top: frame.y + geo.pane.y + 34, bottom: frame.y + geo.pane.y + geo.pane.h - 4 });
  return shapes.join("") + labels.map(drawLabel).join("");
}

// ---- The schematic (owner 2026-11-27: "setuju kartu skematik B") -------------------------------------------------

/** Pure: the overlay as the card draws it: a measured projection that is not sane is left out (src/analysis-drafts.mjs). */
export function schematicOverlay(overlay) {
  if (!overlay || typeof overlay !== "object") return null;
  const p = overlay.pattern;
  if (!p) return overlay;
  const projection = p.status === "confirmed" ? saneProjection(p, overlay.price) : null;
  return { ...overlay, pattern: { ...p, projection } };
}
/** The schematic's price axis width on the right, and the share of the width kept for the projection. */
const AXIS_W = 110;
/**
 * Pure: the schematic's geometry: a linear price scale over the overlay's own numbers (12% padding), the "when read"
 * line at the right of the drawing area, and a pattern's span from 28% of the width to it. No price series.
 */
export function schematicGeo(overlay, { width = CARD_WIDTH, height = 600 } = {}) {
  const prices = overlayPrices(overlay);
  let lo = Math.min(...prices), hi = Math.max(...prices);
  const pad = Math.max((hi - lo) * 0.12, Math.abs(hi) * 0.0015, 0.5);
  lo -= pad; hi += pad;
  const pane = { x: 0, y: 0, w: width - AXIS_W, h: height };
  const future = overlay?.pattern?.status === "confirmed" && overlay.pattern.projection != null ? 0.28 : overlay?.pattern ? 0.2 : 0.06;
  const xLast = pane.w * (1 - future);
  const y = (p) => pane.h - ((p - lo) / (hi - lo)) * pane.h;
  const xs = overlay?.pattern?.lines ? [pane.w * 0.28, xLast] : [];
  return { pane, xLast, xs, ys: prices.map(y), range: { from: lo, to: hi }, y };
}
const niceStep = (raw) => { const m = 10 ** Math.floor(Math.log10(raw)); const n = raw / m; return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * m; };
/** Pure: the schematic's frame: gridlines and prices on the right axis, the price when read, the "when read" line, the footnote. */
export function schematicFrame(overlay, geo) {
  const out = [], font = 'font-family="Inter,Segoe UI,Arial,sans-serif"';
  const { from, to } = geo.range, step = niceStep((to - from) / 6);
  const priceY = overlay?.price != null ? geo.y(overlay.price) : null;
  for (let v = Math.ceil(from / step) * step; v <= to; v += step) {
    const y = geo.y(v);
    out.push(`<line x1="0" y1="${y.toFixed(1)}" x2="${geo.pane.w}" y2="${y.toFixed(1)}" stroke="#2a3140" stroke-width="1"/>`);
    if (priceY == null || Math.abs(y - priceY) >= 32) out.push(`<text x="${geo.pane.w + 12}" y="${(y + 6).toFixed(1)}" fill="#8b93a3" font-size="18" ${font}>${f2(v)}</text>`);
  }
  out.push(`<line x1="${geo.xLast.toFixed(1)}" y1="0" x2="${geo.xLast.toFixed(1)}" y2="${geo.pane.h}" stroke="#3a4356" stroke-width="1.5" stroke-dasharray="6 6"/>`);
  out.push(`<text x="${(geo.xLast - 8).toFixed(1)}" y="24" fill="#8b93a3" font-size="17" text-anchor="end" ${font}>When read</text>`);
  if (priceY != null) {
    out.push(`<line x1="0" y1="${priceY.toFixed(1)}" x2="${geo.pane.w}" y2="${priceY.toFixed(1)}" stroke="#e6e9ef" stroke-width="1.5" stroke-dasharray="3 5"/>`);
    out.push(`<rect x="${geo.pane.w + 2}" y="${(priceY - 15).toFixed(1)}" width="${AXIS_W - 4}" height="30" rx="4" fill="#e6e9ef"/><text x="${geo.pane.w + AXIS_W / 2}" y="${(priceY + 6).toFixed(1)}" fill="#0b0f17" font-size="18" font-weight="700" text-anchor="middle" ${font}>${f2(overlay.price)}</text>`);
  }
  out.push(`<text x="16" y="${geo.pane.h - 14}" fill="#6b7385" font-size="16" ${font}>${esc(SCHEMATIC_NOTE)}</text>`);
  return out.join("");
}
/** Pure: the schematic's SVG for a card's chart area (the frame, then the overlay drawn on it). */
export function schematicSvg(overlay, { width = CARD_WIDTH, height = 600 } = {}) {
  const geo = schematicGeo(overlay, { width, height });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(SCHEMATIC_NOTE)}">` +
    schematicFrame(overlay, geo) + overlaySvg(overlay, geo) + "</svg>";
}
