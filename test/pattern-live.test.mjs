// Live patterns (owner 2026-11-27): "berlaku juga untuk 1H/4H/1D termasuk jika ada pattern invalidated tertrigger, dan
// setiap jam perlu recap pattern apa yang sedang aktif dengan target harganya dan pattern apa yang invalidated. karena
// recap jadi tidak perlu gambar." Templates approved as proposed ("Setuju template"); Threads + Telegram; an unchanged
// recap is skipped ("Lewati"); both kinds auto-approved like Chart pattern ("Ya, auto-approve").
import test from "node:test";
import assert from "node:assert/strict";
import { updateLedger, ledgerEntry, invalidatedText, patternRecapText, patternRecapDrafts, recapClose, invalidationDrafts, activePatterns, failOf, kindFamily, TEXT_ONLY_KINDS, PATTERN_RECAP_CHANNELS, PATTERN_COOLDOWN_MS } from "../src/analysis-drafts.mjs";
import { checkContentDraft } from "../src/guardian.mjs";
import { applySettings, defaultSettings } from "../src/settings.mjs";
import { withFamily } from "../src/app.mjs";

const at = Date.parse("2026-11-27T09:20:00Z");
const wedge = (extra = {}) => ({ chart: "H1", pattern: "wedge_rising", name: "Rising Wedge", chapter: 50, status: "confirmed", direction: "down", upper: 3622.4, lower: 3606.1, projection: 3580, ...extra });
const read = (patterns, price = 3631.2, t = at) => ({ at: new Date(t).toISOString(), price, zones: [], patterns });
const passes = (text) => checkContentDraft({ text, allowLevels: true });

test("the ledger: a posted confirmed pattern is invalidated once when it busts or turns the other way; back inside or gone is not", () => {
  const first = updateLedger([], read([wedge()]), { drafted: [wedge()], now: at });
  assert.equal(first.ledger.length, 1);
  assert.deepEqual([first.ledger[0].side, first.ledger[0].level, first.invalidated.length], ["above", 3622.4, 0], "a down breakout fails on a close back above its upper line");
  assert.deepEqual(failOf(wedge({ direction: "up" })), { side: "below", level: 3606.1, line: 3622.4 });
  for (const [label, p, expect] of [["busted", wedge({ status: "busted", direction: "up" }), 1], ["confirmed the other way", wedge({ direction: "up" }), 1], ["back inside its lines", wedge({ status: "forming", direction: "undetermined" }), 0], ["still confirmed", wedge(), 0]]) {
    assert.equal(updateLedger(first.ledger, read([p]), { now: at + 300_000 }).invalidated.length, expect, label);
  }
  assert.equal(updateLedger(first.ledger, read([]), { now: at + 300_000 }).invalidated.length, 0, "no longer read: not a failure");
  const bust = updateLedger(first.ledger, read([wedge({ status: "busted", direction: "up" })]), { now: at + 300_000 });
  assert.equal(updateLedger(bust.ledger, read([wedge({ status: "busted", direction: "up" })]), { now: at + 600_000 }).invalidated.length, 0, "once");
  assert.equal(updateLedger(first.ledger, read([wedge({ status: "busted" })]), { now: at + 17 * 24 * 3_600_000 }).ledger.length, 0, "left after the chart's lookback");
});

test("the invalidated post: the owner's template word for word, passes the guardian, with its card where its confirmed post went", () => {
  const e = ledgerEntry(wedge(), read([wedge()]), at);
  const text = invalidatedText(e, read([], 3631.2, at), { channel: "threads" });
  assert.equal(text, "Education · Pattern invalidated · XAUUSD H1\nRising Wedge · direction down\n\nAn H1 candle closed back above 3622.40: the breakout did not hold.\nIts measured projection 3580.00 no longer applies.\nPrice when read: 3631.20 · 9:20 AM UTC\n\nEducational analysis by Cryptophys. Not an invitation to buy or sell, and not financial advice.");
  assert.deepEqual(passes(text).failures, []);
  const noProj = invalidatedText({ ...e, projection: null }, read([]), { channel: "telegram" });
  assert.doesNotMatch(noProj, /measured projection/i, "a projection that was not sane was never posted, so it is not named");
  const ds = invalidationDrafts([e], read([wedge({ status: "busted", direction: "up" })]), { channels: ["threads", "instagram"], now: at });
  assert.deepEqual(ds.map((d) => [d.id, d.kind, d.status]), [["pinvalid:H1:wedge_rising:3622:3606:threads", "pattern_invalidated", "pending"], ["pinvalid:H1:wedge_rising:3622:3606:instagram", "pattern_invalidated", "needs_image"]]);
  assert.match(ds[1].text, /Chart by TradingView\./, "the card's credit where the post is the card");
  assert.deepEqual([ds[0].overlay.pattern.upper, ds[0].overlay.pattern.lower, ds[0].overlay.pattern.projection, ds[0].overlay.pattern.direction], [3622.4, 3606.1, null, "down"], "the card draws its lines, no projection");
  assert.deepEqual(ds[0].overlay.zones, [], "and no zone or other level");
});

