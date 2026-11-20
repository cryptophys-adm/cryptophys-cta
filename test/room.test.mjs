// The holo war room home page (owner 2026-11-19): the live scene's script, the public data, the build, the routing
// and the security headers of the static files.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { PEOPLE, MEETINGS, READS, DEPTS } from "../site/room/data.js";
import { meetingFromScene, meetingsFromResponse, freshMeetings, latestMeeting, safeLine, minutesFromScene, minutesFromResponse, tallyWords, replyWords, statusOf, postHeadline, latestPost } from "../site/room/script.js";
import { FONTS } from "../scripts/fonts.mjs";
import { navigatorHtml, withNavigator, sourceHash } from "../scripts/navigator.mjs";
import { handle, warroomScene, SECURITY_HEADERS, SCENE_TTL_S } from "../src/app.mjs";
import { CALLBACK_PATH } from "../src/oauth.mjs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const jsonc = (p) => JSON.parse(read(p).replace(/^\s*\/\/.*$/gm, ""));
const scene = (over = {}) => ({
  source: "15m", label: "15m", at: "2026-11-19T02:00:00.000Z", bias: "bearish",
  moderator: ["Sellers control the footprint below the value area.", "Gold slipped toward 3740 on the open."],
  analysts: [
    { id: "fabio_amt", bias: "bearish", metrics: ["the value area range", "the footprint order flow"], claim: ["Sellers dominate the footprint order flow."], rebuttal: ["The footprint contradicts a sustained rally."], rebuts: ["supertrend", "ghost"] },
    { id: "supertrend", bias: "bullish", metrics: ["the supertrend indicator"], claim: ["The supertrend stays below price."], rebuttal: [], rebuts: [] },
    { id: "risk", bias: "neutral", metrics: ["the 15m volatility"], claim: ["I would wait for the entry near the lows."], rebuttal: [], rebuts: [] },
    { id: "projection", bias: "bearish", metrics: ["the Fibonacci 0.618 retracement"], claim: ["The pattern respects the Fibonacci 0.618 retracement."], rebuttal: [], rebuts: [] },
    { id: "intruder", bias: "bullish", metrics: ["x"], claim: ["Not in the cast."], rebuttal: [], rebuts: [] }
  ],
  ...over
});

test("RM1 a room's scene becomes a meeting: claims, then rebuttals, then the Moderator; unknown agents and unsafe lines never shown", () => {
  const m = meetingFromScene(scene());
  assert.equal(m.id, "m15");
  assert.deepEqual(m.talk.map((t) => [t.agent, t.text]), [
    ["fabio_amt", "Sellers dominate the footprint order flow."],
    ["supertrend", "The supertrend stays below price."],
    ["projection", "The pattern respects the Fibonacci 0.618 retracement."],
    ["fabio_amt", "The footprint contradicts a sustained rally."]
  ], "the order word (entry) is dropped; a ratio is no price; the intruder is not in the cast");
  assert.deepEqual(m.talk[3].to, ["supertrend"], "rebuts only known agents");
  assert.deepEqual(m.reasons, ["Sellers control the footprint below the value area."], "a price-like number is dropped");
  assert.equal(m.analysts.risk.latest, "", "the unsafe claim is not kept for the card either");
  assert.deepEqual(m.analysts.fabio_amt.metrics, ["the value area range", "the footprint order flow"]);
  assert.equal(meetingFromScene({ ...scene(), source: "5m" }), null);
  assert.equal(meetingFromScene(scene({ analysts: [], moderator: [] })), null, "nothing to say: no meeting");
  // Without any claim (an old document) the analysts' metrics are what they weighed.
  const w = meetingFromScene(scene({ analysts: [{ id: "news", metrics: ["the dollar index strength", "the gold ETF outflow trend"] }] }));
  assert.deepEqual(w.talk, [{ agent: "news", text: "the dollar index strength, the gold ETF outflow trend" }]);
  for (const bad of ["Sell the rally.", "A stop loss above the high.", "Take profit at the low.", "Price is at 3741.80.", "Pattern #1 holds.", "Long positions are crowded."]) assert.equal(safeLine(bad), "", bad);
});

