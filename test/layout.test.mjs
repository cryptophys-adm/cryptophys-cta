// The home page's layout v2 (owner 2026-11-20: "jangan tempatkan semua di pojok ... terlalu penuh"): one type scale,
// the panels opened one at a time by the URL hash, and the header's four links, inline at every width.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PANELS, panelOf, namesPanel } from "../site/home/panels.js";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("LY1 one modular scale: every font size on the home and Performance pages is a step of --s-1 to --s6", () => {
  const css = read("public/home.css");
  assert.match(css, /--s-1:13\.6px;--s0:17px;--s1:21\.25px;--s2:26\.5px;--s3:33px;--s4:41\.5px;--s5:52px;--s6:65px;/, "the scale (1.25)");
  const sizes = [
    ...[...css.matchAll(/font-size:([^;}]+)/g)].map((m) => m[1].trim()),
    ...[...css.matchAll(/[{;]font:\s*(?:italic\s+)?\d{3}\s+([^\s/]+)/g)].map((m) => m[1].trim())
  ];
  assert.ok(sizes.length > 60, "the sizes are found");
  const off = sizes.filter((v) => !/^var\(--s(-1|[0-6])\)$/.test(v));
  assert.deepEqual(off, [], "no size off the scale");
  // Reading text never under the reading step: Newsreader is set at --s0 or larger.
  for (const m of css.matchAll(/font:\s*(?:italic\s+)?\d{3}\s+(var\(--s-1\))[^;}]*var\(--read\)/g)) assert.fail(`Newsreader at ${m[1]}`);
});

test("LY2 the panels: The cast and How it works open one at a time by the URL hash; the minutes are no panel, they follow the hero as the page scrolls", () => {
  assert.deepEqual([...PANELS], ["cast", "how"]);
  assert.deepEqual(["", "#", "#cast", "#how", "#minutes", "#disclaimer", "#latest", "cast", null].map(panelOf), [null, null, "cast", "how", null, null, null, "cast", null]);
  assert.deepEqual(["#cast", "#how", "#minutes", "", "#latest"].map(namesPanel), [true, true, false, false, false]);
  const page = read("public/index.html");
  // Owner 2026-11-20: "minutes jangan di header tapi ikut ke home page scroll bawah seperti sebelumnya".
  assert.match(page, /<section class="minutes" id="minutes" aria-labelledby="minutes-title">/, "the minutes are a plain section");
  assert.ok(page.indexOf('class="hero"') < page.indexOf('id="minutes"') && page.indexOf('id="minutes"') < page.indexOf('<div class="panels">'), "under the hero, before the panels");
  const header = page.slice(page.indexOf("<header"), page.indexOf("</header>"));
  assert.doesNotMatch(header, /#minutes/, "Minutes is not in the header");
  const panels = page.slice(page.indexOf('<div class="panels">'), page.indexOf('<aside class="notice"'));
  assert.deepEqual([...panels.matchAll(/<section class="panel (\w+)" id="(\w+)"/g)].map((m) => m[2]), ["cast", "how"], "the two panels, in the nav's order");
  for (const id of PANELS) assert.match(panels, new RegExp(`<h2 id="${id}-title" tabindex="-1">`), `${id}: its heading takes focus`);
  assert.ok(page.indexOf('class="hero"') < page.indexOf('<div class="panels">'), "the hero stays the landing view, above the panels");
  // Every way in reaches a panel: the nav, the footer, the skip link, the hero's button, the scene's Agents.
  const nav = page.slice(page.indexOf('<nav class="nav"'), page.indexOf("</nav>", page.indexOf('<nav class="nav"')));
  for (const id of PANELS) assert.match(nav, new RegExp(`<a href="#${id}" data-panel="${id}">`), `nav ${id}`);
  const foot = page.slice(page.indexOf('<footer'), page.indexOf("</footer>"));
  for (const id of PANELS) assert.match(foot, new RegExp(`<a href="#${id}">`), `footer ${id}`);
  assert.match(page, /class="skip" href="#minutes"/);
  assert.match(page, /class="btn ghost" href="#minutes">Read the latest minutes</);
  assert.match(page, /class="chip" href="#cast" id="nav-open">Agents</);
  const perf = read("public/performance.html");
  for (const id of PANELS) assert.match(perf, new RegExp(`href="/#${id}"`), `Performance links /#${id}`);
  // The stylesheet shows the panel the hash targets, else Minutes; back and forward follow the hash.
  const css = read("public/home.css");
  assert.match(css, /\.panels>\.panel:not\(:target\)\{display:none\}/, "a panel shows only when the hash names it");
  // The script marks the open panel and moves focus; opening one fetches nothing.
  const js = read("site/home/panels.js");
  assert.match(js, /setAttribute\('aria-current', 'true'\)/);
  assert.match(js, /addEventListener\('hashchange'/);
  assert.match(js, /focus\(\{ preventScroll: true \}\)/);
  assert.doesNotMatch(js, /fetch\(|import\(|XMLHttpRequest/, "no request when a panel opens");
  assert.match(read("site/home/home.js"), /\ninitPanels\(\);/);
  assert.doesNotMatch(page, /aria-current/, "marked by the script, from the hash");
});

test("LY3 the header's nav: the four links inline at every width, never folded or grouped; where room runs short only the type steps down (owner 2026-11-20: \"jangan digabungkan semua ... disesuaikan ukuran font saja\")", () => {
  for (const f of ["public/index.html", "public/performance.html"]) {
    const page = read(f);
    const header = page.slice(page.indexOf("<header"), page.indexOf("</header>"));
    const nav = header.slice(header.indexOf('<nav class="nav" aria-label="Main">'), header.indexOf("</nav>"));
    assert.deepEqual([...nav.matchAll(/<a [^>]*>([^<]+)</g)].map((m) => m[1]), ["The cast", "How it works", "Performance", "Archive"], `${f}: the links, Minutes not among them (it follows the hero)`);
    assert.doesNotMatch(header, /menu-btn|class="menu|menu-head|aria-expanded/, `${f}: no Menu button, no groups`);
    assert.equal((header.match(/<nav /g) ?? []).length, 1, `${f}: one nav`);
  }
  assert.match(read("public/index.html"), /<a href="#cast" data-panel="cast">The cast<\/a>/, "the home's links open the panels");
  assert.doesNotMatch(read("site/home/header.js"), /initMenu/);
  const css = read("public/home.css");
  assert.doesNotMatch(css, /\.nav[^{]*\{[^}]*display:none/, "the nav is never hidden");
  assert.match(css, /@media \(max-width:1299px\)\{[\s\S]*?\.nav a\{padding:0 7px;font-size:var\(--s-1\)\}/, "narrower: smaller type");
  assert.match(css, /@media \(max-width:600px\)\{[\s\S]*?\.nav\{order:5;flex:1 0 100%/, "a phone: the links on their own row");
});

