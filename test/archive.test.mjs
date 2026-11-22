// The Archive page in the home and Performance look (frontend mockup 2026-11-22, owner approved): the model, and the
// page keeps its words (no public text changed), loads its list without moving what is below it, and is built.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { archiveModel, tabsOf, splitText, whenUtc, whenLocal, dayOf, ARCHIVE_URL, KIND, EMPTY, EMPTY_KIND } from "../site/archive/model.js";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const POSTS = [
  { id: "a", kind: "key_levels", channel: "threads", text: "Education · XAUUSD key-level map\nPrice when read: 3607.41\n\nNot financial advice.", published_at: "2026-11-20T00:15:31.367Z" },
  { id: "b", kind: "warroom", channel: "threads", text: "Education · XAUUSD 1D War Room reading\n\nBias on the daily chart: Bearish.", published_at: "2026-11-19T11:49:50.999Z" },
  { id: "c", kind: "pattern", channel: "telegram", text: "Education · Pattern breakout", published_at: "2026-11-19T01:39:38.515Z" }
];

test("AR1 the model: posts by UTC day in the answer's order, the first line as the headline, the text otherwise as published", () => {
  const m = archiveModel(POSTS, "", { label: { threads: "Threads" }, timeZone: "Asia/Jakarta" });
  assert.deepEqual(m.days.map((d) => [d.day, d.posts.map((p) => p.id)]), [["Friday, 20 November 2026", ["a"]], ["Thursday, 19 November 2026", ["b", "c"]]]);
  const [a] = m.days[0].posts;
  assert.deepEqual([a.channel, a.kind, a.utc, a.local, a.head, a.body], ["Threads", "Key-level map", "20 Nov 2026, 12:15 AM UTC", "7:15 AM GMT+7", "Education · XAUUSD key-level map", "Price when read: 3607.41\n\nNot financial advice."]);
  assert.equal(m.days[1].posts[0].kind, "", "a kind without a name shows no label, as before");
  assert.equal(m.days[1].posts[0].body, "Bias on the daily chart: Bearish.", "the blank line under the headline is not repeated");
  assert.equal(m.days[1].posts[1].channel, "telegram", "a channel without a public link keeps its id, as before");
  for (const p of POSTS) { const s = splitText(p.text); assert.equal(`${s.head}\n${s.body}`.replace(/\s+/g, " ").trim(), p.text.replace(/\s+/g, " ").trim(), "no word changed"); }
  assert.deepEqual(archiveModel([], ""), { days: [], empty: EMPTY });
  assert.deepEqual(archiveModel(POSTS, "daily_recap"), { days: [], empty: EMPTY_KIND });
  assert.deepEqual(archiveModel(POSTS, "pattern").days.flatMap((d) => d.posts.map((p) => p.id)), ["c"]);
  assert.deepEqual(tabsOf(POSTS, "pattern").map((t) => [t.label, t.count, t.selected]), [["All posts", 3, false], ["Key-level map", 1, false], ["Chart pattern", 1, true], ["Daily recap", 0, false], ["Post", 0, false]]);
  assert.deepEqual(KIND, { key_levels: "Key-level map", pattern: "Chart pattern", daily_recap: "Daily recap", custom: "Post" }, "the tab names as before");
  assert.equal(whenUtc("nope"), ""); assert.equal(whenLocal("nope"), ""); assert.equal(dayOf(undefined), "");
  assert.equal(whenLocal("2026-11-19T22:00:00Z", "Asia/Jakarta"), "Fri 5:00 AM GMT+7", "the local weekday when the local day is not the UTC day");
  assert.equal(whenLocal("2026-11-20T00:15:00Z", "America/New_York"), "Thu 7:15 PM EST");
  assert.equal(whenLocal("2026-11-20T00:15:00Z", "UTC"), "", "a visitor on UTC is not shown the time twice");
  assert.equal(whenLocal("2026-11-20T00:15:00Z", "Europe/Lisbon"), "", "nor one at UTC+0 in winter (GMT)");
  assert.equal(whenLocal("2026-07-20T00:15:00Z", "Europe/Lisbon"), "1:15 AM GMT+1", "Lisbon in summer is an hour ahead");
  assert.equal(EMPTY, "No posts published yet.", "the empty lines as the page always had them");
  assert.equal(EMPTY_KIND, "No posts of this type yet.");
});