test("the recap at each close (owner 1A, 2A): H1 with M15 every hour, H4 and D1 joined at their closes; invalidated always shown, none when empty", () => {
  const mm = { chart: "H4", pattern: "measured_move_up", name: "Measured Move Up", chapter: 30, status: "confirmed", direction: "up", upper: 3607.25, lower: 3552.14, projection: 3732.58 };
  const flag = { chart: "M15", pattern: "flag", name: "Flag", chapter: 23, status: "confirmed", direction: "up", upper: 3660.5, lower: 3655.2, projection: 3671.1 };
  const rect = { chart: "H1", pattern: "rectangle", name: "Rectangle", chapter: 40, status: "confirmed", direction: "up", upper: 3640, lower: 3620, projection: 3680 };
  const closedAt = (h1, h4, d1) => ({ H1: h1, H4: h4, D1: d1 });
  const reading = (closed, t) => ({ ...read([flag, mm, rect, wedge({ status: "forming" })], 3662.35, t), closed });
  // 16:00 is an H4 close too: "H4 + H1 close", the H4, H1 and M15 patterns
  const at16 = Date.parse("2026-11-27T16:09:30Z");
  const r16 = reading(closedAt("2026-11-27T16:00:00.000Z", "2026-11-27T16:00:00.000Z", "2026-11-26T22:00:00.000Z"), at16);
  assert.deepEqual(recapClose(r16, at16), { closeIso: "2026-11-27T16:00:00.000Z", title: ["H4", "H1"], charts: ["H4", "H1", "M15"] });
  const one = patternRecapDrafts(r16, { channels: ["threads", "telegram", "instagram"], now: at16 });
  assert.deepEqual(one.drafts.map((d) => [d.id, d.kind]), [["precap:20261127T16:threads", "pattern_recap"], ["precap:20261127T16:telegram", "pattern_recap"]]);
  assert.equal(one.drafts[1].text, "Education · XAUUSD pattern recap · H4 + H1 close · 4:00 PM UTC\nPrice when read: 3662.35\n\nActive (confirmed):\n• H4 Measured Move Up · up · breakout 3607.25 · measured projection 3732.58\n• H1 Rectangle · up · breakout 3640.00 · measured projection 3680.00\n• M15 Flag · up · breakout 3660.50 · measured projection 3671.10\n\nInvalidated since the last close: none\n\nPatterns fail often; a measured projection is analysis, not a trade objective.\n\nEducational analysis by Cryptophys. Not an invitation to buy or sell, and not financial advice.\n#XAUUSD #gold");
  assert.deepEqual(passes(one.drafts[1].text).failures, []);
  // 17:00, an H1 close only: H1 and M15, no H4; an H1 pattern invalidated within the hour is listed
  const at17 = Date.parse("2026-11-27T17:09:30Z");
  const r17 = reading(closedAt("2026-11-27T17:00:00.000Z", "2026-11-27T16:00:00.000Z", "2026-11-26T22:00:00.000Z"), at17);
  const ledger = [{ ...ledgerEntry(wedge(), read([]), at16), invalidated_at: "2026-11-27T16:40:00.000Z" }, { ...ledgerEntry(wedge({ chart: "H1", pattern: "old" }), read([]), at16), invalidated_at: "2026-11-27T15:40:00.000Z" }];
  const t17 = patternRecapDrafts(r17, { ledger, channels: ["telegram"], now: at17 }).drafts[0].text;
  assert.match(t17, /^Education · XAUUSD pattern recap · H1 close · 5:00 PM UTC/);
  assert.doesNotMatch(t17, /H4 Measured Move Up/);
  assert.match(t17, /• H1 Rectangle[\s\S]*• M15 Flag/);
  assert.match(t17, /Invalidated since the last close:\n• H1 Rising Wedge · closed back above 3622\.40\n/);
  assert.equal((t17.match(/closed back above/g) ?? []).length, 1, "invalidated before the last close: not listed again");
  // skipped: no fresh close, nothing to list, or the same as the last
  assert.equal(patternRecapDrafts({ ...r17, closed: closedAt("2026-11-27T14:00:00.000Z") }, { now: at17 }).skipped, "no_close");
  assert.equal(patternRecapDrafts({ ...read([]), closed: r17.closed }, { now: at17 }).skipped, "empty");
  const sig = patternRecapDrafts(r17, { now: at17 }).signature;
  assert.equal(patternRecapDrafts(r17, { lastSignature: sig, now: at17 }).skipped, "unchanged");
  // Threads' 500 characters
  const many = { ...read(Array.from({ length: 8 }, (_, i) => ({ ...flag, pattern: `flag${i}`, name: `Flag ${i}`, upper: 3600 + 20 * i, lower: 3595 + 20 * i, projection: 3610 + 20 * i })), 3662.35), closed: r17.closed };
  const short = patternRecapDrafts(many, { channels: ["threads"], now: at17 }).drafts[0].text;
  assert.ok(short.length <= 500 && /Invalidated since the last close: none/.test(short) && /not financial advice/.test(short));
  assert.deepEqual(PATTERN_RECAP_CHANNELS, ["threads", "telegram"]);
});

