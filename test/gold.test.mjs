// The live gold quote on the home page (owner 2026-11-20: "Widget only, core without a price"): TradingView's Single
// Quote widget in its own frame, on the core, and the owner's exception to the no-price rule scoped to it alone.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SECURITY_HEADERS } from "../src/app.mjs";
import { checkContentDraft } from "../src/guardian.mjs";
import { GOLD_PRICE_IDS, TV_FRAME_HOST, TV_QUOTE_SETTINGS, tvQuoteSrc } from "../site/home/gold.js";
import { safeLine } from "../site/room/script.js";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const jsonc = (p) => JSON.parse(read(p).replace(/^\s*\/\/.*$/gm, ""));

/** The page's words, without its head and scripts, and without the elements whose ids are in `except`. */
function elementSpan(html, id) {
  const open = html.search(new RegExp(`<([a-z0-9]+)\\b[^>]*\\sid="${id}"`, "i"));
  if (open < 0) return null;
  const tag = html.slice(open + 1).match(/^[a-z0-9]+/i)[0];
  const re = new RegExp(`<${tag}\\b|</${tag}>`, "gi");
  re.lastIndex = open + 1;
  let depth = 1, m;
  while ((m = re.exec(html))) { depth += m[0].startsWith("</") ? -1 : 1; if (!depth) return [open, m.index + m[0].length, html.indexOf(">", open) + 1, m.index]; }
  return null;
}
const fill = (html, id, text) => { const [, , inner, close] = elementSpan(html, id); return html.slice(0, inner) + text + html.slice(close); };
const without = (html, ids) => ids.reduce((h, id) => { const s = elementSpan(h, id); return s ? h.slice(0, s[0]) + h.slice(s[1]) : h; }, html);
const words = (html, except = []) => without(html, except).replace(/<head>[\s\S]*?<\/head>|<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ");
const priceIn = (text) => checkContentDraft({ text }).failures.find((f) => f.check === "price_level")?.detail ?? null;

test("GD5 the TradingView quote: on the core only (outside the header and the hud), its frame added after the load event, its attribution kept", () => {
  const page = read("public/index.html");
  const header = page.slice(page.indexOf("<header"), page.indexOf("</header>"));
  for (const id of GOLD_PRICE_IDS) assert.equal(header.indexOf(`id="${id}"`), -1, `${id} is never in the header`);
  assert.doesNotMatch(header.replace(/XAUUSD AI/g, ""), /tradingview|XAUUSD|OANDA|gold-|core-gold/i, "nothing of the gold price in the header (the brand is XAUUSD AI)");
  // Owner 2026-11-20: "widget hanya ditempatkan dalam core": inside the room, over the scene, not in the hud's corner.
  const room = page.slice(page.indexOf('<div class="room" id="room">'), page.indexOf('<div class="hud">'));
  assert.match(room, /<div class="gold-live" id="gold-live" role="group" aria-label="Live gold price from TradingView" hidden>/);
  assert.match(room, /<p class="tradingview-widget-copyright"><a href="https:\/\/www\.tradingview\.com\/symbols\/XAUUSD\/\?exchange=OANDA" rel="noopener nofollow" target="_blank">[^<]*<span class="blue-text">XAUUSD quote<\/span><span class="trademark"> by TradingView<\/span><\/a><\/p>/, "TradingView's attribution link, with the quote");
  const hud = page.slice(page.indexOf('<div class="hud">'), page.indexOf('<div class="hero-copy">'));
  assert.doesNotMatch(hud + page.slice(page.indexOf("</section>")), /gold-live|tradingview/i, "nowhere else: not under the dial, not below the hero");
  assert.doesNotMatch(page, /<iframe|tradingview\.com\/external-embedding|s3\.tradingview/i, "no frame and no TradingView script in the page itself");
  const home = read("site/home/home.js");
  assert.match(home, /const afterLoad = \(fn\) => \{[\s\S]*?addEventListener\('load', later, \{ once: true \}\)/, "after the page's load event");
  assert.match(home, /afterLoad\(\(\) => \{\n\s*const f = document\.createElement\('iframe'\);\n\s*f\.src = tvQuoteSrc\(/, "the frame is made only after the load event");
  assert.match(home, /\$\('tv-frame'\)\.append\(f\);\n\s*\$\('gold-live'\)\.hidden = false;/, "the lens appears with its frame");
  assert.match(home, /afterLoad\(start\)/, "the scene the same way");
  assert.doesNotMatch(home, /createElement\('script'\)/, "no third-party script");
  // The scene keeps it on the core: the core's projection, written only when it changes, hidden when off screen.
  const scene = read("site/room/main.js");
  assert.match(scene, /tmpV\.copy\(CORE\)\.project\(camera\)/, "projected from the core, as the labels are");
  assert.match(scene, /if \(at === gold\.at\) return;/, "the page's element moves only when the place changes");
  assert.match(scene, /classList\.toggle\('off-core', off\)/);
  const css = read("public/home.css");
  assert.match(css, /\.gold-live\{position:absolute;z-index:2;left:50%;top:42%;[^}]*transform:translate\(-50%,-50%\)/, "an overlay (it shifts nothing); without the scene it waits where the core stands");
  assert.match(css, /\.tv-frame\{height:calc\(62px \* var\(--lens-k\)\);overflow:hidden\}/, "the quote's rows only");
  // The URL TradingView's own embed script gives its frame: OANDA:XAUUSD, dark, transparent, English.
  const u = new URL(tvQuoteSrc("cta.cryptophys.work/"));
  assert.equal(u.origin, TV_FRAME_HOST);
  assert.equal(u.pathname, "/embed-widget/single-quote/");
  assert.equal(u.searchParams.get("locale"), "en");
  assert.deepEqual(JSON.parse(decodeURIComponent(u.hash.slice(1))), { symbol: "OANDA:XAUUSD", width: "100%", colorTheme: "dark", isTransparent: true, height: 101, "page-uri": "cta.cryptophys.work/" });
  assert.equal(TV_QUOTE_SETTINGS.symbol, "OANDA:XAUUSD");
  // The CSP: one frame host added, the widget frame's; no script, style or connect host.
  const csp = Object.fromEntries(SECURITY_HEADERS["content-security-policy"].split(";").map((d) => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v.join(" ")]));
  assert.equal(csp["frame-src"], TV_FRAME_HOST);
  assert.deepEqual([csp["script-src"], csp["style-src"], csp["connect-src"], csp["default-src"], csp["frame-ancestors"]], ["'self'", "'self'", "'self'", "'none'", "'none'"]);
  assert.match(read("public/privacy.html"), /live gold price[\s\S]{0,200}served by TradingView[\s\S]{0,200}may set its own cookies/i, "the privacy page says so");
});

test("GD6 the owner's exception to the no-price rule covers only TradingView's quote; every other element stays strict", () => {
  assert.deepEqual([...GOLD_PRICE_IDS], ["gold-live"]);
  const page = read("public/index.html");
  assert.equal(page.split('id="gold-live"').length, 2, "exactly one element");
  assert.doesNotMatch(page, /core-gold|gold-row/, "no gold price on the core or in the status box (owner: core without a price)");
  assert.equal(priceIn(words(page)), null, "the static page carries no price-like number");
  // Any other element with a price still fails, the exception applied.
  for (const id of ["room-status", "sub-text", "hero-title", "next-rooms", "clock-local", "latest-headline", "m-conclusion", "m-speakers", "disclaimer-text", "card-role"]) {
    assert.ok(elementSpan(page, id), id);
    assert.equal(priceIn(words(fill(page, id, "Gold near 4,123.46"), GOLD_PRICE_IDS)), "4,123.46", `${id} stays strict`);
  }
  // The rooms' words keep their own filter.
  assert.equal(safeLine("Gold closed at 4,123.46 on the quarter hour."), "");
  assert.doesNotMatch(page + read("site/home/gold.js") + read("public/home.js") + read("public/room/room.js"), /\bomega\b/i);
});