test("RM2 following the real rooms: the first read meets the latest room, later reads only the rooms that concluded since", () => {
  const a = meetingsFromResponse({ rooms: { "15m": scene(), "1h": scene({ source: "1h", at: "2026-11-19T01:00:00.000Z" }), "4h": scene({ source: "4h", at: "2026-11-18T22:00:00.000Z" }) } });
  assert.deepEqual(Object.keys(a).sort(), ["h1", "h4", "m15"]);
  assert.equal(latestMeeting(a), "m15");
  const b = meetingsFromResponse({ rooms: { "15m": scene({ at: "2026-11-19T02:15:00.000Z" }), "1h": scene({ source: "1h", at: "2026-11-19T02:00:00.000Z" }), "4h": scene({ source: "4h", at: "2026-11-18T22:00:00.000Z" }) } });
  assert.deepEqual(freshMeetings(a, b), ["h1", "m15"], "oldest first; the 4H room did not change");
  assert.deepEqual(freshMeetings(b, b), []);
  assert.equal(latestMeeting({}), null);
});

test("RM3 the cast is public: one-word names, plain roles, no registry fields, no internal names or order words", () => {
  const ids = PEOPLE.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(PEOPLE.length, 49, "every agent of the approved prototype");
  for (const p of PEOPLE) {
    assert.deepEqual(Object.keys(p).sort(), ["dept", "id", "name", "role", "title"], `${p.id}: no registry status or note`);
    assert.match(p.name, /^[A-Za-z0-9]+$/, `${p.id}: one word`);
    assert.ok(DEPTS.some((d) => d.id === p.dept));
    assert.ok(safeLine(p.role), `${p.id}: the role passes the public filter`);
  }
  for (const id of Object.keys(READS)) assert.ok(ids.includes(id));
  for (const m of Object.values(MEETINGS)) for (const id of [m.lead, ...m.leaders]) assert.ok(ids.includes(id));
  const pub = [read("site/room/data.js"), read("site/room/main.js"), read("public/index.html"), read("public/home.js")].join("\n");
  assert.doesNotMatch(pub, /\b(nexus|omega)\b/i, "never the internal system names");
  assert.doesNotMatch(pub, /registry status|kernel registry|reg:/i);
  const icons = read("site/room/main.js");
  const icon = (id) => icons.match(new RegExp(`${id}: (SHIELD \\+ '[^']+')`))?.[1];
  assert.ok(icon("cta_guardian") && icon("ae_guardian") && icon("cta_guardian") !== icon("ae_guardian"), "the two guardians carry different icons (owner: \"Ikon beda\")");
});

test("RM4 the build is current: the bundle was built from these sources, the navigator from this data", () => {
  const b = JSON.parse(read("public/room/build.json"));
  assert.equal(b.sources, sourceHash(), "site/room changed: run npm run build:room");
  assert.equal(b.bundle, createHash("sha256").update(readFileSync(new URL("../public/room/room.js", import.meta.url))).digest("hex"));
  assert.equal(b.three, "0.170.0");
  const page = read("public/index.html");
  assert.equal(withNavigator(page), page, "the navigator in public/index.html is the one the data gives");
  for (const p of PEOPLE) assert.ok(page.includes(`data-agent="${p.id}"`), p.id);
  assert.ok(navigatorHtml().includes("<dd>"), "each agent's role is text on the page (screen readers, no WebGL)");
  assert.equal(b.home, createHash("sha256").update(readFileSync(new URL("../public/home.js", import.meta.url))).digest("hex"), "public/home.js is built from site/home");
  assert.ok(read("public/home.js").includes(`/room/room.js?v=${b.bundle.slice(0, 12)}`), "the page loads this very scene: its hash in the URL, past the browsers' hour of /room/*");
  const files = readdirSync(new URL("../public/room/", import.meta.url)).sort();
  assert.deepEqual(files, ["CREDITS.txt", "build.json", "mannequin.glb", "room.js"]);
  const credits = read("public/room/CREDITS.txt");
  assert.match(credits, /Quaternius/); assert.match(credits, /CC0 1\.0/); assert.match(credits, /three\.js/); assert.match(credits, /MIT License/);
  const glb = readFileSync(new URL("../public/room/mannequin.glb", import.meta.url));
  assert.equal(createHash("sha256").update(glb).digest("hex"), "0d11eb3bbc6df8d30dfe75ce7cc2f060df99c01cf43ed7a4d505332272afacc2", "the file CREDITS.txt describes");
});