test("the recap is text only whatever the channel's format; the invalidated post takes its card (owner 2026-11-27); both are Chart pattern for kinds and auto-approve; cooldowns per chart", () => {
  assert.deepEqual(TEXT_ONLY_KINDS, ["pattern_recap"]);
  assert.equal(kindFamily("pattern_recap"), "pattern");
  const imageThreads = { ...defaultSettings("threads"), format: "image" };
  const d = (kind) => ({ id: `${kind}:x:threads`, kind, channel: "threads", text: "Education · x. Not financial advice.", status: "pending", guardian: { pass: true, failures: [] } });
  const out = applySettings([d("pattern_recap"), d("pattern_invalidated"), d("pattern")], { threads: imageThreads });
  assert.deepEqual(out.map((x) => x.status), ["pending", "needs_image", "needs_image"], "the recap never waits for a card; the invalidated post has one, like the confirmed post");
  const dropped = [];
  assert.deepEqual(applySettings([d("pattern_recap")], { threads: { ...imageThreads, kinds: ["key_levels"] } }, { dropped }), []);
  assert.equal(dropped[0].reason, "kind_off", "a channel without Chart pattern takes neither");
  assert.deepEqual(withFamily(["key_levels", "pattern"]), ["key_levels", "pattern", "pattern_invalidated", "pattern_recap"]);
  assert.deepEqual(withFamily(["key_levels"]), ["key_levels"]);
  assert.deepEqual(Object.fromEntries(Object.entries(PATTERN_COOLDOWN_MS).map(([k, v]) => [k, v / 3_600_000])), { M15: 4, H1: 16, H4: 64, D1: 384 });
});

test("M15 drafts get the guardian exactly as H1 to D1: a 0.00 projection or level is refused, at approval and at publish (orchestrator condition on #113)", () => {
  const e = { ...ledgerEntry({ chart: "M15", pattern: "flag", name: "Flag", status: "confirmed", direction: "up", upper: 3660.5, lower: 3655.2, projection: 3671.1 }, read([]), at) };
  const bad = invalidatedText({ ...e, projection: 0 }, read([]), { channel: "threads" });
  assert.ok(checkContentDraft({ text: bad, allowLevels: true }).failures.some((f) => f.check === "projection_not_sane"));
  const m15 = "Education · Pattern breakout · XAUUSD M15\nFlag · direction up\n\nBreakout line 3660.50\nThe pattern fails if an M15 candle closes back below 3655.20.\nMeasured projection: 0.00 (analysis, not a trade objective).\nPrice when read: 3662.35 · 9:20 AM UTC\n\nEducational analysis by Cryptophys. Not an invitation to buy or sell, and not financial advice.";
  assert.deepEqual([...new Set(checkContentDraft({ text: m15, allowLevels: true }).failures.map((f) => f.check))].sort(), ["projection_not_sane", "zero_level"]);
});

