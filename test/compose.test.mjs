// Create (owner 2026-11-16: content creation in the studio; person-written posts allowed, "tetap guardian"):
// templates from the current analysis, the guardian per channel, all-or-nothing saving, a person only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { templateTexts, checkPost, composeDrafts, customTemplate, overlayFor, COMPOSE_KINDS } from "../src/compose.mjs";
import { effectiveSettings } from "../src/settings.mjs";
import { HASHTAGS, TEXT_LIMITS } from "../src/channels.mjs";

const NOW = Date.parse("2026-11-17T08:00:00Z");
const ANALYSIS = {
  at: "2026-11-17T07:09:00.000Z", price: 4080.5,
  zones: [{ role: "supply", low: 4098.2, high: 4102.6, strength: "strong", metrics: ["4H Camarilla H4"] }, { role: "demand", low: 4061.4, high: 4066, strength: "moderate", metrics: ["weekly VWAP"] }],
  patterns: [{ chart: "H4", pattern: "ascending_triangle", name: "Ascending Triangle", status: "forming", upper: 4098.2, lower: 4071.6 }]
};
const settings = effectiveSettings({ threads: { hashtags: "#XAUUSD #edukasi" } });

test("templates: blank, key levels, pattern and recap per channel, with the channel's hashtags", () => {
  const blank = templateTexts("custom", { channels: ["threads", "instagram", "x"], settings });
  assert.ok(blank.texts.threads.endsWith("#XAUUSD #edukasi"));
  assert.match(blank.texts.instagram, /Chart by TradingView\./, "the card's credit where the post is the chart");
  assert.match(blank.texts.x, /Education only\. Not financial advice\./);
  const lv = templateTexts("key_levels", { channels: ["threads", "telegram"], settings, analysis: ANALYSIS });
  assert.match(lv.texts.telegram, /4098\.20–4102\.60/);
  assert.equal(lv.at, ANALYSIS.at);
  const pt = templateTexts("pattern", { channels: ["threads"], settings, analysis: ANALYSIS });
  assert.deepEqual(pt.options.map((o) => o.label), ["H4 · Ascending Triangle · forming"]);
  assert.equal(pt.ref, pt.options[0].ref);
  assert.match(pt.texts.threads, /Ascending Triangle/);
  assert.match(templateTexts("pattern", { channels: ["threads"], settings, analysis: { ...ANALYSIS, patterns: [] } }).note, /No pattern/);
  assert.match(templateTexts("daily_recap", { channels: ["threads"], settings, recaps: [], now: NOW }).note, /No recap/);
  assert.equal(templateTexts("meme", { channels: ["threads"], settings }).error, "unknown kind");
  assert.deepEqual(COMPOSE_KINDS, ["custom", "key_levels", "pattern", "daily_recap"]);
});

test("the guardian per channel: the blank post needs words; advice, internal names, levels in a custom post and overlong text are refused", () => {
  const ok = "Education · XAUUSD\n\nGold held its range through London.\n\nEducational analysis by Cryptophys. Not an invitation to buy or sell, and not financial advice.\n#XAUUSD";
  assert.equal(checkPost({ channel: "threads", kind: "custom", text: ok, now: NOW }).guardian.pass, true);
  const bad = (text, kind = "custom", channel = "threads") => checkPost({ channel, kind, text, now: NOW }).guardian.failures.map((f) => f.check);
  assert.ok(bad(ok.replace("Gold held", "Buy now, gold held")).includes("instruction"));
  assert.ok(bad(ok.replace("Gold held", "Nexus says gold held")).includes("internal"));
  assert.ok(bad(ok.replace("its range", "4080.50")).includes("price_level"), "a custom post carries no price level");
  assert.deepEqual(bad(ok.replace("its range", "4080.50"), "key_levels"), [], "the analysis kinds do");
  assert.ok(bad(ok, "custom", "instagram").includes("attribution"), "the card carries TradingView's chart");
  assert.ok(bad(ok.replace("Gold held", "x".repeat(TEXT_LIMITS.threads))).includes("length"));
  assert.ok(bad(ok, "meme").includes("kind"));
  assert.equal(checkPost({ channel: "threads", kind: "custom", text: ok.replace(/\n/g, "\r\n"), now: NOW }).length, ok.length, "line ends are normalised");
  assert.ok(customTemplate("threads", HASHTAGS.threads).includes("\n\n\n\n"), "room to write");
  for (const c of ["threads", "instagram", "x"]) {
    assert.ok(checkPost({ channel: c, kind: "custom", text: customTemplate(c, HASHTAGS[c]), now: NOW }).guardian.failures.some((f) => f.check === "body"), `an unedited blank post is refused (${c})`);
  }
});

test("composing: every channel must pass or nothing is saved; drafts wait for approval like the engine's", () => {
  const ok = "Education · XAUUSD\n\nGold held its range through London.\n\nEducational analysis by Cryptophys. Not an invitation to buy or sell, and not financial advice.\n#XAUUSD";
  const refused = composeDrafts({ kind: "custom", posts: [{ channel: "threads", text: ok }, { channel: "instagram", text: ok }], now: NOW, id: "ab12cd34" });
  assert.equal(refused.ok, false);
  assert.equal(refused.results.threads.guardian.pass, true);
  assert.deepEqual(refused.results.instagram.guardian.failures.map((f) => f.check), ["attribution"]);
  const insta = ok.replace("\n\nEducational", "\n\nChart by TradingView.\nEducational");
  const made = composeDrafts({ kind: "key_levels", posts: [{ channel: "threads", text: ok }, { channel: "instagram", text: insta }], now: NOW, id: "ab12cd34", overlay: () => overlayFor("key_levels", ANALYSIS) });
  assert.ok(made.ok, JSON.stringify(made));
  assert.deepEqual(made.drafts.map((d) => [d.id, d.status]), [["manual:2026-11-17:ab12cd34:threads", "pending"], ["manual:2026-11-17:ab12cd34:instagram", "needs_image"]]);
  assert.equal(made.drafts[0].overlay.zones.length, 2, "a text channel keeps the card's numbers too, for when its format is Image");
  assert.equal(made.drafts[1].overlay.zones.length, 2, "the card draws the template's numbers, from the server's analysis");
  for (const [input, err] of [[[], /at least one/], [[{ channel: "myspace", text: ok }], /unknown channel/], [[{ channel: "threads", text: ok }, { channel: "threads", text: ok }], /twice/], [null, /at least one/]]) {
    assert.match(composeDrafts({ kind: "custom", posts: input, now: NOW, id: "x" }).error, err);
  }
  assert.match(composeDrafts({ kind: "custom", posts: [{ channel: "tiktok", text: ok }], allowed: ["threads"], now: NOW, id: "x" }).error, /not enabled/);
  assert.equal(overlayFor("pattern", ANALYSIS, "nope"), null);
  assert.equal(overlayFor("custom", ANALYSIS), null);
});

test("the Create page: a nav item, editors per channel, the guardian shown, sent through the studio API; no inline script", () => {
  const html = readFileSync(new URL("../public/studio/index.html", import.meta.url), "utf8");
  const js = readFileSync(new URL("../public/studio/studio.js", import.meta.url), "utf8");
  assert.match(html, /data-view="create"/);
  assert.match(html, /id="view-create"/);
  for (const p of ["/api/studio/templates", "/api/studio/check", "/api/studio/compose"]) assert.ok(js.includes(p), p);
  assert.doesNotMatch(js + html, /innerHTML|<script>|style="/);
});
