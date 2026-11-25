// Channel settings (owner 2026-11-16: "setting konfigurasi channel ... content creation terjadwal untuk masing-masing
// channel beserta format contentnya apakah video/image/text only"): validation, the defaults, and the drafting
// honouring them; the studio API stores them per person, never a token.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { normalizeSettings, defaultSettings, effectiveSettings, draftingChannels, applySettings, slotUtc, wibDayStart, FORMATS, PLANNED_FORMATS, KINDS } from "../src/settings.mjs";
import { CHANNELS, HASHTAGS } from "../src/channels.mjs";
import { storedSettings, saveChannelSettings, channelCountsSince, addDrafts, recheck } from "../src/desk.mjs";

function sqlite() {
  const db = new DatabaseSync(":memory:");
  return { exec(q, ...b) { const s = db.prepare(q); const out = /^\s*SELECT/i.test(q) ? s.all(...b) : (s.run(...b), []); return { toArray: () => out.map((r) => ({ ...r })) }; } };
}

test("formats: only what each channel's publisher posts today; the rest is planned and refused", () => {
  assert.deepEqual(FORMATS, { threads: ["text", "image"], instagram: ["image"], x: ["text", "image"], telegram: ["text", "image"], youtube: ["video"], tiktok: ["video"] });
  assert.deepEqual(normalizeSettings("instagram", { format: "image" }).settings.format, "image");
  assert.equal(normalizeSettings("telegram", { format: "image" }).settings.format, "image", "owner 2026-11-17: Telegram with the card");
  assert.equal(defaultSettings("telegram").format, "text", "the default stays text: a person chooses Image");
  assert.match(normalizeSettings("telegram", { format: "video" }).error, /planned, not built yet/);
  assert.match(normalizeSettings("youtube", { format: "text" }).error, /format must be video/);
  for (const c of CHANNELS) assert.ok(PLANNED_FORMATS[c].every((f) => !FORMATS[c].includes(f)), c);
});

test("the defaults are what the engine did before settings existed", () => {
  for (const c of CHANNELS) {
    const d = defaultSettings(c);
    assert.deepEqual([d.enabled, d.kinds, d.max_per_day, d.schedule, d.hashtags], [true, KINDS, 6, [], HASHTAGS[c]]);
  }
  assert.deepEqual(effectiveSettings({}), Object.fromEntries(CHANNELS.map((c) => [c, defaultSettings(c)])));
  // A stored row that no longer validates falls back to the defaults, never to a broken shape.
  assert.deepEqual(effectiveSettings({ x: { format: "video" } }).x, defaultSettings("x"));
});

test("validation: kinds, the daily maximum, schedule slots in WIB, hashtags; anything else refused", () => {
  const ok = normalizeSettings("threads", { enabled: false, kinds: ["pattern", "key_levels", "pattern"], max_per_day: 3,
    schedule: [{ days: ["fri", "mon"], time: "19:30" }, { days: ["mon", "fri"], time: "19:30" }, { days: ["sat"], time: "08:05" }], hashtags: "  #XAUUSD   #gold_edu " });
  assert.ok(ok.ok, ok.error);
  assert.deepEqual(ok.settings, { enabled: false, format: "text", kinds: ["key_levels", "pattern"], max_per_day: 3,
    schedule: [{ days: ["sat"], time: "08:05" }, { days: ["mon", "fri"], time: "19:30" }], hashtags: "", auto_approve: ["key_levels", "pattern", "daily_recap", "warroom"] }, "Threads takes no hashtag line: one topic tag through the API; it approves the owner's four kinds automatically (owner 2026-11-25)");
  assert.equal(normalizeSettings("telegram", { hashtags: "  #XAUUSD   #gold_edu " }).settings.hashtags, "#XAUUSD #gold_edu", "the other channels keep theirs");
  const bad = [
    ["unknown", {}], ["x", null], ["x", []], ["x", { enabled: "yes" }], ["x", { kinds: ["meme"] }], ["x", { max_per_day: 0 }], ["x", { max_per_day: 25 }],
    ["x", { max_per_day: 2.5 }], ["x", { schedule: [{ days: ["mon"], time: "24:00" }] }], ["x", { schedule: [{ days: [], time: "10:00" }] }],
    ["x", { schedule: [{ days: ["someday"], time: "10:00" }] }], ["x", { schedule: Array.from({ length: 13 }, () => ({ days: ["mon"], time: "10:00" })) }],
    ["x", { hashtags: "gold" }], ["x", { hashtags: "#a #b #c #d #e #f #g #h #i" }], ["x", { hashtags: "#gold<script>" }], ["x", { hashtags: "#NexusRoom" }], ["x", { hashtags: "#omega" }]
  ];
  for (const [c, input] of bad) assert.equal(normalizeSettings(c, input).ok, false, JSON.stringify([c, input]));
  assert.deepEqual(slotUtc("mon", "06:30"), { day: "sun", time: "23:30" });
  assert.deepEqual(slotUtc("sun", "19:05"), { day: "sun", time: "12:05" });
  assert.equal(wibDayStart(Date.parse("2026-11-16T16:59:00Z")), "2026-11-15T17:00:00.000Z");
  assert.equal(wibDayStart(Date.parse("2026-11-16T17:00:00Z")), "2026-11-16T17:00:00.000Z");
});

const draft = (channel, kind, n = 1, extra = {}) => ({ id: `${kind}:${channel}:${n}`, channel, kind, text: `Edukasi. Not financial advice.\n${HASHTAGS[channel]}`, decision_times: [], image_url: null, guardian: { pass: true, failures: [] }, status: "pending", ...extra });

