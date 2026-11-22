// One look for every public page (the one-theme backlog, PR 1 and PR 2): each page in the theme stands on home.css
// alone, with the Performance page's header and the same footer, marks only its own links, and keeps the head's theme
// colour, font preloads and skip link. The pages that name a versioned file are the build's VERSIONED_PAGES; only the
// home page carries the war room and TradingView's quote. About, Disclaimer, Privacy and Terms keep every word they had
// (public content is final). Node built-ins only: CI runs the tests before npm ci.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { VERSIONED, VERSIONED_PAGES } from "../scripts/versions.mjs";
import { applyProfile, profileView, PROFILE_URL } from "../site/page/profile.js";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const THEME_PAGES = VERSIONED_PAGES;
const PATH = { "index.html": "/", "performance.html": "/performance", "archive.html": "/archive", "about.html": "/about", "disclaimer.html": "/disclaimer", "privacy.html": "/privacy", "terms.html": "/terms" };
// The pages ported from cta.css: the three legal pages (PR 1, prose) and About (PR 2, its own rules).
const LEGAL = ["disclaimer.html", "privacy.html", "terms.html"];
const PORTED = [...LEGAL, "about.html"];
const FOOT_NOTE = '<p class="foot-note"><span>Chart by TradingView</span><span>© Cryptophys · Education, not financial advice</span></p>';
const page = (f) => read(`public/${f}`);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const block = (html, open, close) => { const a = html.indexOf(open); assert.ok(a >= 0, open); return html.slice(a, html.indexOf(close, a) + close.length); };
const headerOf = (html) => block(html, "<header", "</header>");
const navOf = (html, label) => html.match(new RegExp(`<nav[^>]*aria-label="${label}">([\\s\\S]*?)</nav>`))?.[1] ?? null;
// The home page's own spellings of the same header and footer: its links are #x (it is "/"), its header carries the
// schema.org microdata and the panels' data-panel; a page's own link carries aria-current. None of these is a word.
const norm = (s) => s
  .replace(/ aria-current="(page|true)"/g, "")
  .replace(/ itemscope| itemtype="[^"]*"| itemprop="[^"]*"| data-panel="[^"]*"/g, "")
  .replace(/href="#/g, 'href="/#')
  .replace(/\?v=[0-9a-f]+"/g, '"');
const links = (inner) => [...norm(inner).matchAll(/<a ([^>]*)>([\s\S]*?)<\/a>/g)].map((m) => [m[1].match(/href="([^"]*)"/)[1], m[2]]);
const current = (html) => [...html.matchAll(/<a ([^>]*aria-current[^>]*)>/g)].map((m) => norm(m[1]).match(/href="([^"]*)"/)[1]);

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", minus: "−" };
const decode = (s) => s.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e) => (e[0] === "#" ? String.fromCodePoint(/^#x/i.test(e) ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e] ?? m));
/** Every word inside <main>, in order: tags removed, entities decoded, whitespace collapsed. */
const mainWords = (html) => { const a = html.indexOf("<main"); return decode(html.slice(html.indexOf(">", a) + 1, html.indexOf("</main>")).replace(/<[^>]*>/g, " ")).split(/\s+/).filter(Boolean).join(" "); };

test("TH1 one stylesheet, home.css with its hash, one script of the page's own; never cta.css or cta.js", () => {
  for (const f of THEME_PAGES) {
    assert.ok(PATH[f], `${f} has a path`);
    const html = page(f);
    const sheets = [...html.matchAll(/<link rel="stylesheet" href="([^"]*)">/g)].map((m) => m[1]);
    assert.equal(sheets.length, 1, `${f}: one stylesheet`);
    assert.match(sheets[0], /^\/home\.css\?v=[0-9a-f]{12}$/, `${f}: home.css named with its hash`);
    assert.equal((html.match(/<link[^>]*rel="stylesheet"/g) ?? []).length, 1, `${f}: no other stylesheet link`);
    assert.doesNotMatch(html, /cta\.(css|js)/, `${f}: not on the old look`);
    const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
    assert.equal(scripts.length, 1, `${f}: one script`);
    assert.match(scripts[0], /^<script type="module" src="\/(home|performance|archive|page)\.js\?v=[0-9a-f]{12}">$/, `${f}: its own module, with its hash`);
  }
  for (const f of PORTED) assert.match(page(f), /<script type="module" src="\/page\.js\?v=[0-9a-f]{12}"><\/script>\n<\/body>/, `${f}: the shared page script`);
});

test("TH2 the header is the Performance page's on every page (a page's own mark, the home's #x links and microdata aside)", () => {
  const perf = norm(headerOf(page("performance.html")));
  assert.match(perf, /<nav class="nav" aria-label="Main">/);
  for (const id of ["avg-strip", "clock-utc", "clock-local"]) assert.match(perf, new RegExp(`id="${id}"`), id);
  for (const f of THEME_PAGES) assert.equal(norm(headerOf(page(f))), perf, `${f}: the shared header`);
  for (const f of PORTED) assert.doesNotMatch(headerOf(page(f)), /aria-current/, `${f}: no header link is its own page`);
});

test("TH3 the Footer and Legal navs carry the same links on every page ('3D credits' on the home page only); Legal holds links only", () => {
  const perf = page("performance.html");
  const footer = links(navOf(perf, "Footer")), legal = links(navOf(perf, "Legal"));
  assert.deepEqual(footer.map(([, t]) => t), ["Minutes", "The cast", "How it works", "Performance", "Archive", "Disclaimer", "Threads", "Studio sign in"]);
  assert.deepEqual(legal, [["/privacy", "Privacy"], ["/about", "About the system"], ["/terms", "Terms"], ["/fonts/OFL.txt", "Font licences"]]);
  for (const f of THEME_PAGES) {
    const html = page(f);
    const foot = block(html, '<footer class="foot">', "</footer>");
    assert.match(foot, /^<footer class="foot">\n {2}<span>XAUUSD AI by Cryptophys<\/span>\n {2}<nav aria-label="Footer">/, `${f}: the footer's brand line`);
    assert.deepEqual(links(navOf(foot, "Footer")), footer, `${f}: the Footer nav`);
    const inner = navOf(foot, "Legal");
    assert.deepEqual(links(inner).filter(([, t]) => f !== "index.html" || t !== "3D credits"), legal, `${f}: the Legal nav`);
    if (f === "index.html") assert.deepEqual(links(inner).find(([, t]) => t === "3D credits"), ["/room/CREDITS.txt", "3D credits"]);
    assert.equal(inner.replace(/<a [^>]*>[^<]*<\/a>/g, "").trim(), "", `${f}: the Legal nav holds links only`);
  }
  // The chart credit and the copyright stay where they were (owner decision 2: the Archive and the pages that had them),
  // as words, under the Legal links.
  for (const f of ["archive.html", ...PORTED]) {
    const foot = block(page(f), '<footer class="foot">', "</footer>");
    assert.ok(foot.includes(`</nav>\n  ${FOOT_NOTE}\n</footer>`), `${f}: the foot note under the Legal nav`);
  }
  // The whole footer, markup and attributes, equals the Performance page's (review of #67): nothing between or after
  // the navs, no nested markup in a link, no extra attribute. Allowed: the foot note (Archive and the ported pages) and
  // the home page's 3D credits link; aria-current and ?v= are normalised away.
  const perfFoot = norm(block(perf, '<footer class="foot">', "</footer>"));
  for (const f of THEME_PAGES) {
    const foot = norm(block(page(f), '<footer class="foot">', "</footer>"))
      .replace(`\n  ${FOOT_NOTE}`, "")
      .replace(/\n {4}<a href="\/room\/CREDITS\.txt">3D credits<\/a>/, "");
    assert.equal(foot, perfFoot, `${f}: the shared footer`);
  }
});

test("TH4 aria-current marks only the page's own links: the footer's on every page but the home, the header's where the header names the page", () => {
  for (const f of THEME_PAGES) {
    const html = page(f), own = PATH[f];
    const marks = current(html);
    assert.ok(marks.every((href) => href === own), `${f}: only ${own} is marked (${marks.join(", ")})`);
    for (const m of html.matchAll(/aria-current="([^"]*)"/g)) assert.equal(m[1], "page", `${f}: aria-current="page"`);
    if (f === "index.html") { assert.deepEqual(marks, [], "the home page is marked by its script, from the hash"); continue; }
    const inNav = links(navOf(headerOf(html), "Main")).some(([href]) => href === own);
    assert.equal(marks.length, inNav ? 2 : 1, `${f}: the header (where it names the page) and the footer`);
    assert.deepEqual(current(block(html, '<footer class="foot">', "</footer>")), [own], `${f}: the footer marks it`);
  }
});

test("TH5 the head and the skip link: the vault's theme colour, two font preloads, a skip link first that reaches its target", () => {
  const fonts = new Set(readdirSync(new URL("../public/fonts/", import.meta.url)));
  for (const f of THEME_PAGES) {
    const html = page(f);
    assert.equal((html.match(/<meta name="theme-color" content="#060A12">/g) ?? []).length, 1, `${f}: theme-color`);
    const pre = [...html.matchAll(/<link rel="preload" href="\/fonts\/([^"]+)" as="font" type="font\/woff2" crossorigin>/g)].map((m) => m[1]);
    assert.equal(pre.length, 2, `${f}: two font preloads`);
    assert.ok(pre.includes("newsreader-latin-400-normal.woff2") && pre.some((p) => p.startsWith("rajdhani-latin-")), `${f}: the reading face and one display weight`);
    for (const p of pre) assert.ok(fonts.has(p), `${f}: ${p} is served`);
    assert.equal((html.match(/as="font"/g) ?? []).length, 2, `${f}: no other font preload`);
    // the first element of the body (the home page's microdata link and meta are not rendered) is the skip link
    const body = html.slice(html.indexOf(">", html.indexOf("<body")) + 1).replace(/^\s*(<(link|meta) [^>]*>\s*)*/, "");
    const skip = body.match(/^<a class="skip" href="#([^"]+)">([^<]+)<\/a>/);
    assert.ok(skip, `${f}: the skip link comes first`);
    assert.match(html, new RegExp(`<main [^>]*id="${skip[1]}"|<section [^>]*id="${skip[1]}"`), `${f}: its target #${skip[1]} exists`);
  }
  for (const f of PORTED) assert.ok(page(f).includes('<a class="skip" href="#text">Skip to the text</a>') && page(f).includes('<main class="page" id="text">'), f);
});

test("TH6 every page that names a versioned file is one of the build's VERSIONED_PAGES, so its hashes are rewritten", () => {
  const html = [];
  const walk = (dir) => { for (const n of readdirSync(new URL(`../public/${dir}`, import.meta.url))) { const p = `${dir}${n}`; if (statSync(new URL(`../public/${p}`, import.meta.url)).isDirectory()) walk(`${p}/`); else if (n.endsWith(".html")) html.push(p); } };
  walk("");
  assert.ok(html.includes("studio/index.html") && html.includes("signin.html") && html.includes("about.html"), "every page is read");
  for (const p of html) {
    const text = page(p);
    const named = VERSIONED.filter((f) => new RegExp(`(?:href|src)="/${esc(f)}(\\?[^"]*)?"`).test(text));
    if (named.length) assert.ok(VERSIONED_PAGES.includes(p), `${p} names ${named.join(", ")}: add it to VERSIONED_PAGES (scripts/versions.mjs)`);
  }
  for (const p of VERSIONED_PAGES) assert.ok(html.includes(p), `${p} exists`);
});

test("TH7 the war room and TradingView's quote are the home page's only: no #gold-live, frame, TradingView markup, home.js or /room/ elsewhere", () => {
  for (const f of THEME_PAGES.filter((p) => p !== "index.html")) {
    // the markup only: the words "Chart by TradingView" and "Charts are TradingView's" are the pages' own text
    const tags = (page(f).match(/<[^>]*>/g) ?? []).join("\n");
    assert.doesNotMatch(tags, /gold-live|<iframe|tradingview|home\.js|\/room\//i, `${f}: nothing of the home page's scene or quote`);
  }
  for (const f of PORTED) assert.doesNotMatch(page(f), /<iframe|tradingview\.com|gold-live|home\.js|\/room\//, f);
});

test("TH8 About, Disclaimer, Privacy and Terms keep every word: <main> and the title equal the PR base, word for word", () => {
  const base = JSON.parse(read("test/fixtures/legal-words.json"));
  assert.deepEqual(Object.keys(base.pages).sort(), [...PORTED].sort());
  assert.deepEqual(Object.keys(base.titles).sort(), [...PORTED].sort());
  for (const f of PORTED) {
    const html = page(f);
    assert.equal(mainWords(html), base.pages[f], `${f}: the words inside <main>`);
    assert.equal(html.match(/<title>([^<]*)<\/title>/)[1], base.titles[f], `${f}: the title`);
  }
  for (const f of LEGAL) {
    const html = page(f);
    // the shared look's parts: eyebrow, headline, lede, the date as .basis, the text as unfilled prose, the profile's line
    assert.match(html, /<main class="page" id="text">\n {2}<p class="eyebrow">[^<]+<\/p>\n {2}<h1>[^<]+<\/h1>\n {2}<p class="lede">[^<]+<\/p>/, f);
    assert.match(html, /<article class="prose">/, f);
    assert.match(html, /<p class="fine" id="disclaimer"><\/p>\n {2}<\/article>/, `${f}: the profile's disclaimer, hidden while empty`);
    assert.doesNotMatch(html, /class="(card|meta|pagehero|section|tag|topbar|site-foot)\b/, `${f}: none of the old look's classes`);
    if (/Last updated/.test(base.pages[f])) assert.match(html, /<p class="basis">Last updated [^<]+<\/p>/, `${f}: the date as the page's basis line`);
  }
  // the words a person sees on each page include the disclaimer (app.test) and the chart credit as before
  for (const f of PORTED) assert.match(page(f), /not financial advice/i);
});

test("TH9 page.js: built from site/page, imports only the header, the strip, the record's URL and the profile; kept a year", () => {
  const b = JSON.parse(read("public/room/build.json"));
  assert.equal(b.page, createHash("sha256").update(readFileSync(new URL("../public/page.js", import.meta.url))).digest("hex"), "run npm run build:room");
  const allowed = new Set(["../home/header.js", "../home/avg-strip.js", "../home/track.js", "./profile.js"]);
  for (const n of readdirSync(new URL("../site/page/", import.meta.url)).filter((x) => x.endsWith(".js"))) {
    const src = read(`site/page/${n}`);
    for (const m of src.matchAll(/^\s*import\b[^'"]*['"]([^'"]+)['"]/gm)) assert.ok(allowed.has(m[1]), `site/page/${n} imports ${m[1]}`);
    assert.doesNotMatch(src, /\bimport\(|site\/room|\.\.\/room\/|home\.js|gold\.js/, `site/page/${n}: never the war room, home.js or gold.js`);
  }
  assert.doesNotMatch(read("site/page/profile.js"), /\bfetch\(|^\s*document\./m, "profile.js is pure: no request, no page touched on import");
  assert.doesNotMatch(read("public/page.js"), /room\.js|mannequin|tradingview|warroom-scene|gold-live|import\(/i, "the bundle carries none of the scene or the quote");
  assert.equal((read("site/page/page.js").match(/\bfetch\(/g) ?? []).length, 1, "one fetch helper");
  assert.match(read("site/page/page.js"), /json\(PROFILE_URL\)/, "one GET of the profile");
  assert.equal(PROFILE_URL, "/api/public/profile");
  assert.ok(VERSIONED.includes("page.js"));
  const h = read("public/_headers").split("\n");
  assert.equal(h[h.indexOf("/page.js") + 1].trim(), "Cache-Control: public, max-age=31536000, immutable");
});

test("TH10 applyProfile: the Threads links from Threads' own host only, the disclaimer's text; nothing changes without an answer", () => {
  const fake = () => {
    const a = [{ href: "https://www.threads.net/@cryptophys.adm" }, { href: "https://www.threads.net/@cryptophys.adm" }];
    const box = { textContent: "" };
    return { a, box, doc: { querySelectorAll: (s) => (s === "[data-threads]" ? a : []), getElementById: (id) => (id === "disclaimer" ? box : null) } };
  };
  const p = { brand: { disclaimer: "Education, not financial advice." }, links: [{ channel: "x", url: "https://x.com/a" }, { channel: "threads", url: "https://www.threads.com/@cryptophys.adm" }] };
  const one = fake();
  assert.deepEqual(applyProfile(p, one.doc), { threads: "https://www.threads.com/@cryptophys.adm", disclaimer: "Education, not financial advice." });
  assert.deepEqual(one.a.map((x) => x.href), ["https://www.threads.com/@cryptophys.adm", "https://www.threads.com/@cryptophys.adm"]);
  assert.equal(one.box.textContent, "Education, not financial advice.");
  for (const bad of [null, undefined, {}, { links: "x" }, { brand: { disclaimer: "  " }, links: [{ channel: "threads", url: "https://evil.example/@x" }] }, { links: [{ channel: "threads", url: "javascript:alert(1)" }] }]) {
    const two = fake();
    assert.deepEqual(applyProfile(bad, two.doc), { threads: null, disclaimer: null });
    assert.deepEqual(two.a.map((x) => x.href), ["https://www.threads.net/@cryptophys.adm", "https://www.threads.net/@cryptophys.adm"], "the page's own link stays");
    assert.equal(two.box.textContent, "", "the line stays empty (and hidden: .fine:empty)");
  }
  assert.deepEqual(profileView({ links: [{ channel: "threads", url: "https://www.threads.net/@a" }] }), { threads: "https://www.threads.net/@a", disclaimer: null });
  const none = { querySelectorAll: () => [], getElementById: () => null };
  assert.doesNotThrow(() => applyProfile(p, none), "a page without the elements");
});

test("TH11 the shared rules: prose without a panel, the date line, an empty profile line hidden, the footer's own link, long words wrap", () => {
  const css = read("public/home.css");
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1].trim(), m[2]]);
  const prose = rules.filter(([sel]) => /\.prose\b/.test(sel));
  assert.ok(prose.length >= 4, "the prose rules");
  for (const [sel, body] of prose) assert.doesNotMatch(body, /background|box-shadow|border:/, `${sel}: no fill, no shadow, no panel`);
  assert.match(css, /\.page \.prose h2\{[^}]*font-size:var\(--s2\)/, "the prose's headings at --s2");
  assert.match(css, /\.page \.prose\{[^}]*max-width:38em/, "the measure");
  assert.match(css, /\.page \.prose p\{line-height:1\.7;/, "the reading rhythm");
  assert.match(css, /\.page \.basis\{/, "the date line");
  assert.match(css, /\.page \.fine:empty\{display:none\}/);
  assert.match(css, /\.foot a\[aria-current\]\{color:var\(--ink\)\}/);
  assert.match(css, /\.page\{overflow-wrap:break-word\}/);
  assert.match(css, /\.foot \.foot-note\{width:100%;display:flex;flex-wrap:wrap;/);
  // the short wide window's lede step is the hero's only: the other pages' ledes keep line height 1.72
  const short = css.slice(css.indexOf("@media (min-width:901px) and (max-height:720px){"), css.indexOf("\n}\n", css.indexOf("@media (min-width:901px) and (max-height:720px){")));
  assert.match(short, /\n {2}\.hero \.lede\{margin-top:20px;line-height:1\.6\}/);
  assert.doesNotMatch(short, /\n {2}\.lede\{/, "no unscoped lede rule there");
  assert.match(css, /\n\.lede\{margin-top:28px;font-size:var\(--s1\);line-height:1\.72;/, "the lede's rhythm");
});

test("TH12 About (PR 2): every part keeps its words, the steps are h2 under the h1, the headings never skip a level", () => {
  const html = page("about.html"), base = JSON.parse(read("test/fixtures/legal-words.json"));
  const main = html.slice(html.indexOf("<main"), html.indexOf("</main>"));
  const text = (s) => decode(s.replace(/<[^>]*>/g, " ")).split(/\s+/).filter(Boolean).join(" ");
  const all = (re, from = main) => [...from.matchAll(re)].map((m) => text(m[1]));
  assert.equal(html.match(/<title>([^<]*)<\/title>/)[1], "How it works · XAUUSD AI · Cryptophys");
  assert.match(main, /^<main class="page" id="text">\n {2}<p class="eyebrow">How it works<\/p>\n {2}<h1>From analysis to a post<\/h1>\n {2}<p class="lede">[^<]+<\/p>/);
  // the five steps: the number, the step's heading (h2, was h3: markup, not words) and its text
  const steps = block(main, '<ol class="a-steps">', "</ol>");
  const items = [...steps.matchAll(/<li><span class="num">(\d)<\/span><div><h2>([^<]+)<\/h2><p>([\s\S]*?)<\/p><\/div><\/li>/g)];
  assert.deepEqual(items.map((m) => m[1]), ["1", "2", "3", "4", "5"], "five numbered steps");
  assert.deepEqual(items.map((m) => m[2]), ["The system reads the market", "A draft from a fixed template", "Automatic checks", "A person approves", "Published on each channel's schedule"]);
  assert.doesNotMatch(steps, /<h3/, "the steps' headings are h2");
  assert.deepEqual(all(/<section class="a-sec" aria-labelledby="[^"]+">\n {4}<h2 id="[^"]+">([^<]+)<\/h2>/g), ["What each post type means", "What we never post"], "the two sections");
  for (const m of main.matchAll(/aria-labelledby="([^"]+)"/g)) assert.match(main, new RegExp(`<h2 id="${m[1]}">`), `#${m[1]} names its section`);
  const types = block(main, '<div class="types">', "\n    </div>");
  assert.deepEqual(all(/<h3>([^<]+)<\/h3>/g, types), ["Key-level map", "Chart pattern", "Daily recap"], "the three post types");
  assert.equal((types.match(/<p>/g) ?? []).length, 3);
  assert.equal(all(/<li>([^<]+)<\/li>/g, block(main, '<ul class="never">', "</ul>")).length, 5, "the five lines we never post");
  assert.match(main, /<div class="a-note" role="note">\n {4}<b>Education, not financial advice<\/b>\n {4}<p><span id="disclaimer">[^<]+<\/span> <a href="\/disclaimer">Read the full disclaimer<\/a><\/p>\n {2}<\/div>\n$/, "the note, with the profile's disclaimer");
  // the parts, in order, are the page's words at the PR base, word for word
  const parts = [
    ...all(/<p class="eyebrow">([^<]+)<\/p>/g), ...all(/<h1>([^<]+)<\/h1>/g), ...all(/<p class="lede">([^<]+)<\/p>/g),
    ...items.flatMap((m) => [m[1], m[2], text(m[3])]),
    "What each post type means", ...[...types.matchAll(/<h3>([^<]+)<\/h3><p>([\s\S]*?)<\/p>/g)].flatMap((m) => [m[1], text(m[2])]),
    "What we never post", ...all(/<li>([^<]+)<\/li>/g, block(main, '<ul class="never">', "</ul>")),
    text(block(main, '<div class="a-note"', "</div>"))
  ];
  assert.equal(parts.join(" "), base.pages["about.html"], "the words inside <main>, part by part");
  // the footer's two strings stay (owner decision 2), as words under the Legal links
  for (const s of ["<span>Chart by TradingView</span>", "<span>© Cryptophys · Education, not financial advice</span>"]) assert.ok(block(html, '<footer class="foot">', "</footer>").includes(s), s);
  // heading order: one h1 first, and no heading deeper than one level below the one before it
  const levels = [...html.matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]));
  assert.deepEqual(levels, [1, 2, 2, 2, 2, 2, 2, 3, 3, 3, 2]);
  assert.equal(levels.filter((l) => l === 1).length, 1);
  levels.reduce((prev, l) => { assert.ok(l <= prev + 1, `h${l} after h${prev}`); return l; });
  const classes = new Set([...html.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/)));
  for (const c of ["steps", "card", "grid", "three", "hero-card", "meta-p", "notice", "info", "disclaimer", "pagehero", "section", "head", "tag", "topbar", "site-foot", "in", "narrow", "on", "public", "logo"]) assert.ok(!classes.has(c), `no class "${c}": none of the old look's classes, nor the home page's .steps`);
  assert.doesNotMatch(html, /#0866FF|<svg[^>]*class="logo"/i, "nothing of cta.css's blue or its logo");
});

test("TH13 About's own rules: the numbered steps, the sections, three post types (one column on a phone), the never list's marker; no panel, no reading colours", () => {
  const css = read("public/home.css");
  const at = css.indexOf("/* ---------- About (the one-theme backlog, PR 2)");
  assert.ok(at > 0, "the About block");
  const about = css.slice(at);
  const rules = [...about.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1].trim().replace(/^\/\*[\s\S]*?\*\/\s*/, ""), m[2]]);
  const rule = (sel) => rules.filter(([s]) => s === sel).map(([, b]) => b);
  for (const [sel, body] of rules) {
    assert.match(sel, /^(\.page \.(a-steps|a-sec|types|never)\b|@media)/, `${sel}: About's own classes, under .page`);
    assert.doesNotMatch(body, /background:(?!var\(--(rule|slate)\))|box-shadow|--bear|--bull|--flat|#F2606E|#3FD08A|#E0A458|#0866FF/i, `${sel}: no panel, no reading colour`);
  }
  assert.match(rule(".page .a-steps .num")[0], /font:600 var\(--s5\)\/1 var\(--display\);color:var\(--gold\)/, "the step numbers: Rajdhani 600 (preloaded, TH19), --s5, gold");
  assert.match(rule(".page .a-steps h2")[0], /font-size:var\(--s1\)/, "the step headings at --s1");
  assert.match(rule(".page .a-sec>h2")[0], /font-size:var\(--s3\)/, "the section headings at --s3");
  assert.match(rule(".page .types")[0], /display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/, "three columns");
  const phone = about.slice(about.indexOf("@media (max-width:760px){"));
  assert.match(phone, /\.page \.types\{grid-template-columns:1fr;/, "one column at 760 px and narrower");
  assert.match(rule(".page .never li::before")[0], /content:"";/, "the never list's marker");
  assert.match(css, /\n\.steps\{list-style:none;counter-reset:step;margin:48px 0 0;padding:0;display:grid;grid-template-columns:repeat\(3,1fr\);/, "the home page's #how grid is untouched");
  assert.doesNotMatch(css, /\.page \.steps|\.a-steps[^{]*\.steps/, "About never borrows .steps");
  assert.match(page("index.html"), /<ol class="steps">/, "the home page keeps its .steps");
});

// ---------- PR 3 (C1 to C5, and two follow-ups to About from the review of #68) ----------
const cssRules = (css) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1].trim().replace(/^(\/\*[\s\S]*?\*\/\s*)+/, ""), m[2]]);
/** The body of the @media block that opens with `head` (one level of nesting). */
const mediaBlock = (css, head) => { const a = css.indexOf(`${head}{`); assert.ok(a >= 0, head); const end = css.indexOf("\n}\n", a); return css.slice(a + head.length + 1, end); };

test("TH14 Performance without layout shift (C1): the record is preloaded, its box holds the drawn table's height while it loads, a plain fetch", async () => {
  const { TRACK_URL } = await import("../site/home/track.js");
  const html = page("performance.html"), src = read("site/performance/performance.js"), css = read("public/home.css");
  assert.equal(TRACK_URL, "/api/public/track-record");
  // the preload names the very URL the script asks for, before the stylesheet
  assert.match(html, /<link rel="preload" href="\/api\/public\/track-record" as="fetch" crossorigin>\n(<link rel="preload" [^>]*as="font"[^>]*>\n){2}<link rel="stylesheet"/);
  assert.match(src, /\nfetch\(TRACK_URL\)\n/, "a plain fetch of the preloaded URL (no header, so the preload is used)");
  assert.doesNotMatch(src, /fetch\(TRACK_URL,/);
  // a visible box, busy while loading, around the empty line and the table; the table is laid out (unseen) from the start
  assert.match(html, /\n {2}<div class="track-box" id="track-box" aria-busy="true">\n {4}<p class="empty" id="track-empty" hidden><\/p>\n {4}<div id="track-body">\n/);
  assert.doesNotMatch(block(html, '<div class="track-box"', '\n  </div>\n'), /id="track-body" hidden/, "the table is not display:none while loading");
  assert.match(css, /\n\.track-box\{display:flow-root\}\n/, "the box is shown and contains its children's margins");
  assert.match(css, /\n\.track-box\[aria-busy="true"\] #track-body\{visibility:hidden\}\n/, "unseen while loading, yet taking its room");
  // the rows' height while loading: the drawn table's (desktop, each band of the pending note's wrapping) and the phone's rows and counts
  const held = [...css.matchAll(/\.track-box\[aria-busy="true"\] \.track\{height:(\d+)px\}/g)].map((m) => Number(m[1]));
  assert.deepEqual(held, [398, 421, 444, 467], "the table held at its drawn height from 761 px up");
  const phone = mediaBlock(css, "/* a phone: the table becomes label and value rows */\n@media (max-width:760px)");
  assert.match(phone, /\.track-box\[aria-busy="true"\] \.track\{height:auto\}/);
  assert.match(phone, /\.track-box\[aria-busy="true"\] \.bases\{min-height:77px\}/);
  assert.match(phone, /\.track-box\[aria-busy="true"\] #track-rows\{min-height:723px\}/);
  // drawn: the held height is read before the drawing and kept as the box's floor, then the box is no longer busy
  const done = src.slice(src.indexOf(".then((body) => {"));
  const order = ["getBoundingClientRect().height", "draw(body)", "box.style.minHeight = `${held}px`", "removeAttribute('aria-busy')"].map((s) => done.indexOf(s));
  assert.ok(order.every((i, k) => i > 0 && (k === 0 || i > order[k - 1])), `the floor is read before the drawing (${order})`);
  assert.match(src, /\$\('track-body'\)\.hidden = true;/, "without a record the table stays hidden (the empty line shows)");
});

test("TH15 forced colours (C2): the page's own link underlined, focus in Highlight, only the selected tab ruled, pressed chips and the reading's marks kept", () => {
  const css = read("public/home.css");
  const fc = mediaBlock(css, "@media (forced-colors:active)");
  const rule = (sel) => cssRules(fc).find(([s]) => s === sel)?.[1] ?? "";
  assert.match(rule(".nav a[aria-current],.foot a[aria-current]"), /text-decoration:underline/, "aria-current: the header's mark is a box shadow, which forced colours drop");
  assert.match(css, /\.nav a\[aria-current\]\{[^}]*box-shadow:inset/, "(the shadow the underline stands in for)");
  assert.match(rule(":focus-visible"), /outline:2px solid Highlight/);
  assert.match(rule(".kinds button,.rooms button"), /border-bottom-color:Canvas/, "the tabs not chosen carry no rule");
  assert.match(rule('.kinds button[aria-selected="true"],.rooms button[aria-selected="true"]'), /border-bottom-color:Highlight/, "the chosen tab does");
  assert.match(rule('.chip[aria-pressed="true"]'), /forced-color-adjust:none;background:Highlight;color:HighlightText/, "a pressed chip's fill");
  assert.match(rule(".status-reading .tick,.tally b"), /forced-color-adjust:none;background:CanvasText/, "the stance tick and the tally's bars are fills: kept as bars");
  // About's never list: the dash is a border (kept by forced colours), not a fill (repainted to Canvas) — review of #68
  const never = cssRules(css).find(([s]) => s === ".page .never li::before")[1];
  assert.match(never, /height:0;border-top:2px solid var\(--slate\)/);
  assert.doesNotMatch(never, /background/, "no fill for the marker");
});

test("TH16 the shared profile (C3): Performance and the Archive write the Threads links and the disclaimer through applyProfile, not their own code", () => {
  for (const f of ["site/performance/performance.js", "site/archive/archive.js"]) {
    const src = read(f);
    assert.match(src, /^import \{ applyProfile, PROFILE_URL \} from '\.\.\/page\/profile\.js';$/m, `${f}: the shared profile`);
    assert.match(src, /applyProfile\(p\)/, `${f}: applied`);
    assert.match(src, /\(PROFILE_URL\)/, `${f}: one GET of the profile`);
    assert.doesNotMatch(src, /threads\\?\.\(net\|com\)|data-threads|brand\?\.disclaimer|'\/api\/public\/profile'/, `${f}: no copy of applyProfile's work`);
  }
  // the bundles carry it: the Threads host check of profile.js and the profile's URL
  for (const f of ["public/performance.js", "public/archive.js"]) {
    const js = read(f);
    assert.ok(js.includes("/api/public/profile") && js.includes("[data-threads]") && /threads\\\.\(net\|com\)/.test(js), `${f}: built with applyProfile`);
  }
  // the Archive still names each post's channel from the profile's links
  assert.match(read("site/archive/archive.js"), /state\.label\[l\.channel\] = l\.label/);
});

test("TH17 the Archive's tabs (C4): a roving tabindex on the tablist, the panel focusable and labelled by its tab, each day by its heading", () => {
  const html = page("archive.html"), src = read("site/archive/archive.js");
  assert.match(html, /<div class="kinds" id="kinds" role="tablist" aria-label="Kind of post"><\/div>/);
  assert.match(html, /<div class="a-list" id="archive" role="tabpanel" aria-labelledby="kind-all" tabindex="0" aria-busy="true"><\/div>/, "the panel, labelled by All posts before the tabs are drawn");
  assert.match(src, /const TAB_ID = \(k\) => `kind-\$\{k \|\| 'all'\}`;/, "kind-all is the All posts tab's id");
  assert.match(src, /b\.tabIndex = t\.selected \? 0 : -1;/, "one tab in the tab order: the selected one");
  assert.match(src, /\$\('archive'\)\.setAttribute\('aria-labelledby', TAB_ID\(state\.kind\)\)/);
  assert.match(src, /h2\.id = `day-\$\{i\}`;\n {4}sec\.setAttribute\('aria-labelledby', h2\.id\);/, "a day is labelled by its own h2");
  assert.doesNotMatch(src, /setAttribute\('aria-label', d\.day\)/);
  assert.match(read("public/home.css"), /\n\.a-list:focus-visible\{outline-offset:8px\}\n/);
});

test("TH18 the header fits (C5) and its links are 44 px on a phone (C4b): two rows from 760 px down, under 100 px tall", () => {
  const css = read("public/home.css");
  // The header wraps to two rows only in this block, and the block reaches 760 px: from 601 to about 752 px the four links
  // ran under the clock in one row (headless sweep in the PR).
  const wraps = [...css.matchAll(/@media \(max-width:(\d+)px\)\{(?:(?!\n\}\n)[\s\S])*?\n {2}\.top\{flex-wrap:wrap;/g)].map((m) => Number(m[1]));
  assert.deepEqual(wraps, [760], "one breakpoint puts the header on two rows");
  assert.ok(wraps[0] >= 760, "the two rows reach at least 760 px");
  const two = mediaBlock(css, "@media (max-width:760px)");
  assert.match(two, /\n {2}\.nav\{order:5;flex:1 0 100%;/, "the links on their own row");
  assert.match(two, /\n {2}\.top-clock\{margin-left:auto\}/, "the clock at the first row's end, clear of the links");
  // every rule for the header's links keeps a 44 px target
  for (const [sel, body] of cssRules(css).filter(([s]) => /(^|,)\s*\.nav a\s*(,|$)/.test(s))) {
    const h = body.match(/min-height:(\d+)px/);
    if (h) assert.ok(Number(h[1]) >= 44, `${sel}: min-height ${h[1]}px`);
  }
  assert.match(two, /\.nav a\{[^}]*min-height:44px/);
  // two rows: 6 px above, the brand's and the links' 44 px rows, 2 px below, the 1 px rule, under the 100 px of --top
  const top = two.match(/\.top\{[^}]*padding-top:(\d+)px;padding-bottom:(\d+)px\}/);
  assert.ok(top, "the two rows' padding");
  assert.ok(Number(top[1]) + 44 + 44 + Number(top[2]) + 1 < 100, "under 100 px");
  assert.match(two, /:root\{--top:100px\}/);
});

test("TH19 About's step numbers use a preloaded weight (review of #68: Rajdhani 700 swapped in late and moved them)", () => {
  const css = read("public/home.css"), html = page("about.html");
  const num = cssRules(css).find(([s]) => s === ".page .a-steps .num")[1];
  const weight = Number(num.match(/font:(\d+) /)[1]);
  const preloaded = [...html.matchAll(/<link rel="preload" href="\/fonts\/rajdhani-latin-(\d+)-normal\.woff2"/g)].map((m) => Number(m[1]));
  assert.deepEqual(preloaded, [600]);
  assert.ok(preloaded.includes(weight), `the numbers' weight ${weight} is preloaded`);
  assert.equal(weight, 600);
});