test("AR2 the page: the shared header and footer, its words kept, the list preloaded and held open while it loads", () => {
  const html = read("public/archive.html");
  assert.doesNotMatch(html, /cta\.(css|js)/, "the page stands on home.css");
  assert.match(html, /<link rel="stylesheet" href="\/home\.css(\?v=[0-9a-f]{12})?">/);
  assert.match(html, /<script type="module" src="\/archive\.js(\?v=[0-9a-f]{12})?"><\/script>/);
  // the header and footer as on Performance, with Archive as the current page
  const nav = html.match(/<nav class="nav" aria-label="Main">([\s\S]*?)<\/nav>/)[1];
  assert.deepEqual([...nav.matchAll(/<a href="([^"]+)"([^>]*)>([^<]+)<\/a>/g)].map((m) => [m[1], m[3], /aria-current="page"/.test(m[2])]), [["/#cast", "The cast", false], ["/#how", "How it works", false], ["/performance", "Performance", false], ["/archive", "Archive", true]]);
  for (const id of ["clock-utc", "clock-local", "avg-strip"]) assert.match(html, new RegExp(`id="${id}"`), id);
  // the words the page showed before (Home is the brand link, Disclaimer is in the footer, as on Performance)
  for (const words of ["<title>Archive · XAUUSD AI · Cryptophys</title>", ">Archive</p>", "<h1>Every published post</h1>", "Key-level maps, chart patterns and daily recaps, newest first. Each one passed our checks and a person's approval before it went out.", "<b>Education, not financial advice</b>", "This content is education and analysis. It is not an invitation to buy or sell and not financial advice.", ">Read the full disclaimer</a>", ">How it works</a>", ">Disclaimer</a>", ">Privacy</a>", ">Terms</a>", ">Studio sign in</a>", "<span>Chart by TradingView</span>", "<span>© Cryptophys · Education, not financial advice</span>"]) assert.ok(html.includes(words), words);
  assert.match(html, /id="disclaimer"/, "the profile's disclaimer replaces the line, as before");
  // the list: preloaded with the very URL the script asks for, held open (aria-busy) until it is drawn
  assert.equal(ARCHIVE_URL, "/api/public/archive?limit=100");
  assert.match(html, /<link rel="preload" href="\/api\/public\/archive\?limit=100" as="fetch" crossorigin>/);
  assert.match(html, /<div class="a-list" id="archive" role="tabpanel" aria-busy="true"><\/div>/, "no empty line while loading; the list is the tabs' panel");
  const src = read("site/archive/archive.js");
  assert.match(src, /fetch\(ARCHIVE_URL\)/, "a plain fetch of the preloaded URL");
  assert.match(src, /removeAttribute\('aria-busy'\)/);
  const css = read("public/home.css");
  assert.match(css, /\.a-list\[aria-busy="true"\],\.a-list\.hold\{min-height:100vh\}/, "held open while loading, and after it when there is nothing to show");
  assert.match(src, /classList\.toggle\('hold', !state\.posts\.length\)/, "an empty or failed read keeps the height: the note and footer do not jump up");
  assert.match(css, /\.a-body\{[^}]*white-space:pre-wrap/, "a post's spaces and line breaks as published");
  // the tabs are built once and only marked afterwards, so focus stays on the tab a person used
  assert.match(src, /if \(!box\.children\.length\)/);
  assert.match(src, /setAttribute\('aria-controls', 'archive'\)/);
  assert.match(src, /\$\('archive'\)\.setAttribute\('aria-labelledby', TAB_ID\(state\.kind\)\)/);
  assert.match(css, /\.kinds\{display:flex;flex-wrap:wrap/, "the tabs wrap on a phone");
  assert.match(css, /\.foot a\{display:inline-flex;align-items:center;min-height:44px/, "44 px footer links");
  assert.doesNotMatch(html, /\b(nexus|omega)\b/i);
});

test("AR3 the Archive bundle is built from site/archive", () => {
  const b = JSON.parse(read("public/room/build.json"));
  assert.equal(b.archive, createHash("sha256").update(readFileSync(new URL("../public/archive.js", import.meta.url))).digest("hex"), "run npm run build:room");
});
