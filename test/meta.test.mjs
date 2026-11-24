// The public pages' head metadata and the root files (frontend audit 2026-11-22, owner approved; no visible text):
// canonical, icons, Open Graph and Twitter from each page's own title and description, robots.txt, sitemap.xml and the
// home page's schema.org microdata (microdata, not JSON-LD: the pages run no inline script). Since 2026-11-24 (owner,
// "setuju" on the mockup "CTA: share image, llms.txt, War Room tab"): one share card for every public page and /llms.txt.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { OG } from "../scripts/og-image.mjs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const ORIGIN = "https://cta.cryptophys.work";
const PAGES = { "index.html": "/", "performance.html": "/performance", "archive.html": "/archive", "about.html": "/about", "disclaimer.html": "/disclaimer", "privacy.html": "/privacy", "terms.html": "/terms" };
const attr = (html, re) => html.match(re)?.[1];

test("MD1 every public page: canonical, icons, Open Graph and Twitter taken from its own title and description", () => {
  for (const [file, path] of Object.entries(PAGES)) {
    const html = read(`public/${file}`);
    const title = attr(html, /<title>([^<]*)<\/title>/), desc = attr(html, /<meta name="description" content="([^"]*)">/);
    assert.ok(title && desc, file);
    assert.equal(attr(html, /<link rel="canonical" href="([^"]*)">/), ORIGIN + path, `${file} canonical`);
    assert.equal(attr(html, /<meta property="og:url" content="([^"]*)">/), ORIGIN + path, `${file} og:url`);
    assert.equal(attr(html, /<meta property="og:title" content="([^"]*)">/), title, `${file} og:title is the page's title`);
    assert.equal(attr(html, /<meta property="og:description" content="([^"]*)">/), desc, `${file} og:description is the page's description`);
    assert.equal(attr(html, /<meta property="og:type" content="([^"]*)">/), "website");
    assert.equal(attr(html, /<meta name="twitter:card" content="([^"]*)">/), "summary_large_image", `${file}: the large card, for the share image`);
    assert.equal(attr(html, /<meta property="og:image" content="([^"]*)">/), `${ORIGIN}/og.png`, `${file} og:image`);
    assert.equal(attr(html, /<meta property="og:image:type" content="([^"]*)">/), "image/png");
    assert.equal(attr(html, /<meta property="og:image:width" content="([^"]*)">/), "1200");
    assert.equal(attr(html, /<meta property="og:image:height" content="([^"]*)">/), "630");
    assert.equal(attr(html, /<meta property="og:image:alt" content="([^"]*)">/), "XAUUSD AI by Cryptophys. Gold, argued every fifteen minutes.");
    assert.match(html, /<link rel="icon" href="\/favicon\.svg" type="image\/svg\+xml">/, file);
    assert.match(html, /<link rel="icon" href="\/favicon\.ico" sizes="32x32">/, file);
    assert.match(html, /<link rel="apple-touch-icon" href="\/apple-touch-icon\.png">/, file);
    assert.doesNotMatch(html, /application\/ld\+json/, `${file}: no inline JSON-LD`);
  }
});