test("drafting honours the settings: disabled channels, kinds, the daily maximum and the channel's hashtags (guardian again)", () => {
  const s = effectiveSettings({ x: { enabled: false }, threads: { kinds: ["pattern"], max_per_day: 2, hashtags: "#XAUUSD #edukasi" }, telegram: { hashtags: "#gold #BUY" } });
  assert.deepEqual(draftingChannels(["threads", "x", "telegram"], s), ["threads", "telegram"]);
  const drafts = [draft("threads", "key_levels"), draft("threads", "pattern", 1), draft("threads", "pattern", 2), draft("threads", "pattern", 3), draft("x", "pattern"), draft("telegram", "daily_recap")];
  let rechecked = 0;
  const out = applySettings(drafts, s, { today: { threads: 1 }, recheck: (d) => { rechecked += 1; return { pass: !/#BUY/.test(d.text), failures: [] }; } });
  assert.deepEqual(out.map((d) => d.id), ["pattern:threads:1", "daily_recap:telegram:1"], "one more threads draft today, no key levels, X off");
  assert.doesNotMatch(out[0].text, /#/, "Threads keeps no hashtag line, even with one stored (owner 2026-11-25: one topic tag)");
  assert.ok(out[1].text.endsWith(HASHTAGS.telegram), "hashtags the guardian refuses: the draft keeps the default line");
  assert.equal(rechecked, 1, "only Telegram's line changed");
  // A draft the guardian held is kept as it is (the studio shows why), never re-tagged.
  const held = applySettings([draft("threads", "pattern", 9, { status: "blocked", guardian: { pass: false, failures: [{ check: "x" }] } })], s, { recheck: () => { throw new Error("not called"); } });
  assert.equal(held[0].text, drafts[1].text);
  // The defaults change nothing.
  assert.deepEqual(applySettings(drafts, effectiveSettings({})), drafts);
});

test("the desk stores one row per channel, with who changed it; counts every kind for the daily maximum", () => {
  const sql = sqlite();
  assert.deepEqual(storedSettings(sql), { settings: {}, meta: {} });
  const n = normalizeSettings("x", { enabled: false });
  saveChannelSettings(sql, { channel: "x", settings: n.settings, actor: "owner@example.com" }, { now: Date.parse("2026-11-16T10:00:00Z") });
  saveChannelSettings(sql, { channel: "x", settings: { ...n.settings, max_per_day: 2 }, actor: "editor@example.com" }, { now: Date.parse("2026-11-16T11:00:00Z") });
  const st = storedSettings(sql);
  assert.deepEqual([st.settings.x.max_per_day, st.meta.x.updated_by, st.meta.x.updated_at], [2, "editor@example.com", "2026-11-16T11:00:00.000Z"]);
  assert.equal(sql.exec("SELECT COUNT(*) AS n FROM events WHERE action = 'settings_saved'").toArray()[0].n, 2);
  addDrafts(sql, [draft("x", "pattern", 1), draft("x", "key_levels", 1), draft("threads", "pattern", 1)], { now: Date.parse("2026-11-16T12:00:00Z") });
  assert.deepEqual(channelCountsSince(sql, "2026-11-15T17:00:00.000Z"), { x: 2, threads: 1 });
  assert.equal(recheck(draft("x", "pattern")).pass, true);
});

test("the Channels page: editable settings, saved through the studio API; no token in the markup, no inline script", () => {
  const html = readFileSync(new URL("../public/studio/index.html", import.meta.url), "utf8");
  const js = readFileSync(new URL("../public/studio/studio.js", import.meta.url), "utf8");
  assert.match(js, /\/api\/studio\/settings/);
  assert.match(js, /"POST", \{ channel/);
  // Since 2026-11-17 the Account forms take tokens (test/oauth.test.mjs): only as password inputs built by the
  // script, never in the markup and never through innerHTML.
  assert.doesNotMatch(html, /type="password"|access_token|bot_token/);
  assert.doesNotMatch(js + html, /innerHTML/);
  assert.doesNotMatch(html, /<script>|style="/);
});

test("the format a person chose drives the draft (owner 2026-11-17: Telegram with the image, chosen before it is made)", async () => {
  const { withFormat } = await import("../src/settings.mjs");
  const text = "Education · XAUUSD\n\nGold held its range.\n\nEducational analysis by Cryptophys. Not an invitation to buy or sell, and not financial advice.\n#XAUUSD #gold";
  const d = { id: "t1", channel: "telegram", kind: "key_levels", text, status: "pending", guardian: { pass: true } };
  const img = withFormat(d, "image", { recheck: () => ({ pass: true }) });
  assert.equal(img.status, "needs_image", "waits for its card");
  assert.match(img.text, /Chart by TradingView\.\nEducational analysis/, "TradingView's credit before the disclaimer");
  assert.equal(withFormat(d, "text"), d, "text stays as it is");
  assert.equal(withFormat({ ...d, status: "blocked" }, "image").status, "blocked", "a held draft is not touched");
  assert.equal(withFormat({ ...d, channel: "x" }, "video").status, "pending", "X cannot post a video yet");
  assert.equal(withFormat({ ...d, channel: "threads" }, "image", { recheck: () => ({ pass: true }) }).status, "needs_image", "Threads takes the card");
  assert.equal(withFormat(d, "image", { recheck: () => ({ pass: false }) }).status, "pending", "a guardian refusal keeps the text draft");
  const settings = effectiveSettings({ telegram: { format: "image" } });
  const out = applySettings([d, { ...d, id: "th1", channel: "threads" }], settings);
  assert.deepEqual(out.map((x) => [x.channel, x.status]), [["telegram", "needs_image"], ["threads", "pending"]], "scheduled drafts follow the channel's format");
});