test("the recap lists one pattern per chart and band, the first by catalogue order (27 Nov 16:09: Diamond Bottom and Measured Move Up on 3607.25)", () => {
  const p = (pattern, name, chapter, upper, lower, projection) => ({ chart: "H4", pattern, name, chapter, status: "confirmed", direction: "up", upper, lower, projection });
  const analysis = read([p("diamond_bottom", "Diamond Bottom", 12, 3607.25, 3552.14, 3870.31), p("head_and_shoulders_bottom", "Head-and-shoulders Bottom", 20, 3563.18, 3480.1, 3760.15), p("measured_move_up", "Measured Move Up", 30, 3607.25, 3552.14, 3732.58)], 3623.75);
  assert.deepEqual(activePatterns(analysis).map((x) => x.pattern), ["diamond_bottom", "head_and_shoulders_bottom"]);
});

test("a channel with posting slots sends only the newest approved recap; older ones are superseded, never published", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { addDrafts, decideDraft, nextApproved, getDraft } = await import("../src/desk.mjs");
  const db = new DatabaseSync(":memory:");
  const sql = { exec(q, ...b) { const s = db.prepare(q); const out = /^\s*SELECT|\bRETURNING\b/i.test(q) ? s.all(...b) : (s.run(...b), []); return { toArray: () => out.map((r) => ({ ...r })) }; } };
  const t = Date.parse("2026-11-27T17:30:00Z");
  const text = "Education · XAUUSD pattern recap · 4:00 PM UTC\nPrice when read: 3623.75\nNot financial advice.";
  addDrafts(sql, ["16", "17"].map((h) => ({ id: `precap:20261127T${h}:threads`, kind: "pattern_recap", channel: "threads", text, status: "pending" })), { now: t });
  for (const h of ["16", "17"]) decideDraft(sql, { id: `precap:20261127T${h}:threads`, decision: "approve", actor: "cta-agent (auto-approve)" }, { now: t });
  assert.equal(nextApproved(sql, "threads", { now: t }).id, "precap:20261127T17:threads");
  assert.deepEqual([getDraft(sql, "precap:20261127T16:threads").status, getDraft(sql, "precap:20261127T16:threads").error], ["expired", "superseded:precap:20261127T17:threads"]);
});

test("the invalidated post's card shows the pattern's own chart and the Chart pattern label", async () => {
  const { chartOf, cardHtml } = await import("../src/card.mjs");
  const { BRANDS } = await import("../src/brands.mjs");
  const e = ledgerEntry(wedge({ chart: "H4" }), read([]), at);
  const [d] = invalidationDrafts([e], read([wedge({ chart: "H4", status: "busted", direction: "up" })]), { channels: ["instagram"], now: at });
  assert.equal(chartOf(d), "H4");
  assert.match(cardHtml(d, BRANDS["xauusd-ai-cta"]), /Education · Chart pattern/);
});

test("the invalidated card: its own status, the image says invalidated, lines only (no projection, arrow or confirm hint), the guardian passes its words (orchestrator review of #115)", async () => {
  const { overlayLabels, overlaySvg } = await import("../src/card.mjs");
  const e = ledgerEntry(wedge(), read([]), at);
  const [d] = invalidationDrafts([e], read([wedge({ status: "busted", direction: "up" })], 3631.2), { channels: ["instagram"], now: at });
  const o = d.overlay;
  assert.deepEqual([o.pattern.status, o.pattern.projection, o.zones], ["invalidated", null, []]);
  const labels = overlayLabels(o);
  assert.deepEqual(labels, ["Rising Wedge · H1 · invalidated", "Upper line 3622.40", "Lower line 3606.10"]);
  assert.deepEqual(checkContentDraft({ text: `Education. Not financial advice. Chart by TradingView.\n${labels.join("\n")}`, chart: true, allowLevels: true }).failures, []);
  const geo = { pane: { x: 0, y: 0, w: 1000, h: 600 }, xLast: 700, xs: [], ys: [100, 300, 200], range: { from: 3590, to: 3640 } };
  const svg = overlaySvg(o, geo);
  assert.match(svg, /Rising Wedge · H1 · invalidated/);
  assert.doesNotMatch(svg, /Measured projection|Projection area|confirms|stroke-dasharray="12 8"|marker-end/);
});

