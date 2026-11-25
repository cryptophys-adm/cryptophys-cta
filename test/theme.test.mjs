// One look for every public page (the one-theme backlog, PR 1 to PR 4): each page in the theme stands on home.css
// alone, with the Performance page's header and the same footer, marks only its own links, and keeps the head's theme
// colour, font preloads and skip link. The pages that name a versioned file are the build's VERSIONED_PAGES; only the
// home page carries the war room and TradingView's quote. About, Disclaimer, Privacy, Terms and Sign in keep every word
// they had (public content is final). Node built-ins only: CI runs the tests before npm ci.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { VERSIONED, VERSIONED_PAGES } from "../scripts/versions.mjs";
import { applyProfile, profileView, PROFILE_URL } from "../site/page/profile.js";
import { ANSWERS, layoutHash, fromRuns } from "../scripts/track-heights.mjs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const THEME_PAGES = VERSIONED_PAGES;
const PATH = { "index.html": "/", "performance.html": "/performance", "archive.html": "/archive", "about.html": "/about", "disclaimer.html": "/disclaimer", "privacy.html": "/privacy", "terms.html": "/terms", "signin.html": "/signin" };
// The pages ported from cta.css: the three legal pages (PR 1, prose), About (PR 2, its own rules) and Sign in (PR 4,
// also the studio's 403 page).
const LEGAL = ["disclaimer.html", "privacy.html", "terms.html"];
const PORTED = [...LEGAL, "about.html", "signin.html"];
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

