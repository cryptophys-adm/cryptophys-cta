// Live patterns (owner 2026-11-27): "berlaku juga untuk 1H/4H/1D termasuk jika ada pattern invalidated tertrigger, dan
// setiap jam perlu recap pattern apa yang sedang aktif dengan target harganya dan pattern apa yang invalidated. karena
// recap jadi tidak perlu gambar." Templates approved as proposed ("Setuju template"); Threads + Telegram; an unchanged
// recap is skipped ("Lewati"); both kinds auto-approved like Chart pattern ("Ya, auto-approve").
import test from "node:test";
import assert from "node:assert/strict";
import { updateLedger, ledgerEntry, invalidatedText, patternRecapText, patternRecapDrafts, invalidationDrafts, activePatterns, failOf, kindFamily, TEXT_ONLY_KINDS, PATTERN_RECAP_CHANNELS, PATTERN_COOLDOWN_MS } from "../src/analysis-drafts.mjs";
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

test("the invalidated post: text only, the owner's template word for word, passes the guardian", () => {
  const e = ledgerEntry(wedge(), read([wedge()]), at);
  const text = invalidatedText(e, read([], 3631.2, at), { channel: "threads" });
  assert.equal(text, "Education · Pattern invalidated · XAUUSD H1\nRising Wedge · direction down\n\nAn H1 candle closed back above 3622.40: the breakout did not hold.\nIts measured projection 3580.00 no longer applies.\nPrice when read: 3631.20 · 9:20 AM UTC\n\nEducational analysis by Cryptophys. Not an invitation to buy or sell, and not financial advice.");
  assert.deepEqual(passes(text).failures, []);
  const noProj = invalidatedText({ ...e, projection: null }, read([]), { channel: "telegram" });
  assert.doesNotMatch(noProj, /measured projection/i, "a projection that was not sane was never posted, so it is not named");
  const ds = invalidationDrafts([e], read([]), { channels: ["threads", "telegram"], now: at });
  assert.deepEqual(ds.map((d) => [d.id, d.kind, d.status]), [["pinvalid:H1:wedge_rising:3622:3606:threads", "pattern_invalidated", "pending"], ["pinvalid:H1:wedge_rising:3622:3606:telegram", "pattern_invalidated", "pending"]]);
});

test("the hourly recap: the owner's template, active with measured projection and invalidated in the last hour; skipped when empty or unchanged", () => {
  const mm = { chart: "H4", pattern: "measured_move_up", name: "Measured Move Up", chapter: 30, status: "confirmed", direction: "up", upper: 3607.25, lower: 3552.14, projection: 3732.58 };
  const flag = { chart: "M15", pattern: "flag", name: "Flag", chapter: 23, status: "confirmed", direction: "up", upper: 3660.5, lower: 3655.2, projection: 3671.1 };
  const analysis = read([flag, mm, wedge({ status: "forming" })], 3662.35, Date.parse("2026-11-27T09:09:00Z"));
  assert.deepEqual(activePatterns(analysis).map((p) => p.chart), ["H4", "M15"], "largest chart first; forming is not active");
  const inv = [{ ...ledgerEntry(wedge(), read([]), at), invalidated_at: new Date(at).toISOString() }];
  const text = patternRecapText({ active: activePatterns(analysis), invalidated: inv, analysis, hourIso: "2026-11-27T09:00:00.000Z" }, { channel: "telegram" });
  assert.equal(text, "Education · XAUUSD pattern recap · 9:00 AM UTC\nPrice when read: 3662.35\n\nActive (confirmed):\n• H4 Measured Move Up · up · breakout 3607.25 · measured projection 3732.58\n• M15 Flag · up · breakout 3660.50 · measured projection 3671.10\n\nInvalidated in the last hour:\n• H1 Rising Wedge · closed back above 3622.40\n\nPatterns fail often; a measured projection is analysis, not a trade objective.\n\nEducational analysis by Cryptophys. Not an invitation to buy or sell, and not financial advice.\n#XAUUSD #gold");
  assert.deepEqual(passes(text).failures, []);
  // Threads' 500 characters: the smallest charts' lines go first, never the title, price, closing line or disclaimer
  const many = read(Array.from({ length: 8 }, (_, i) => ({ ...flag, pattern: `flag${i}`, name: `Flag ${i}` })), 3662.35);
  const short = patternRecapText({ active: activePatterns(many), invalidated: inv, analysis: many, hourIso: "2026-11-27T09:00:00.000Z" }, { channel: "threads" });
  assert.ok(short.length <= 500 && /^Education · XAUUSD pattern recap/.test(short) && /Patterns fail often/.test(short) && /not financial advice/.test(short));
  // the drafts: Threads and Telegram only, text, not again when nothing changed, none when empty
  const now = Date.parse("2026-11-27T09:09:30Z");
  assert.deepEqual(PATTERN_RECAP_CHANNELS, ["threads", "telegram"]);
  const one = patternRecapDrafts(analysis, { invalidated: inv, channels: ["threads", "telegram", "instagram"], now });
  assert.deepEqual(one.drafts.map((d) => [d.id, d.kind]), [["precap:20261127T09:threads", "pattern_recap"], ["precap:20261127T09:telegram", "pattern_recap"]]);
  assert.deepEqual(patternRecapDrafts(analysis, { invalidated: inv, lastSignature: one.signature, now: now + 3_600_000 }), { drafts: [], signature: one.signature, skipped: "unchanged" });
  assert.equal(patternRecapDrafts(read([]), { now }).skipped, "empty");
  assert.equal(patternRecapDrafts(analysis, { lastSignature: one.signature, now }).drafts.length, 2, "the invalidated list changed: a new recap");
});

test("the two kinds: text only whatever the channel's format, part of Chart pattern for kinds and auto-approve; cooldowns per chart", () => {
  assert.deepEqual(TEXT_ONLY_KINDS, ["pattern_invalidated", "pattern_recap"]);
  assert.equal(kindFamily("pattern_recap"), "pattern");
  const imageThreads = { ...defaultSettings("threads"), format: "image" };
  const d = (kind) => ({ id: `${kind}:x:threads`, kind, channel: "threads", text: "Education · x. Not financial advice.", status: "pending", guardian: { pass: true, failures: [] } });
  const out = applySettings([d("pattern_recap"), d("pattern_invalidated"), d("pattern")], { threads: imageThreads });
  assert.deepEqual(out.map((x) => x.status), ["pending", "pending", "needs_image"], "the recap and the invalidated post never wait for a card");
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
