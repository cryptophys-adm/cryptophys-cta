// The holo war room home page (owner 2026-11-19): the live scene's script, the public data, the build, the routing
// and the security headers of the static files.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { PEOPLE, MEETINGS, READS, DEPTS } from "../site/room/data.js";
import { meetingFromScene, meetingsFromResponse, freshMeetings, latestMeeting, safeLine } from "../site/room/script.js";
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
  assert.deepEqual(w.talk, [{ agent: "news", text: "the dollar index strength · the gold ETF outflow trend" }]);
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
  assert.ok(navigatorHtml().includes("<p>"), "each agent's role is text on the page (screen readers, no WebGL)");
  const files = readdirSync(new URL("../public/room/", import.meta.url)).sort();
  assert.deepEqual(files, ["CREDITS.txt", "build.json", "mannequin.glb", "room.js"]);
  const credits = read("public/room/CREDITS.txt");
  assert.match(credits, /Quaternius/); assert.match(credits, /CC0 1\.0/); assert.match(credits, /three\.js/); assert.match(credits, /MIT License/);
  const glb = readFileSync(new URL("../public/room/mannequin.glb", import.meta.url));
  assert.equal(createHash("sha256").update(glb).digest("hex"), "0d11eb3bbc6df8d30dfe75ce7cc2f060df99c01cf43ed7a4d505332272afacc2", "the file CREDITS.txt describes");
});

test("RM5 static files carry the Worker's security headers; the page has no inline style, inline script or web font", () => {
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
  assert.doesNotMatch(read("public/home.css"), /@import|url\(\s*["']?https?:/i);
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
  assert.match(read("site/room/main.js"), /cache: 'no-store'/, "the page polls past the browser cache");
  const failing = await warroomScene({ PROJECTION: { warroomScene: async () => { throw new Error("down"); } } }, new Request("https://x/api/public/warroom-scene"), { match: async () => null, put: async () => { throw new Error("must not cache"); } });
  assert.equal(failing.status, 502);
  assert.equal(failing.headers.get("cache-control"), "no-store");
  assert.deepEqual((await failing.json()).rooms, {});
  const none = await warroomScene({}, new Request("https://x/api/public/warroom-scene"), undefined);
  assert.equal(none.status, 502, "an AI Worker without the entrypoint");
});