test("TH4 aria-current marks only the page's own links: the footer's on every page but the home, the header's where the header names the page; nothing where no nav names the page (Sign in)", () => {
  for (const f of THEME_PAGES) {
    const html = page(f), own = PATH[f];
    const marks = current(html);
    assert.ok(marks.every((href) => href === own), `${f}: only ${own} is marked (${marks.join(", ")})`);
    for (const m of html.matchAll(/aria-current="([^"]*)"/g)) assert.equal(m[1], "page", `${f}: aria-current="page"`);
    if (f === "index.html") { assert.deepEqual(marks, [], "the home page is marked by its script, from the hash"); continue; }
    const inNav = links(navOf(headerOf(html), "Main")).some(([href]) => href === own);
    const foot = block(html, '<footer class="foot">', "</footer>");
    const inFoot = [...links(navOf(foot, "Footer")), ...links(navOf(foot, "Legal"))].some(([href]) => href === own);
    if (!inNav && !inFoot) { assert.deepEqual(marks, [], `${f}: no nav names ${own}, so no link is marked`); continue; }
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

test("TH8 About, Disclaimer, Privacy, Terms and Sign in keep every word: <main> and the title equal the PR base, word for word", () => {
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

test("TH9 page.js: built from site/page, imports only the header, the strip, the record's URL and its minute reader, and the profile; kept a year", () => {
  const b = JSON.parse(read("public/room/build.json"));
  assert.equal(b.page, createHash("sha256").update(readFileSync(new URL("../public/page.js", import.meta.url))).digest("hex"), "run npm run build:room");
  const allowed = new Set(["../home/header.js", "../home/avg-strip.js", "../home/track.js", "../home/live.js", "./profile.js"]);
  // The minute reader (owner 2026-11-25: "harus realtime") brings only the record's URL and check with it.
  assert.deepEqual([...read("site/home/live.js").matchAll(/^\s*import\b[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]), ["./track.js"]);
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
  assert.deepEqual(items.map((m) => m[2]), ["The system reads the market", "A draft from a fixed template", "Automatic checks", "A person approves, or sets the rule", "Published on each channel's schedule"], "step 4 as the owner approved (2026-11-25, auto-approve)");
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

test("TH14 Performance without layout shift (C1; review of #69): the record is preloaded, its box holds the drawn shape's height while it loads, then holds nothing", async () => {
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
  // without a script the record never comes: the table is not laid out, so no room is held under "Loading the record."
  assert.match(css, /\n@media \(scripting:none\)\{\.track-box\[aria-busy="true"\] #track-body\{display:none\}\}\n/);
  // from 761 px the columns have fixed widths, so a pending managed exit's note does not widen its column and wrap the
  // others: both shapes draw one table height (397.72 px, TH20), held while loading, with no band per wrap of the note
  assert.match(css, /\n@media \(min-width:761px\)\{\n {2}\.track\{table-layout:fixed\}\n {2}\.track thead th:first-child\{width:24%\}\n\}\n/);
  const held = [...css.matchAll(/\.track-box\[aria-busy="true"\] \.track\{height:([\d.]+)px\}/g)].map((m) => Number(m[1]));
  assert.deepEqual(held, [397.72], "one held table height from 761 px up");
  // a phone: the pending managed exit's rows and column counts (the record's shape today, and the shorter one)
  const phone = mediaBlock(css, "/* a phone: the table becomes label and value rows */\n@media (max-width:760px)");
  assert.match(phone, /\.track-box\[aria-busy="true"\] \.track\{height:auto\}/);
  assert.match(phone, /\.track-box\[aria-busy="true"\] \.bases\{min-height:51px\}/);
  assert.match(phone, /\.track-box\[aria-busy="true"\] #track-rows\{min-height:608\.2px\}/);
  assert.match(css, /\n@media \(max-width:470px\)\{\.track-box\[aria-busy="true"\] #track-rows\{min-height:633\.7px\}\}\n/, "the pending note on two lines");
  // drawn: then no longer busy, in the same task, and no floor kept (a floor left the drawn record over a screen of blank)
  const done = src.slice(src.indexOf(".then((body) => {"));
  const order = ["draw(body)", "renderAvgStrip(body)", "removeAttribute('aria-busy')"].map((s) => done.indexOf(s));
  assert.ok(order.every((i, k) => i > 0 && (k === 0 || i > order[k - 1])), `drawn, then no longer busy (${order})`);
  assert.doesNotMatch(src, /minHeight|min-height|getBoundingClientRect|addEventListener\('resize'/, "no floor, nothing measured, nothing released on a resize");
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
  // the stance tick and the tally's bars are fills: kept as bars. Each tone class is named in the block, so the theme's
  // .status-reading .tick.bear (0,3,0) and .tally .bear (0,2,0) do not outrank the bar and keep a theme colour that reads
  // 3.15:1 or less on a white Canvas (review of #69)
  const BAR = ".status-reading .tick,.status-reading .tick.bear,.status-reading .tick.bull,.tally b,.tally .bear,.tally .bull,.tally .flat";
  assert.match(rule(BAR), /^forced-color-adjust:none;background:CanvasText$/);
  // every theme rule that colours a tick or a tally bar has a bar here with its classes and at least its specificity
  // (classes only: the block comes later, so a tie wins)
  const classes = (sel) => sel.match(/\.[\w-]+/g) ?? [];
  const theme = cssRules(css.slice(0, css.indexOf("@media (forced-colors:active)"))).filter(([, body]) => /background:var\(--(bear|bull|flat)\)/.test(body));
  const marks = theme.flatMap(([sel]) => sel.split(",")).filter((sel) => /\.(tick|tally)\b/.test(sel));
  assert.ok(marks.length >= 6, `the theme's coloured marks (${marks})`);
  for (const sel of marks) {
    assert.doesNotMatch(sel, /#|\[/, `${sel}: classes only`);
    assert.ok(BAR.split(",").some((bar) => classes(sel).every((c) => classes(bar).includes(c)) && classes(bar).length >= classes(sel).length), `${sel}: a forced-colours bar as specific, later`);
  }
  // About's never list: the dash is a border (kept by forced colours), not a fill (repainted to Canvas) — review of #68
  const never = cssRules(css).find(([s]) => s === ".page .never li::before")[1];
  assert.match(never, /height:0;border-top:2px solid var\(--slate\)/);
  assert.doesNotMatch(never, /background/, "no fill for the marker");
});

test("TH16 the shared profile (C3): Performance writes the Threads links, the Archive the Threads links and the disclaimer, through applyProfile, not their own code", () => {
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
  // before the tabs are drawn, and without a script, the panel is neither a tab stop nor named after a tab that is not
  // there (review of #69): drawTabs() makes it both
  assert.match(html, /<div class="a-list" id="archive" role="tabpanel" aria-busy="true"><\/div>/, "no tabindex, no aria-labelledby in the page");
  assert.match(src, /const TAB_ID = \(k\) => `kind-\$\{k \|\| 'all'\}`;/, "kind-all is the All posts tab's id");
  assert.match(src, /b\.tabIndex = t\.selected \? 0 : -1;/, "one tab in the tab order: the selected one");
  const draw = src.slice(src.indexOf("function drawTabs() {"), src.indexOf("\n}\n", src.indexOf("function drawTabs() {")));
  assert.match(draw, /\n {2}\$\('archive'\)\.setAttribute\('aria-labelledby', TAB_ID\(state\.kind\)\);\n {2}\$\('archive'\)\.tabIndex = 0;$/, "labelled and focusable once the tabs exist");
  assert.equal([...src.matchAll(/\$\('archive'\)\.(tabIndex|setAttribute\('aria-labelledby')/g)].length, 2, "only there");
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

test("TH20 the record draws at the room held for it (review of #69): pending and shown never more than 2 px shorter, pending at it, 320 to 1600 px", async () => {
  // test/fixtures/track-heights.json: the box's height at every width while the record loads and once each answer is
  // drawn, measured in headless Chromium by scripts/track-heights.mjs from the layout as it is now (a change to the
  // Performance rules, the page's <main>, its script or trackModel needs a new measure)
  const { trackModel } = await import("../site/home/track.js");
  const f = JSON.parse(read("test/fixtures/track-heights.json"));
  assert.equal(f.layout, layoutHash(), "measured from the current layout: run scripts/track-heights.mjs");
  // the answers measured: the live record with the managed exit pending, the same with it shown, and no record
  assert.deepEqual(trackModel(ANSWERS.pending).columns.map((c) => c.shown), [true, true, false]);
  assert.deepEqual(trackModel(ANSWERS.shown).columns.map((c) => c.shown), [true, true, true]);
  assert.equal(trackModel(ANSWERS.none).available, false);
  const held = fromRuns(f.held), pending = fromRuns(f.pending), shown = fromRuns(f.shown), none = fromRuns(f.none);
  for (let w = 320; w <= 1600; w++) {
    for (const [name, m] of [["pending", pending], ["shown", shown]]) {
      assert.ok(m.get(w) >= held.get(w) - 2, `${w} px, ${name}: drawn ${m.get(w)} under the ${held.get(w)} held (a gap below the record)`);
    }
    assert.ok(Math.abs(pending.get(w) - held.get(w)) <= 1, `${w} px: the live shape draws at the room held (${pending.get(w)} vs ${held.get(w)})`);
    // the table's two shapes are one height from 761 px up, where the page below is in view
    if (w > 760) assert.ok(Math.abs(shown.get(w) - held.get(w)) <= 1, `${w} px: shown at the room held`);
    // no record: one line, so the page below moves up once (the shrink the review accepts, rather than a screen of blank)
    assert.ok(none.get(w) < 100, `${w} px: no record is one line (${none.get(w)})`);
  }
});

// ---------- PR 4 (D1, owner decision 4: Sign in in the dark look; E2's sign-in rules leave cta.css) ----------
const CTA_RULE_CLASSES = (css) => new Set([...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{/g)].map((m) => m[1].trim()).filter((s) => !s.startsWith("@")).flatMap((s) => [...s.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1])));
// The rules of a stylesheet with their @-contexts ("@media (max-width:600px)"), comments removed: [context, selector, body].
const rulesOf = (text) => { const out = [], ctx = []; let buf = ""; for (const ch of text.replace(/\/\*[\s\S]*?\*\//g, "")) { if (ch === "{") { ctx.push(buf.trim()); buf = ""; } else if (ch === "}") { const sel = ctx.pop(); if (buf.trim()) out.push([ctx.join(" "), sel, buf.trim()]); buf = ""; } else buf += ch; } return out; };
// A page's elements (review of #70): enough of an HTML parser for our own pages, to ask which CSS rules can match an element.
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const domOf = (html) => {
  const root = { tag: "#root", attrs: {}, classes: [], children: [], parent: null };
  let cur = root;
  for (const m of html.replace(/<!--[\s\S]*?-->/g, "").matchAll(/<(\/?)([a-zA-Z][\w-]*)((?:\s+[^\s=>/]+(?:="[^"]*")?)*)\s*(\/?)>/g)) {
    const tag = m[2].toLowerCase();
    if (m[1]) { let n = cur; while (n && n.tag !== tag) n = n.parent; assert.ok(n, `</${tag}> closes nothing`); cur = n.parent; continue; }
    const attrs = Object.fromEntries([...m[3].matchAll(/([^\s=]+)(?:="([^"]*)")?/g)].map((a) => [a[1], a[2] ?? ""]));
    const el = { tag, attrs, classes: (attrs.class ?? "").split(/\s+/).filter(Boolean), children: [], parent: cur };
    cur.children.push(el);
    if (!m[4] && !VOID.has(tag)) cur = el;
  }
  return root;
};
const allOf = (n) => [n, ...n.children.flatMap(allOf)];
const splitTop = (s, sep) => { const out = []; let depth = 0, buf = ""; for (const ch of s) { if (ch === "(" || ch === "[") depth++; if (ch === ")" || ch === "]") depth--; if (ch === sep && depth === 0) { out.push(buf.trim()); buf = ""; } else buf += ch; } out.push(buf.trim()); return out; };
// A selector as compounds and the combinators between them: ".page .gate>p" -> [".page", " ", ".gate", ">", "p"].
const stepsOf = (sel) => {
  const out = []; let depth = 0, buf = "", comb = null;
  for (const ch of sel.trim()) {
    if (depth === 0 && /[\s>+~]/.test(ch)) { if (buf) { out.push(buf); buf = ""; comb = " "; } if (!/\s/.test(ch)) comb = ch; continue; }
    if (ch === "(" || ch === "[") depth++;
    if (ch === ")" || ch === "]") depth--;
    if (comb) { out.push(comb); comb = null; }
    buf += ch;
  }
  out.push(buf);
  return out;
};
// The interactive or runtime states an element can be in (a rule with one can match it at some moment).
const STATES = new Set(["hover", "focus", "focus-visible", "focus-within", "active", "visited", "link", "any-link", "target"]);
const PSEUDO_EL = new Set(["before", "after", "marker", "placeholder", "selection", "first-line", "first-letter"]);
/** Whether a compound selector can match the element (mode "can"), or must (mode "must", for what :not() excludes). */
const compoundMatches = (c, el, mode) => {
  const parts = [...c.matchAll(/(\*|[a-zA-Z][\w-]*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:([~^$*|]?=)"?([^"\]]*)"?)?\]|::?([\w-]+)(\((?:[^()]|\([^()]*\))*\))?/g)];
  assert.equal(parts.map((p) => p[0]).join(""), c, `${c}: a selector the test can read`);
  return parts.every(([whole, tag, id, cls, attr, op, val, pseudo, arg]) => {
    if (tag) return tag === "*" || el.tag === tag.toLowerCase();
    if (id) return el.attrs.id === id;
    if (cls) return el.classes.includes(cls);
    if (attr) { const v = el.attrs[attr]; if (v === undefined) return false; if (!op) return true; return { "=": v === val, "~=": v.split(/\s+/).includes(val), "^=": v.startsWith(val), "$=": v.endsWith(val), "*=": v.includes(val), "|=": v === val || v.startsWith(`${val}-`) }[op]; }
    if (whole.startsWith("::") || PSEUDO_EL.has(pseudo)) return true; // a pseudo-element draws on (or in) its element
    if (STATES.has(pseudo)) return mode === "can";
    if (pseudo === "root") return el.tag === "html";
    const sibs = el.parent?.children ?? [el];
    if (pseudo === "first-child") return sibs[0] === el;
    if (pseudo === "last-child") return sibs.at(-1) === el;
    if (pseudo === "only-child") return sibs.length === 1;
    if (pseudo === "empty") return el.children.length === 0 ? mode === "can" : false;
    if (/^nth-/.test(pseudo)) return mode === "can";
    if (pseudo === "not") return !splitTop(arg.slice(1, -1), ",").some((s) => selectorMatches(s, el, mode === "can" ? "must" : "can"));
    if (pseudo === "is" || pseudo === "where") return splitTop(arg.slice(1, -1), ",").some((s) => selectorMatches(s, el, mode));
    assert.fail(`${c}: :${pseudo} is not known to the test`);
  });
};
const selectorMatches = (sel, el, mode = "can") => {
  const steps = stepsOf(sel);
  const at = (i, node) => {
    if (!node || node.tag === "#root" || !compoundMatches(steps[i], node, mode)) return false;
    if (i === 0) return true;
    const comb = steps[i - 1], sibs = node.parent.children, k = sibs.indexOf(node);
    if (comb === ">") return at(i - 2, node.parent);
    if (comb === "+") return at(i - 2, sibs[k - 1]);
    if (comb === "~") return sibs.slice(0, k).some((s) => at(i - 2, s));
    for (let p = node.parent; p && p.tag !== "#root"; p = p.parent) if (at(i - 2, p)) return true;
    return false;
  };
  return at(steps.length - 1, el);
};
/** Every rule of a stylesheet (any @media, any state) that can match one of the elements: [context, selector, body]. */
const rulesFor = (css, els) => rulesOf(css).filter(([ctx, sel]) => !/@(font-face|keyframes|page)/.test(`${ctx} ${sel}`))
  .flatMap(([ctx, sel, body]) => splitTop(sel, ",").filter((s) => els.some((el) => selectorMatches(s, el))).map((s) => [ctx, s, body]));
const declsOf = (body) => splitTop(body, ";").filter(Boolean).map((d) => { const i = d.indexOf(":"); return [d.slice(0, i).trim().toLowerCase(), d.slice(i + 1).trim().replace(/\s*!important$/, "")]; });
const ITALIC = ([p, v]) => (p === "font-style" || p === "font") && /\b(italic|oblique)\b/.test(v);
const FILL = ([p, v]) => /^background(-color|-image)?$/.test(p) && !/^(none|transparent)$/i.test(v);
const SHADOW = ([p, v]) => ((p === "box-shadow" || p === "text-shadow") && v !== "none") || (p === "filter" && /drop-shadow/.test(v));
/** Sign in's card as the browser sees it: main.page, section.gate, the note, its b and p, and the note's ancestors. */
const gateElements = () => {
  const all = allOf(domOf(page("signin.html")));
  const main = all.find((e) => e.tag === "main"), section = all.find((e) => e.tag === "section"), note = all.find((e) => e.classes.includes("gate-note"));
  assert.deepEqual([main?.classes, section?.classes, note?.tag], [["page"], ["gate"], "div"], "the card's elements");
  const b = note.children.find((e) => e.tag === "b"), p = note.children.find((e) => e.tag === "p");
  assert.ok(b && p, "the note's b and p");
  const ancestors = []; for (let n = main.parent; n && n.tag !== "#root"; n = n.parent) ancestors.push(n);
  assert.deepEqual(ancestors.map((n) => n.tag), ["body", "html"]);
  return { main, section, note, b, p, panel: [main, section, note, b, p], ancestors };
};

test("TH21 Sign in stays out of search: one noindex in the head, no canonical, Open Graph or Twitter tags; robots.txt keeps /signin out, the sitemap never names it", () => {
  const html = page("signin.html"), head = html.slice(0, html.indexOf("</head>"));
  assert.equal((head.match(/<meta name="robots" content="noindex">/g) ?? []).length, 1, "noindex, in the head");
  assert.equal((html.match(/name="robots"/g) ?? []).length, 1, "one robots tag");
  assert.doesNotMatch(html, /rel="canonical"|property="og:|name="twitter:/, "not a page to share or index");
  assert.equal(head.match(/<meta name="description" content="([^"]*)">/)[1], "Sign in to the Cryptophys CTA Studio.", "the description as before");
  assert.match(read("public/robots.txt"), /^Disallow: \/signin$/m);
  assert.doesNotMatch(read("public/sitemap.xml"), /signin|studio/);
});

test("TH22 Sign in's card: a narrow panel without a fill, its one action a ghost button (Follow on Threads the page's only gold), the note in slate; every word kept, part by part", () => {
  const html = page("signin.html"), base = JSON.parse(read("test/fixtures/legal-words.json"));
  const main = block(html, "<main", "</main>");
  const m = main.match(/^<main class="page" id="text">\n {2}<section class="gate" aria-labelledby="gate-title">\n {4}<h1 id="gate-title">([^<]+)<\/h1>\n {4}<p class="lede">([^<]+)<\/p>\n {4}<p class="gate-go"><a class="btn ghost" href="\/studio">([^<]+)<\/a><\/p>\n {4}<div class="gate-note" role="note">\n {6}<b>([^<]+)<\/b>\n {6}<p>([^<]+)<\/p>\n {4}<\/div>\n {4}<p class="gate-back"><a href="\/">([^<]+)<\/a><\/p>\n {2}<\/section>\n<\/main>$/);
  assert.ok(m, "the card: title, lede, the ghost button, the note, the way back");
  assert.equal(m.slice(1).join(" "), base.pages["signin.html"], "the card's words, part by part");
  assert.deepEqual([m[3], m[4]], ["Sign in with Cloudflare Access", "Not signed in"]);
  assert.equal(html.match(/<title>([^<]*)<\/title>/)[1], "Sign in · CTA Studio · Cryptophys");
  assert.ok(block(html, '<footer class="foot">', "</footer>").includes("<span>© Cryptophys · Education, not financial advice</span>"), "the © line");
  // one gold action, the header's Follow on Threads; the card's action is a ghost
  const btns = [...html.matchAll(/<a class="btn ([^"]+)"[^>]*>([^<]+)<\/a>/g)].map((x) => [x[1], x[2]]);
  assert.deepEqual(btns, [["gold", "Follow on Threads"], ["ghost", "Sign in with Cloudflare Access"]]);
  assert.match(headerOf(html), /<a class="btn gold" [^>]*data-threads>Follow on Threads<\/a>/);
  const css = read("public/home.css"), rules = cssRules(css);
  assert.match(rules.find(([s]) => s === ".btn.ghost")[1], /background:transparent/, "a ghost has no fill");
  // the panel and its parts: ruled, never filled or shadowed, no gold, amber or reading colour; the note in slate
  const gate = rules.filter(([s]) => /\.gate\b|\.gate-|\.gated\b/.test(s));
  assert.ok(gate.length >= 8, "Sign in's rules");
  for (const [sel, body] of gate) {
    assert.match(sel, /^(\.gated|\.page \.gate)/, `${sel}: Sign in's own classes`);
    assert.doesNotMatch(body, /background|box-shadow|--gold|--flat|--bear|--bull|#E0A458|#9a6700|amber/i, `${sel}: no fill, no gold, no warning colour`);
  }
  const panel = rules.find(([s]) => s === ".page .gate")[1];
  assert.match(panel, /border:1px solid var\(--rule\)/, "a panel ruled on the vault");
  assert.ok(Number(panel.match(/max-width:(\d+)em/)[1]) <= 32, "narrow");
  assert.match(rules.find(([s]) => s === ".page .gate-note")[1], /color:var\(--slate\)/, "the note in slate");
  // Review of #70: every rule that can match the card's own boxes (main.page, section.gate, the note, its b and p), however
  // it is written (.page section, .gated main, .page .gate p, p, *), at any width, in any state, in forced colours: no
  // fill (a background other than none or transparent) and no shadow. Read from home.css against the page's elements.
  const card = gateElements(), onCard = rulesFor(css, card.panel);
  for (const want of [".page", ".gated>main", ".page .gate", ".page .gate-note", ".page .gate-note b", ".page .gate-note p"]) assert.ok(onCard.some(([, s]) => s === want), `${want}: read as a rule on the card`);
  for (const [ctx, sel, body] of onCard) for (const d of declsOf(body)) assert.ok(!FILL(d) && !SHADOW(d), `${ctx ? `${ctx} ` : ""}${sel}{${d.join(":")}}: no fill or shadow on the card`);
  // the ghost's edge on the vault (review of #70): .btn.ghost's .38 is 2.64:1; on this page alone .5, 3.79:1 (WCAG 1.4.11
  // asks 3:1 of a control's edge); its hover keeps the full holo edge, which the page's rule would otherwise outrank
  assert.equal(rules.find(([s]) => s === ".page .gate .btn.ghost")?.[1], "border-color:rgba(143,216,255,.5)");
  assert.equal(rules.find(([s]) => s === ".page .gate .btn.ghost:hover")?.[1], "border-color:var(--holo)");
  assert.match(rules.find(([s]) => s === ".btn.ghost")[1], /border-color:rgba\(143,216,255,\.38\)/, "every other ghost as before");
  const hex = css.match(/--vault:#([0-9A-F]{6})/i)[1], vault = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [r, g, b, a] = rules.find(([s]) => s === ".page .gate .btn.ghost")[1].match(/rgba\(([\d.]+),([\d.]+),([\d.]+),([\d.]+)\)/).slice(1).map(Number);
  const lum = (rgb) => rgb.map((c) => c / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)).reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i], 0);
  const edge = [r, g, b].map((c, i) => c * a + vault[i] * (1 - a));
  assert.equal(((lum(edge) + 0.05) / (lum(vault) + 0.05)).toFixed(2), "3.79", "the ghost's edge on the vault");
  // none of cta.css's sign-in look: the old classes, the blue, the old mark and its icon
  const classes = new Set([...html.matchAll(/class="([^"]*)"/g)].flatMap((x) => x[1].split(/\s+/)));
  for (const c of ["signin", "signin-card", "card", "notice", "warn", "meta", "logo", "big", "primary", "lg", "outline", "sm", "section", "topbar", "site-foot", "public", "in", "narrow", "grow"]) assert.ok(!classes.has(c), `no class "${c}"`);
  assert.doesNotMatch(html, /#0866FF|#c8961e|id="studio-link"/i);
});

test("TH23 the studio's 403 page is Sign in, themed: /studio without a valid Access JWT answers 403 with signin.html, not cached; the API keeps its JSON", async () => {
  const { handle } = await import("../src/app.mjs");
  const served = [];
  const ASSETS = { fetch: async (r) => { const p = new URL(r.url).pathname; served.push(p); return p === "/signin" ? new Response(r.method === "HEAD" ? null : page("signin.html"), { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }) : new Response("not found", { status: 404 }); } };
  const env = { ACCESS_TEAM_DOMAIN: "cryptophys.cloudflareaccess.com", ACCESS_AUD: "a".repeat(64), ASSETS };
  const opts = { fetchImpl: async () => { throw new Error("no network in the test"); } };
  const get = (path, headers = {}, method = "GET") => handle(new Request(`https://cta.cryptophys.work${path}`, { method, headers }), env, opts);
  for (const [path, headers] of [["/studio", {}], ["/studio/", {}], ["/studio/studio.js", {}], ["/studio/a/b/c", {}], ["/studio?x=1", {}], ["/studio", { "cf-access-jwt-assertion": "a.b.c" }]]) {
    const res = await get(path, headers);
    assert.equal(res.status, 403, `${path}: still 403`);
    const body = await res.text();
    assert.equal(body, page("signin.html"), `${path}: the Sign in page`);
    assert.match(body, /<link rel="stylesheet" href="\/home\.css\?v=[0-9a-f]{12}">/, `${path}: the one theme`);
    assert.match(body, /<script type="module" src="\/page\.js\?v=[0-9a-f]{12}"><\/script>/);
    assert.doesNotMatch(body, /cta\.(css|js)/, `${path}: not the old look`);
    assert.match(body, /<meta name="robots" content="noindex">/);
    assert.equal(res.headers.get("cache-control"), "no-store", `${path}: never cached`);
    assert.match(res.headers.get("content-security-policy"), /script-src 'self'/);
  }
  // HEAD: the same refusal and the same headers, no body (review of #70)
  const head = await get("/studio", {}, "HEAD");
  assert.equal(head.status, 403);
  assert.equal(head.headers.get("cache-control"), "no-store", "HEAD: never cached");
  assert.match(head.headers.get("content-security-policy"), /script-src 'self'/, "HEAD: the CSP");
  assert.equal(head.headers.get("content-security-policy"), (await get("/studio")).headers.get("content-security-policy"), "HEAD: the GET's CSP");
  assert.equal(await head.text(), "", "HEAD: no body");
  assert.ok(served.length >= 8 && served.every((p) => p === "/signin"), "only the Sign in page is served, never the studio's");
  const api = await get("/api/studio/status");
  assert.equal(api.status, 403);
  assert.equal((await api.json()).error, "access_denied", "the API keeps its JSON refusal");
  // served at /studio and /studio/<anything>, so every URL the page names is absolute (or a fragment)
  for (const u of page("signin.html").matchAll(/(?:href|src)="([^"]*)"/g)) assert.match(u[1], /^(\/|#|https:\/\/)/, u[1]);
});

test("TH24 cta.css is the studio's own (PR 5; E2 in PR 4): only rules the studio can match, no public page's rule, no Sign in rule; the studio stays on cta.css; cta.js is gone and no file names it", () => {
  const css = read("public/cta.css");
  const selectors = [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{/g)].map((m) => m[1].trim());
  for (const s of selectors) assert.doesNotMatch(s, /\.signin\b|\.signin-card\b|\.logo\.big\b/, `${s}: Sign in's rule`);
  assert.match(css, /\n\.brand \.logo\{width:28px;height:28px;flex:none\}\n/, "the studio's mark keeps its rule");
  // the classes the studio names (its markup, and every word in studio.js's strings: a superset), that cta.css has rules for
  const studio = page("studio/index.html"), js = page("studio/studio.js");
  const used = new Set([
    ...[...studio.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/)),
    ...[...js.matchAll(/"([^"\\\n]*)"|'([^'\\\n]*)'|`([^`]*)`/g)].flatMap((m) => (m[1] ?? m[2] ?? m[3]).split(/[^a-zA-Z0-9-]+/))
  ].filter((t) => /^[a-z][a-z0-9-]*$/.test(t)));
  for (const c of ["signin", "signin-card", "big"]) assert.ok(!used.has(c), `the studio never names "${c}"`);
  // every rule in cta.css is one the studio can match (each selector's classes all ones the studio names), media and body
  // included: the 256 of PR 4 less ten public-page rules the studio never draws, byte for byte and in file order (the
  // cascade): .links, .post and .never (and its marker) matched only words in studio.js's strings; #studio-link names no
  // class, so it passed with nothing to match; the four .topbar nav rules name real classes (topbar, on) but need a nav in
  // the top bar, which the studio has none of; span.num's class is real on td, th and input, never on a span (review of
  // #71). The studio's screens at 1440 and 390 px are pixel-identical before and after. A deliberate change to its look
  // updates this.
  const parts = rulesOf(css).flatMap(([media, sel, body]) => sel.split(",").map((x) => [media, x.trim(), body]));
  const studioRules = parts.filter(([, x]) => [...x.matchAll(/\.([a-zA-Z][\w-]*)/g)].every((m) => used.has(m[1]))).map(([media, x, body]) => `${media}|${x}{${body}}`);
  assert.equal(studioRules.length, parts.length, "every rule in cta.css is one the studio can match");
  assert.equal(studioRules.length, 246, "the rules the studio can match");
  assert.equal(createHash("sha256").update([...studioRules].sort().join("\n")).digest("hex").slice(0, 16), "176669ef1344a5cd", "the studio's rules are unchanged");
  // and in file order: a reorder changes the cascade (review of #71: @media (max-width:900px) moved above .shell left the
  // 390 px studio on two columns with a sticky side navigation, and the sorted hash still passed)
  assert.equal(createHash("sha256").update(studioRules.join("\n")).digest("hex").slice(0, 16), "15bd473e37be5c9f", "the studio's rules keep their order");
  // no public page's rule: the old public page's and sub-pages' classes, the public top bar's nav, the steps' number,
  // the old Studio link; the only id a rule names is one the studio's markup has
  const PUBLIC = ["public", "hero", "hero-card", "hero-more", "eyebrow", "facts", "section", "chan", "disclaimer", "site-foot", "pagehero", "meta-p", "steps", "prose", "never", "links", "post", "narrow", "lg", "three", "sr"];
  for (const [media, x] of parts) {
    for (const m of x.matchAll(/\.([a-zA-Z][\w-]*)/g)) assert.ok(!PUBLIC.includes(m[1]), `${media}|${x}: a public page's rule`);
    for (const m of x.matchAll(/#([a-zA-Z][\w-]*)/g)) assert.match(studio, new RegExp(`id="${m[1]}"`), `${media}|${x}: an id the studio has`);
    assert.doesNotMatch(x, /^\.topbar nav\b|^span\.num$/, `${media}|${x}: a public page's rule`);
  }
  assert.doesNotMatch(css, /#studio-link|@media \(max-width:860px\)/, "the public pages' Studio link and breakpoint");
  for (const c of ["list", "notice", "warn", "badge", "sidenav", "draft", "tab", "logo"]) assert.ok(CTA_RULE_CLASSES(css).has(c) && used.has(c), `.${c}: the studio's, kept`);
  assert.match(studio, /<link rel="stylesheet" href="\/cta\.css">/, "the studio stays on cta.css (the owner's light look)");
  assert.doesNotMatch(studio, /home\.css/);
  // cta.js (E1): no page loaded it after PR 4; gone in PR 5, and no file names it (the pages, the Worker, the build,
  // the headers, the config, the tests; the docs keep its history)
  assert.ok(!existsSync(new URL("../public/cta.js", import.meta.url)), "public/cta.js is gone");
  const files = [];
  const walk = (dir) => { for (const n of readdirSync(new URL(`../${dir}`, import.meta.url))) { const p = `${dir}${n}`; if (statSync(new URL(`../${p}`, import.meta.url)).isDirectory()) walk(`${p}/`); else if (/\.(html|css|js|mjs|json|jsonc|txt|xml|md|ya?ml)$|^_headers$|^_redirects$/.test(n)) files.push(p); } };
  for (const d of ["public/", "src/", "scripts/", "site/", "test/", ".github/"]) walk(d);
  files.push("wrangler.jsonc", "organism.json", "package.json", "README.md", "AGENTS.md");
  assert.ok(files.includes("public/_headers") && files.includes("src/app.mjs") && files.includes("scripts/versions.mjs") && files.includes(".github/workflows/deploy.yml"), "the headers, the Worker, the build and the workflows are read");
  // cta.css keeps its own name (no ?v=), so it is never kept a year: no _headers rule names it (review of #71)
  assert.doesNotMatch(read("public/_headers"), /^\/cta\.css\b|^\/\*\.css\b/m, "no long-cache rule for /cta.css");
  for (const f of files.filter((x) => x !== "test/theme.test.mjs")) assert.doesNotMatch(read(f), /\bcta\.js\b/, `${f} names cta.js`);
  assert.ok(!VERSIONED.includes("cta.js") && !VERSIONED.includes("cta.css"), "neither is a versioned file");
});

test("TH25 Sign in fits: nothing wider than a 320 px window (the button's words wrap, the panel can shrink, long words break) and the footer meets the bottom of a tall window", () => {
  const css = read("public/home.css"), rules = cssRules(css);
  const rule = (sel) => rules.find(([s]) => s === sel)?.[1] ?? "";
  // 320 px before: 357 px wide (the button kept its words on one line inside a 480 px card's padding)
  const btn = rule(".page .gate .btn");
  assert.match(btn, /white-space:normal/, "the button's words wrap (.btn is nowrap)");
  assert.match(btn, /max-width:100%/, "never wider than the panel");
  assert.match(rule(".btn"), /white-space:nowrap/, "(the nowrap it undoes)");
  const panel = rule(".page .gate");
  assert.match(panel, /min-width:0/);
  assert.doesNotMatch(panel, /(^|;)width:\d|min-width:[1-9]/, "no fixed width");
  assert.match(css, /\.page\{overflow-wrap:break-word\}/, "a long word breaks");
  assert.match(css, /\n@media \(max-width:600px\)\{\.page \.gate\{padding:24px 20px\}\}\n/, "a phone's narrower padding");
  // the footer gap (51 px at 1440 before): the body is a column at least the window's height, the main grows
  assert.match(rule(".gated"), /^display:flex;flex-direction:column;min-height:100vh;min-height:100dvh$/);
  assert.match(rule(".gated>main"), /flex:1 0 auto;width:100%/, "the main grows (and keeps its width in the column)");
  assert.match(page("signin.html"), /<body class="gated">\n<a class="skip"/);
  // the page is short, so the footer is in view on load: its weight (Rajdhani 500) is the display weight preloaded. In the
  // note only the sentence is in the preloaded reading face (Newsreader 400, not italic); "Not signed in" above it is
  // Rajdhani 600, which is not preloaded (review of #70)
  assert.deepEqual([...page("signin.html").matchAll(/<link rel="preload" href="\/fonts\/([^"]+)"/g)].map((m) => m[1]), ["rajdhani-latin-500-normal.woff2", "newsreader-latin-400-normal.woff2"]);
  assert.match(rule(".foot"), /font:500 /, "(the footer's weight)");
  assert.doesNotMatch(rule(".page .gate-note p") + rule(".page .gate-note"), /italic/);
  assert.match(rule(".page .gate-note b"), /font:600 [^;]*var\(--display\)/, '"Not signed in": Rajdhani 600');
  assert.match(rule("body"), /font:400 [^;]*var\(--read\)/, "the sentence: Newsreader 400, the body's");
  // Review of #70: no rule that can match the card's boxes (main.page, section.gate, the note, its b and p), or the
  // body and html they inherit from, sets italic, however it is written (.page .gate p, .page .gate-note b, .gated, p, *)
  const card = gateElements(), onCard = rulesFor(css, [...card.panel, ...card.ancestors]);
  assert.ok(onCard.some(([, s]) => s === ".page .gate-note b") && onCard.some(([, s]) => s === ".gated"), "read as rules on the card");
  for (const [ctx, sel, body] of onCard) for (const d of declsOf(body)) assert.ok(!ITALIC(d), `${ctx ? `${ctx} ` : ""}${sel}{${d.join(":")}}: no italic on the card`);
});
