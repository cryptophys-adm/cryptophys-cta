// The guardian's level checks (owner 2026-11-27: "hapus posting di archived dengan nilai measurement 0.0 dan pastikan
// guardian mengecek dan reject ini sebelum approval posting."): projection_not_sane and zero_level, on approval and in
// the Archive.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { checkContentDraft, levelFailures, saneProjection, PROJECTION_MAX_SHARE, CONTENT_CHECKS } from "../src/guardian.mjs";
import * as drafter from "../src/analysis-drafts.mjs";
import { addDrafts, decideDraft, getDraft, recordPublish, claimPublish, publishedPosts } from "../src/desk.mjs";

// The post that went out on Threads at 07:10Z on 27 Nov (pattern:H1:gap:confirmed:3632:3627), as the Archive has it.
const GAP_0709 = "Education - Pattern breakout - XAUUSD H1\nGap - direction up\n\nBreakout line 3631.57\nThe pattern fails if an H1 candle closes back below 3627.36.\nMeasured projection: 0.00 (analysis, not a trade objective).\nPrice when read: 3662.35 - 7:09 AM UTC\nChart by TradingView.\n\nEducational analysis by Cryptophys. Not an invitation to buy or sell, and not financial advice.";
const SANE = "Education - Pattern breakout - XAUUSD H4\nMeasured Move Up - direction up\n\nBreakout line 3607.25\nThe pattern fails if an H4 candle closes back below 3552.14.\nMeasured projection: 3732.58 (analysis, not a trade objective).\nPrice when read: 3662.35 - 7:09 AM UTC\nChart by TradingView.\n\nEducational analysis by Cryptophys. Not an invitation to buy or sell, and not financial advice.";
const MAP = "Education - XAUUSD key-level map - H4 close - Friday, 27 November 2026 6:00 AM UTC\nPrice when read: 3662.35\n\nH4:\n- Supply (sell area) 3706.50-3710.64 (weak: 4H Camarilla H5)\n- Supply (sell area) 3689.87 (medium: 4H swing high)\n- Demand (buy area) 3607.25 (medium: 4H swing high)\nChart by TradingView.\n\nEducational analysis by Cryptophys. Not an invitation to buy or sell, and not financial advice.";
const check = (text) => checkContentDraft({ text, chart: true, allowLevels: true });
const checks = (text) => check(text).failures.map((f) => f.check);

test("the 07:09 gap post is refused: its projection is not sane and it prints a 0.00 level", () => {
  assert.ok(CONTENT_CHECKS.includes("projection_not_sane") && CONTENT_CHECKS.includes("zero_level"));
  const g = check(GAP_0709);
  assert.equal(g.pass, false);
  assert.deepEqual([...new Set(checks(GAP_0709))].sort(), ["projection_not_sane", "zero_level"]);
  assert.ok(g.failures.some((f) => f.detail === "measured projection 0.00"), JSON.stringify(g.failures));
  // the same text as drafted, before the humanizer (· and –)
  assert.ok(checks(GAP_0709.replaceAll(" - ", " · ")).includes("projection_not_sane"));
});

test("a sane projection passes; a post with no projection passes", () => {
  assert.deepEqual(check(SANE).failures, []);
  assert.deepEqual(check(MAP).failures, []);
  assert.deepEqual(check(MAP.replace("3706.50-3710.64", "3706.50–3710.64")).failures, [], "an en dash between the edges");
  // a recap: counts, not levels
  assert.deepEqual(checkContentDraft({ text: "Education · recap. Our analysis system read 2 15-minute bars: 0 leaning up, 0 leaning down, 2 choosing to wait. Not financial advice." }).failures, []);
});

test("a projection the drafter would leave out is refused: below 0, not a number, too far, or on the wrong side", () => {
  for (const x of ["-5.00", "NaN", "Infinity", "undefined", "9999.00", "1500.00", "3600.00"]) {
    assert.ok(checks(SANE.replace("3732.58", x)).includes("projection_not_sane"), x);
  }
  const down = SANE.replace("Measured Move Up - direction up", "Measured Move Down - direction down").replace("closes back below 3552.14", "closes back above 3660.00");
  assert.ok(checks(down).includes("projection_not_sane"), "direction down with the projection above the breakout line");
  assert.deepEqual(check(down.replace("3732.58", "3500.10")).failures, [], "below the breakout line for down: sane");
  // the guardian and the drafter agree: one rule, re-exported for the drafter
  assert.equal(drafter.saneProjection, saneProjection);
  assert.equal(drafter.PROJECTION_MAX_SHARE, PROJECTION_MAX_SHARE);
});