test("RM5 static files carry the Worker's security headers; the page has no inline style or inline script, and only self-hosted fonts", () => {
  const h = read("public/_headers");
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    const line = h.split("\n").find((l) => l.trim().toLowerCase().startsWith(`${k}:`));
    assert.ok(line, `_headers sets ${k}`);
    assert.equal(line.trim().slice(k.length + 1).trim(), v, k);
  }
  for (const p of ["public/index.html"]) {
    const html = read(p);
    assert.doesNotMatch(html, /\sstyle=|<style|fonts\.googleapis|<script>(?!<\/script>)|<script(?![^>]*\ssrc=)[^>]*>/i, p);
  }
  const css = read("public/home.css");
  assert.doesNotMatch(css, /@import|url\(\s*["']?(https?:)?\/\//i, "nothing from another host");
  const faces = [...css.matchAll(/url\((\/fonts\/[^)]+)\)/g)].map((m) => m[1].slice("/fonts/".length)).sort();
  assert.deepEqual(faces, FONTS.map(([, f]) => f).sort(), "every @font-face is one of the self-hosted files");
  for (const f of faces) assert.equal(readFileSync(new URL(`../public/fonts/${f}`, import.meta.url)).subarray(0, 4).toString(), "wOF2", f);
  assert.match(read("public/fonts/OFL.txt"), /SIL Open Font License/);
});

test("RM6 the Worker runs first only where it must: health, API, studio (and its OAuth callback), cards, tracked links", () => {
  const cfg = jsonc("wrangler.jsonc");
  const first = cfg.assets.run_worker_first;
  assert.deepEqual(first, ["/health", "/api/*", "/studio", "/studio/*", "/media/*", "/go/*"]);
  assert.ok(CALLBACK_PATH.startsWith("/studio/"));
  assert.deepEqual(JSON.parse(read("organism.json")).deploy.assets.run_worker_first, first);
  assert.ok(first.length <= 100 && first.every((p) => p.startsWith("/")));
});

test("RM7 GET /api/public/warroom-scene: only the documented fields, cached a minute; a failure is not cached", async () => {
  const store = new Map();
  const cache = { match: async (k) => store.get(k.url)?.clone() ?? null, put: async (k, r) => { store.set(k.url, r); } };
  let calls = 0;
  const env = { PROJECTION: { warroomScene: async () => { calls++; return { version: 1, rooms: {
    "15m": { ...scene(), stance: "SELL", confidence: 0.9, analysts: [{ ...scene().analysts[0], stance: "SELL", confidence: 0.8, model: "m" }] },
    "5m": scene({ source: "5m" }) }, notice: "Analysis, not a signal." }; } } };
  const req = () => new Request("https://cta.cryptophys.work/api/public/warroom-scene");
  const r = await handle(req(), env, { cache });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), `public, max-age=${SCENE_TTL_S}`);
  const body = await r.json();
  assert.deepEqual(Object.keys(body.rooms), ["15m"], "only the four rooms");
  assert.doesNotMatch(JSON.stringify(body), /stance|confidence|SELL|"model"/);
  assert.deepEqual(Object.keys(body.rooms["15m"].analysts[0]).sort(), ["bias", "claim", "id", "metrics", "rebuts", "rebuttal"]);
  // The edge copy comes back with the zone's browser TTL (4 hours, live 2026-11-19): the visitor still gets a minute.
  const [k] = store.keys(); const stale = store.get(k); const h = new Headers(stale.headers); h.set("cache-control", "public, max-age=14400");
  store.set(k, new Response(await stale.clone().text(), { status: 200, headers: h }));
  const again = await handle(req(), env, { cache });
  assert.equal(calls, 1, "the second visitor is answered from the edge cache");
  assert.equal(again.headers.get("cache-control"), `public, max-age=${SCENE_TTL_S}`);
  assert.deepEqual(Object.keys((await again.json()).rooms), ["15m"]);
  assert.match(read("site/room/feed.js"), /cache: 'no-store'/, "the page polls past the browser cache");
  assert.doesNotMatch(read("site/room/main.js") + read("site/home/home.js"), /fetch\([^)]*warroom-scene|fetch\(SCENE_URL/, "one feed: only feed.js reads the rooms");
  const failing = await warroomScene({ PROJECTION: { warroomScene: async () => { throw new Error("down"); } } }, new Request("https://x/api/public/warroom-scene"), { match: async () => null, put: async () => { throw new Error("must not cache"); } });
  assert.equal(failing.status, 502);
  assert.equal(failing.headers.get("cache-control"), "no-store");
  assert.deepEqual((await failing.json()).rooms, {});
  const none = await warroomScene({}, new Request("https://x/api/public/warroom-scene"), undefined);
  assert.equal(none.status, 502, "an AI Worker without the entrypoint");
});