test("MD2 the icons are the header's brand mark; robots.txt keeps the studio out and names the sitemap; the sitemap lists the public pages", () => {
  const svg = read("public/favicon.svg");
  assert.match(svg, /stroke="#D4A537"/, "the brand gold");
  assert.match(svg, /<circle cx="16" cy="16" r="10\.5"\/><path d="M16 5\.5v21M5\.5 16h21"\/><circle cx="16" cy="16" r="3\.6"\/>/, "the header's mark, scaled to 32");
  const ico = readFileSync(new URL("../public/favicon.ico", import.meta.url));
  assert.deepEqual([...ico.subarray(0, 4)], [0, 0, 1, 0], "an ICO file");
  assert.deepEqual([...ico.subarray(22, 26)], [0x89, 0x50, 0x4e, 0x47], "holding a PNG");
  const touch = readFileSync(new URL("../public/apple-touch-icon.png", import.meta.url));
  assert.equal(touch.readUInt32BE(16), 180); assert.equal(touch.readUInt32BE(20), 180);
  const robots = read("public/robots.txt");
  assert.match(robots, /^User-agent: \*$/m);
  for (const p of ["/studio", "/api/studio/", "/signin"]) assert.match(robots, new RegExp(`^Disallow: ${p.replace(/\//g, "\\/")}$`, "m"), p);
  assert.match(robots, new RegExp(`^Sitemap: ${ORIGIN}/sitemap\\.xml$`, "m"));
  const locs = [...read("public/sitemap.xml").matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.deepEqual(locs, Object.values(PAGES).map((p) => ORIGIN + p));
});

test("MD3 the home page's microdata: the site and the organization, from the markup already there", () => {
  const html = read("public/index.html");
  assert.match(html, /<body itemscope itemtype="https:\/\/schema\.org\/WebSite">\n<link itemprop="url" href="https:\/\/cta\.cryptophys\.work\/"><meta itemprop="name" content="XAUUSD AI by Cryptophys">/);
  assert.match(html, /<header class="top" itemscope itemtype="https:\/\/schema\.org\/Organization">/);
  assert.match(html, /<a class="brand" href="\/"[^>]*itemprop="url">/);
  assert.match(html, /<small itemprop="name">Cryptophys<\/small>/);
  assert.match(html, /href="https:\/\/www\.threads\.net\/@cryptophys\.adm"[^>]*itemprop="sameAs">Follow on Threads<\/a>/);
});

test("MD4 the share card and llms.txt (owner 2026-11-24): the card a 1200 x 630 PNG of the home page's own words, llms.txt the pages' own descriptions", () => {
  const png = readFileSync(new URL(`../${OG.path}`, import.meta.url));
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "a PNG");
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [OG.width, OG.height]);
  assert.deepEqual([OG.width, OG.height], [1200, 630]);
  assert.ok(png.length < 200_000, `small enough to fetch at once (${png.length} bytes)`);
  // the card's words: the home page's headline and description, the address and the disclaimer; no number but its time words
  const card = read("scripts/og/card.html"), home = read("public/index.html");
  const words = [...card.replace(/<!--[\s\S]*?-->|<style>[\s\S]*?<\/style>|<script>[\s\S]*?<\/script>/g, "").matchAll(/>([^<>]+)</g)].map((m) => m[1].trim()).filter(Boolean);
  assert.deepEqual(words, ["XAUUSD AI", "Cryptophys", "Gold, argued every fifteen minutes.", "Sixteen AI analysts meet when a candle closes, and a moderator writes down what the room concluded.", "cta.cryptophys.work", "Education, not financial advice"]);
  assert.ok(home.includes(">Gold, argued every fifteen minutes.</h1>"), "the home page's headline");
  assert.ok(home.includes("sixteen AI analysts meet when a candle closes, and a moderator writes down what the room concluded."), "the home page's description");
  assert.doesNotMatch(card, /\b\d{3,}\.\d|nexus|omega/i, "no price or level, no internal name");
  // llms.txt: the title, the home page's description as its summary, then each page with its own description, word for word
  const llms = read("public/llms.txt");
  const desc = (f) => attr(read(`public/${f}`), /<meta name="description" content="([^"]*)">/);
  assert.equal(llms, [
    "# XAUUSD AI by Cryptophys", "", `> ${desc("index.html")}`, "", "## Pages", "",
    `- [Home](${ORIGIN}/)`,
    `- [Performance](${ORIGIN}/performance): ${desc("performance.html")}`,
    `- [Archive](${ORIGIN}/archive): ${desc("archive.html")}`,
    `- [About the system](${ORIGIN}/about): ${desc("about.html")}`,
    "", "## Policies", "",
    `- [Disclaimer](${ORIGIN}/disclaimer): ${desc("disclaimer.html")}`,
    `- [Privacy](${ORIGIN}/privacy)`, `- [Terms](${ORIGIN}/terms)`, ""
  ].join("\n"));
  assert.doesNotMatch(llms, /nexus|omega|studio|api\//i, "no internal system, no studio, no API");
  for (const p of ["/og.png", "/llms.txt"]) assert.ok(!JSON.parse(read("wrangler.jsonc").replace(/^\s*\/\/.*$/gm, "")).assets.run_worker_first.some((r) => p.startsWith(r.replace("*", ""))), `${p} is a static file`);
});