test("projection reached (owner 2026-11-27, \"setuju\"): not posted at or beyond it, up and down; the recap says \"measured projection reached\"; logged as projection_reached", async () => {
  const { projectionReached, analysisDrafts: raw } = await import("../src/analysis-drafts.mjs");
  const { fresh } = await import("./fresh.mjs");
  const analysisDrafts = (a, o) => raw(fresh(a), o);
  const up = { chart: "M15", pattern: "broadening_wedge_descending", name: "Descending Broadening Wedge", chapter: 7, status: "confirmed", direction: "up", upper: 3625.34, lower: 3596.4, projection: 3650.11 };
  const down = { ...up, pattern: "broadening_wedge_ascending", name: "Ascending Broadening Wedge", direction: "down", upper: 3700, lower: 3680, projection: 3650.11 };
  // up: at, beyond, short of it
  assert.equal(projectionReached(up, 3650.11), true, "up, exactly equal");
  assert.equal(projectionReached(up, 3653.47), true, "up, beyond (the 18:09 M15 post)");
  assert.equal(projectionReached(up, 3640), false);
  // down: at, beyond, short of it
  assert.equal(projectionReached(down, 3650.11), true, "down, exactly equal");
  assert.equal(projectionReached(down, 3640), true, "down, beyond");
  assert.equal(projectionReached(down, 3670), false);
  assert.equal(projectionReached({ ...up, status: "forming" }, 3660), false, "only a confirmed pattern");
  // the post: not drafted, logged
  const at18 = Date.parse("2026-11-27T18:09:30Z");
  const reading = (patterns, price) => ({ at: new Date(at18).toISOString(), price, zones: [], patterns, closed: { H1: "2026-11-27T18:00:00.000Z" } });
  const skipped = [];
  const drafts = analysisDrafts(reading([up], 3653.47), { now: at18, channels: ["threads", "telegram"], maps: false, skipped }).filter((d) => d.kind === "pattern");
  assert.deepEqual(drafts, [], "no post, so no card");
  assert.deepEqual(skipped.map((s) => s.reason), ["projection_reached", "projection_reached"]);
  assert.equal(analysisDrafts(reading([up], 3640), { now: at18, channels: ["threads"], maps: false }).filter((d) => d.kind === "pattern").length, 1, "short of it: posted");
  // the recap: the pattern stays, the number gives way to "measured projection reached"; the guardian passes it
  const recap = patternRecapDrafts(reading([up], 3653.47), { channels: ["telegram"], now: at18 }).drafts[0].text;
  assert.match(recap, /• M15 Descending Broadening Wedge · up · breakout 3625\.34 · measured projection reached\n/);
  assert.doesNotMatch(recap, /3650\.11/);
  assert.deepEqual(passes(recap).failures, []);
});