test("RM8 the minutes: each room's speakers with their claims, replies and the Moderator's conclusion, through the same filter", () => {
  const m = minutesFromScene(scene());
  assert.equal(m.id, "m15");
  assert.equal(m.room, "15-minute room");
  assert.deepEqual(m.speakers.map((s) => [s.id, s.title, s.bias]), [["fabio_amt", "Fabio AMT Sensors", "bearish"], ["supertrend", "Supertrend", "bullish"], ["projection", "Projection Agent", "bearish"]],
    "risk's claim names an entry (dropped), the intruder is not in the cast");
  assert.deepEqual(m.speakers[0].to, ["Supertrend"], "replies name known analysts only");
  assert.equal(m.speakers[0].rebuttal, "The footprint contradicts a sustained rally.");
  assert.deepEqual(m.conclusion, ["Sellers control the footprint below the value area."], "a price-like number is dropped");
  assert.deepEqual(m.tally, { bearish: 2, neutral: 0, bullish: 1 });
  assert.equal(tallyWords(m.tally), "2 bearish and 1 bullish of 3 who spoke");
  assert.equal(tallyWords({ bearish: 7, neutral: 2, bullish: 1 }), "7 bearish, 2 undecided and 1 bullish of 10 who spoke");
  assert.equal(replyWords(["Risk Manager", "Supertrend", "Order Blocks"]), "In reply to Risk Manager, Supertrend and Order Blocks");
  assert.equal(replyWords([]), "In reply");
  // An analyst without a claim did not speak (the 1D news and projection had none).
  const quiet = minutesFromScene(scene({ analysts: [{ id: "news", bias: "bearish", metrics: ["x"], claim: [], rebuttal: [], rebuts: [] }, scene().analysts[1]] }));
  assert.deepEqual(quiet.speakers.map((s) => s.id), ["supertrend"]);
  assert.equal(minutesFromScene(scene({ analysts: [], moderator: [] })), null);
  assert.equal(minutesFromScene({ ...scene(), source: "5m" }), null);
  // Nothing beyond what the scene publishes: no decision, confidence, price or level.
  const all = minutesFromResponse({ rooms: { "15m": { ...scene(), confidence: 0.9, decision: "SELL" }, "1d": scene({ source: "1d", at: "2026-11-18T22:00:00.000Z" }) } });
  assert.deepEqual(Object.keys(all).sort(), ["d1", "m15"]);
  assert.doesNotMatch(JSON.stringify(all).replace(/"at":"[^"]+"/g, ""), /confidence|decision|SELL|(?<![.\d])\d{3,}/, "no price-like number (a ratio such as 0.618 is not one)");
  // The hero's status: the 15-minute room, or the meeting replaying in the scene.
  const live = meetingsFromResponse({ rooms: { "15m": scene(), "4h": scene({ source: "4h", bias: "neutral", at: "2026-11-19T00:00:00.000Z" }) } });
  assert.deepEqual(statusOf(live), { text: "The 15-minute room reads bearish", at: "2026-11-19T02:00:00.000Z", bias: "bearish" });
  assert.equal(statusOf(live, "h4").text, "The 4-hour room is meeting");
  assert.equal(statusOf({ h4: live.h4 }).text, "The 4-hour room reads undecided");
  assert.equal(statusOf({}), null);
});

test("RM9 the cast reads as a directory: a distinct role for every agent, indicator names kept, the copy in sentence case", () => {
  const roles = PEOPLE.map((p) => p.role);
  assert.equal(new Set(roles).size, roles.length, "no two agents share a role");
  for (const id of ["prophet", "trade_management", "interstellar_eyes", "kinetic_engine", "fabio_amt", "chronos_matrix", "tactical_muscles", "macro_aether", "decision_matrix", "supertrend", "aegis_footprint", "order_blocks"]) {
    const p = PEOPLE.find((x) => x.id === id);
    assert.match(p.role, /^Reads [a-zPGSCH]/, id);
    assert.match(p.role, /\.$/, id);
  }
  assert.equal(PEOPLE.find((p) => p.id === "decision_matrix").role, "Reads Prophet, GMI and volume profile.");
  assert.equal(PEOPLE.find((p) => p.id === "interstellar_eyes").role, "Reads daily Camarilla levels and weekly Camarilla levels.");
  assert.equal(PEOPLE.find((p) => p.id === "macro_aether").role, "Reads multi-timeframe z-score and weighted Hurst exponent.");
  assert.equal(PEOPLE.find((p) => p.id === "h4").role, "Brings the 4-hour candle to the table and leads that meeting.");
  const page = read("public/index.html");
  for (const d of DEPTS) assert.match(page, new RegExp(`id="g-${d.id}">${d.label.replace(/&/g, "&amp;")}<small>`), d.id);
  // Sentence case: no all-caps labels, no middle-dot meta strings, no arrows on buttons.
  const text = page.replace(/<[^>]+>/g, " ");
  assert.doesNotMatch(text, /·|→|←/, "no middle dots or arrows in the page's text");
  assert.doesNotMatch(read("public/home.css"), /text-transform:\s*uppercase/i);
  assert.doesNotMatch(read("site/room/main.js"), /`[^`]*·[^`]*`|→/, "the scene's own lines have no middle dots or arrows either");
  for (const m of Object.values(MEETINGS)) assert.equal(m.short, m.short.toLowerCase(), `${m.label}: the switch reads ${m.short}`);
  for (const id of ["minutes", "cast", "how", "disclaimer"]) assert.match(page, new RegExp(`id="${id}"`));
  assert.match(page, /class="skip" href="#minutes"/);
  assert.match(page, /role="tablist"/);
  assert.equal((page.match(/role="tab"/g) ?? []).length, 4);
  assert.match(page, /data-threads>Follow on Threads</);
  assert.match(page, /href="\/studio"[^>]*>Studio sign in</);
  assert.doesNotMatch(page, /href="\/cta\.css"/, "the home page stands on its own stylesheet");
});

test("RM10 the latest post on Threads: the headline only, filtered like the rooms; the feed rests in a hidden tab; the reading colours", () => {
  assert.equal(postHeadline("Education · XAUUSD 1D War Room reading\n\nBias on the daily chart: Bearish"), "XAUUSD 1D War Room reading");
  assert.equal(postHeadline("Education · Pattern breakout · XAUUSD D1\nFalling Wedge"), "Pattern breakout, XAUUSD D1", "the post's dots read as commas");
  assert.equal(postHeadline("Education · XAUUSD key-level map · Friday, 20 November 2026 12:03 AM UTC\nlevels"), "XAUUSD key-level map", "the date part goes (the page shows the post's time); a year is no price");
  assert.equal(postHeadline("Education · Daily recap · 19 Nov 2026"), "Daily recap");
  assert.equal(postHeadline("Education · Session open · 08:00 UTC"), "Session open");
  assert.equal(postHeadline("Education · Gold tests 3740 after the open\nmore"), "", "a price in the headline: not shown");
  assert.equal(postHeadline("Education · Gold near 3740 · Friday, 20 November 2026"), "", "the date goes, the price still drops it");
  assert.equal(postHeadline("Sell the rally into resistance"), "", "an order word: not shown");
  assert.equal(postHeadline(""), "");
  const posts = [
    { channel: "x", text: "Education · Newer but hidden", published_at: "2026-11-19T12:00:00.000Z" },
    { channel: "threads", text: "Education · Older post", published_at: "2026-11-18T10:00:00.000Z" },
    { channel: "threads", text: "Education · Pattern breakout · XAUUSD H1\nBreakout line 3755.2", published_at: "2026-11-19T11:49:50.999Z" }
  ];
  assert.deepEqual(latestPost(posts), { channel: "threads", at: "2026-11-19T11:49:50.999Z", headline: "Pattern breakout, XAUUSD H1" }, "Threads only; the body's level never comes along");
  assert.equal(latestPost([]), null);
  const page = read("public/index.html");
  assert.match(page, /id="latest"[^>]*hidden/, "hidden until a post is there");
  assert.ok(page.indexOf('id="latest"') < page.indexOf('id="minutes"'), "between the room and the minutes");
  const home = read("site/home/home.js");
  assert.match(home, /\/api\/public\/archive\?limit=30/);
  assert.doesNotMatch(home, /(post|p|a)\.text\b|posts\[[^\]]*\]\.text/, "the page never shows a post's body (latestPost gives the headline only)");
  const feed = read("site/room/feed.js");
  assert.match(feed, /if \(!document\.hidden\) read\(\)/, "no read in a hidden tab");
  assert.match(feed, /visibilitychange/, "one read when the tab is shown again");
  // Owner 2026-11-20: bearish red, bullish green, neutral amber, on the page and in the scene.
  assert.match(read("public/home.css"), /--bear:#F2606E;--bull:#3FD08A;--flat:#E0A458;/);
  assert.match(read("site/room/main.js"), /BIAS = \{ neutral: 0xffb454, bearish: 0xff4d5e, bullish: 0x3ee08f \}/);
});
