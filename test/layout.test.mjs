// The home page's layout v2 (owner 2026-11-20: "jangan tempatkan semua di pojok ... terlalu penuh"): one type scale,
// the panels opened one at a time by the URL hash, and the header's menu that folds into grouped links.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PANELS, DEFAULT_PANEL, panelOf, namesPanel } from "../site/home/panels.js";

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

test("LY2 the panels: Minutes, The cast and How it works open one at a time under the hero, by the URL hash; Minutes without one", () => {
  assert.deepEqual([...PANELS], ["minutes", "cast", "how"]);
  assert.equal(DEFAULT_PANEL, "minutes");
  assert.deepEqual(["", "#", "#cast", "#how", "#minutes", "#disclaimer", "#latest", "cast", null].map(panelOf), ["minutes", "minutes", "cast", "how", "minutes", "minutes", "minutes", "cast", "minutes"]);
  assert.deepEqual(["#cast", "#how", "#minutes", "", "#latest"].map(namesPanel), [true, true, true, false, false]);
  const page = read("public/index.html");
  const panels = page.slice(page.indexOf('<div class="panels">'), page.indexOf('<aside class="notice"'));
  assert.deepEqual([...panels.matchAll(/<section class="panel (\w+)" id="(\w+)"/g)].map((m) => m[2]), ["minutes", "cast", "how"], "the three panels, in the nav's order");
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
  assert.match(css, /\.panels:has\(>\.panel:target\)>\.panel:not\(:target\),\n\.panels:not\(:has\(>\.panel:target\)\)>\.panel:not\(#minutes\)\{display:none\}/);
  // The script marks the open panel and moves focus; opening one fetches nothing.
  const js = read("site/home/panels.js");
  assert.match(js, /setAttribute\('aria-current', 'true'\)/);
  assert.match(js, /addEventListener\('hashchange'/);
  assert.match(js, /focus\(\{ preventScroll: true \}\)/);
  assert.doesNotMatch(js, /fetch\(|import\(|XMLHttpRequest/, "no request when a panel opens");
  assert.match(read("site/home/home.js"), /\ninitPanels\(\);/);
  assert.doesNotMatch(page, /aria-current/, "marked by the script, from the hash");
});

test("LY3 the header's menu: one nav, inline when wide, folded into a Menu button with grouped links when narrow; accessible by keyboard and touch", () => {
  for (const f of ["public/index.html", "public/performance.html"]) {
    const page = read(f);
    const header = page.slice(page.indexOf("<header"), page.indexOf("</header>"));
    assert.match(header, /<nav class="nav" aria-label="Main">\n\s*<button class="menu-btn" id="menu-btn" type="button" aria-expanded="false" aria-controls="menu">Menu</, `${f}: a disclosure button`);
    assert.match(header, /<div class="menu" id="menu">/);
    for (const [id, name] of [["mg-room", "The room"], ["mg-results", "Results"], ["mg-follow", "Follow"]]) assert.match(header, new RegExp(`<p class="menu-head" id="${id}">${name}</p><ul aria-labelledby="${id}">`), `${f}: ${name}`);
    assert.match(header, /<a href="https:\/\/www\.threads\.net\/@cryptophys\.adm" rel="noopener" data-threads>Threads<\/a>/, `${f}: Follow carries Threads`);
    assert.equal((header.match(/<nav /g) ?? []).length, 1, `${f}: one nav, not two copies`);
  }
  const js = read("site/home/header.js");
  assert.match(js, /e\.key === 'Escape' && isOpen\(\)\) set\(false, true\)/, "Esc closes and gives focus back to the button");
  assert.match(js, /e\.key !== 'ArrowDown'/, "ArrowDown from the button enters the links");
  assert.match(js, /'ArrowDown' \? i \+ 1 : e\.key === 'ArrowUp' \? i - 1 : e\.key === 'Home' \? 0 : e\.key === 'End'/);
  assert.match(js, /addEventListener\('pointerdown'/, "a tap or click outside closes it");
  assert.match(js, /addEventListener\('focusout'/, "focus leaving closes it");
  assert.match(js, /setAttribute\('aria-expanded', String\(open\)\)/);
  const css = read("public/home.css");
  assert.match(css, /\.menu\{display:none;position:absolute;[^}]*\}\n\.menu\.open\{display:block\}/, "folded until opened");
  assert.match(css, /@media \(min-width:1200px\)\{\n\s*\.menu-btn\{display:none\}\n\s*\.menu,\.menu\.open\{position:static;display:flex/, "wide: the links inline, no button");
  assert.match(css, /\.menu-head\{position:absolute;width:1px/, "wide: the group names stay for screen readers");
  assert.match(css, /@media \(max-width:600px\)\{[\s\S]*?\.top \.top-end\{display:none\}/, "a phone: Follow lives in the hero and the menu");
  assert.doesNotMatch(css, /\.top nav,\.top \.quiet\{display:none\}/, "the nav is no longer simply hidden on a phone");
  assert.match(read("site/performance/performance.js"), /initMenu\(\);/);
});