test("fresh breakout only (owner 2026-11-27, \"setuju aturan breakout maksimal 2 candle\"): closed-bar age 0 or 1 of its chart, else breakout_stale; no confirmed_at_ms, breakout_time_unknown; the recap still lists it; the invalidated post too", async () => {
  const { breakoutState, BREAKOUT_FRESH_BARS, latestClose, analysisDrafts } = await import("../src/analysis-drafts.mjs");
  assert.equal(BREAKOUT_FRESH_BARS, 2);
  const read = Date.parse("2026-11-30T10:03:00Z");
  const min = 60_000, hr = 60 * min;
  assert.equal(latestClose("H1", read), Date.parse("2026-11-30T10:00:00Z"));
  assert.equal(latestClose("H4", read), Date.parse("2026-11-30T08:00:00Z"));
  assert.equal(latestClose("D1", read), Date.parse("2026-11-29T22:00:00Z"), "gold's daily candle closes at 22:00 UTC");
  assert.equal(latestClose("H1", read, "2026-11-30T09:00:00.000Z"), Date.parse("2026-11-30T09:00:00Z"), "xauusd's own close when given");
  // closed-bar age (review of #119): 0 and 1 fresh, 2 stale, a time after the latest close unknown; a read during the forming candle does not shift it
  for (const [chart, bar] of [["M15", 15 * min], ["H1", hr], ["H4", 4 * hr], ["D1", 24 * hr]]) {
    const last = latestClose(chart, read);
    assert.equal(breakoutState(chart, last, read), "fresh", `${chart}: age 0`);
    assert.equal(breakoutState(chart, last - bar, read), "fresh", `${chart}: age 1`);
    assert.equal(breakoutState(chart, last - 2 * bar, read), "stale", `${chart}: age 2, exactly two intervals old`);
    assert.equal(breakoutState(chart, last + bar, read), "unknown", `${chart}: a time in the future`);
    assert.equal(breakoutState(chart, last + 1, read), "unknown", `${chart}: after the latest close`);
    const forming = last + bar - 1; // the next candle still forming, a millisecond before it closes
    assert.equal(breakoutState(chart, last - bar, forming), "fresh", `${chart}: forming candle, age still 1`);
    assert.equal(breakoutState(chart, last - 2 * bar, forming), "stale", `${chart}: forming candle, age still 2`);
  }
  assert.equal(breakoutState("H1", null, read), "unknown");
  assert.equal(breakoutState("H1", undefined, read), "unknown");
  // the drafts: fresh posted, stale and unknown not, each logged
  const pat = (pattern, confirmed_at_ms, extra = {}) => ({ chart: "H1", pattern, name: pattern, chapter: 1, status: "confirmed", direction: "up", upper: 3640 + extra.k * 50, lower: 3620 + extra.k * 50, projection: 3700 + extra.k * 50, ...(confirmed_at_ms === undefined ? {} : { confirmed_at_ms }) });
  const analysis = { at: new Date(read).toISOString(), price: 3630, zones: [], closed: { H1: "2026-11-30T10:00:00.000Z" }, patterns: [pat("fresh_one", Date.parse("2026-11-30T10:00:00Z"), { k: 0 }), pat("stale_one", Date.parse("2026-11-30T07:00:00Z"), { k: 1 }), pat("no_time", undefined, { k: 2 })] };
  const skipped = [];
  const ids = analysisDrafts(analysis, { now: read, channels: ["threads"], maps: false, skipped }).filter((d) => d.kind === "pattern").map((d) => d.id);
  assert.deepEqual(ids, ["pattern:H1:fresh_one:confirmed:3640:3620:threads"]);
  assert.deepEqual(skipped.map((s) => [s.id.split(":")[2], s.reason]), [["stale_one", "breakout_stale"], ["no_time", "breakout_time_unknown"]]);
  // the recap still lists the stale and the unknown ones
  const recap = patternRecapDrafts(analysis, { channels: ["telegram"], now: read }).drafts[0].text;
  for (const n of ["fresh_one", "stale_one", "no_time"]) assert.match(recap, new RegExp(`H1 ${n} `));
  // the invalidated post: its bust's confirmed_at_ms, fresh or not; the ledger marks it invalidated either way
  const entry = ledgerEntry({ chart: "H1", pattern: "wedge_rising", name: "Rising Wedge", status: "confirmed", direction: "down", upper: 3622.4, lower: 3606.1, projection: 3580 }, { price: 3600 }, read - 5 * hr);
  const bust = (t) => ({ at: new Date(read).toISOString(), price: 3631, patterns: [{ chart: "H1", pattern: "wedge_rising", name: "Rising Wedge", status: "busted", direction: "up", upper: 3622.4, lower: 3606.1, projection: null, ...(t === undefined ? {} : { confirmed_at_ms: t }) }] });
  for (const [t, want] of [[Date.parse("2026-11-30T10:00:00Z"), "fresh"], [Date.parse("2026-11-30T07:00:00Z"), "stale"], [undefined, "unknown"]]) {
    const { invalidated } = updateLedger([entry], bust(t), { now: read });
    assert.equal(invalidated.length, 1, "invalidated in the ledger whatever the time");
    assert.equal(breakoutState("H1", invalidated[0].bust_at_ms, read), want);
  }
});
