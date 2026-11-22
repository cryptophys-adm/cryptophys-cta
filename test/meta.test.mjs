// The public pages' head metadata and the root files (frontend audit 2026-11-22, owner approved; no visible text):
// canonical, icons, Open Graph and Twitter from each page's own title and description, robots.txt, sitemap.xml and the
// home page's schema.org microdata (microdata, not JSON-LD: the pages run no inline script).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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
    assert.equal(attr(html, /<meta name="twitter:card" content="([^"]*)">/), "summary");
    assert.match(html, /<link rel="icon" href="\/favicon\.svg" type="image\/svg\+xml">/, file);
    assert.match(html, /<link rel="icon" href="\/favicon\.ico" sizes="32x32">/, file);
    assert.match(html, /<link rel="apple-touch-icon" href="\/apple-touch-icon\.png">/, file);
    assert.doesNotMatch(html, /og:image|application\/ld\+json/, `${file}: no share image (owner's call) and no inline JSON-LD`);
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