test("a published level printed as 0.00 or below is refused: a zone edge, the breakout line, the fail level, the price", () => {
  for (const [from, to] of [["3706.50-3710.64", "0.00-3710.64"], ["3706.50-3710.64", "3706.50–0.00"], ["3689.87 (medium", "-3.50 (medium"], ["Price when read: 3662.35", "Price when read: 0.00"]]) {
    const t = MAP.replace(from, to);
    assert.ok(checks(t).includes("zero_level"), to);
  }
  assert.ok(checks(SANE.replace("Breakout line 3607.25", "Breakout line 0.00")).includes("zero_level"));
  assert.ok(checks(SANE.replace("closes back below 3552.14", "closes back below -1.00")).includes("zero_level"));
  assert.ok(checks(SANE.replace("Breakout line 3607.25", "Breakout line NaN")).includes("zero_level"));
  assert.deepEqual(levelFailures("Education. Change 0.00% today. Not financial advice."), [], "a percentage is not a level");
});

const sqlite = () => {
  const db = new DatabaseSync(":memory:");
  return { exec(q, ...b) { const s = db.prepare(q); const out = /^\s*SELECT|\bRETURNING\b/i.test(q) ? s.all(...b) : (s.run(...b), []); return { toArray: () => out.map((r) => ({ ...r })) }; } };
};

test("on approval (a person's or the auto-approve rule's): the 07:09 text is blocked with its reasons; a sane one is approved", () => {
  const sql = sqlite();
  const now = Date.parse("2026-11-27T07:10:00Z");
  addDrafts(sql, [{ id: "pattern:H1:gap:confirmed:3632:3627:threads", kind: "pattern", channel: "threads", text: GAP_0709, status: "pending" },
    { id: "pattern:H4:measured_move_up:confirmed:3607:3552:threads", kind: "pattern", channel: "threads", text: SANE, status: "pending" }], { now });
  const bad = decideDraft(sql, { id: "pattern:H1:gap:confirmed:3632:3627:threads", decision: "approve", actor: "cta-agent (auto-approve)" }, { now });
  assert.equal(bad.status, "blocked");
  assert.deepEqual([...new Set(bad.guardian.failures.map((f) => f.check))].sort(), ["projection_not_sane", "zero_level"], "the reasons the studio shows");
  assert.equal(getDraft(sql, "pattern:H1:gap:confirmed:3632:3627:threads").status, "blocked");
  assert.equal(decideDraft(sql, { id: "pattern:H4:measured_move_up:confirmed:3607:3552:threads", decision: "approve", actor: "owner" }, { now }).status, "approved");
});

test("the Archive leaves out a published post whose text fails the level checks; the desk keeps it published", () => {
  const sql = sqlite();
  const now = Date.parse("2026-11-27T07:10:00Z");
  const posts = [["pattern:H1:gap:confirmed:3632:3627:threads", GAP_0709, "threads"], ["pattern:H1:gap:confirmed:3632:3627:telegram", GAP_0709, "telegram"], ["levels:H4:20261127T060000Z:threads", MAP, "threads"]];
  addDrafts(sql, posts.map(([id, text, channel]) => ({ id, kind: id.startsWith("pattern") ? "pattern" : "key_levels", channel, text, status: "pending" })), { now });
  for (const [id] of posts) {
    // published before the rule existed: approved and claimed as they were then
    sql.exec("UPDATE drafts SET status = 'approved' WHERE id = ?", id);
    assert.equal(claimPublish(sql, { id }, { now }).ok, true);
    recordPublish(sql, { id, remoteId: `r-${id}` }, { now });
  }
  assert.deepEqual(publishedPosts(sql, { limit: 30 }).map((p) => p.id), ["levels:H4:20261127T060000Z:threads"], "neither copy of the gap post is shown");
  assert.equal(getDraft(sql, "pattern:H1:gap:confirmed:3632:3627:threads").status, "published", "nothing deleted: the post and its history stay");
});
