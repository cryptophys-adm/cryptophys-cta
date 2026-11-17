// Aged analysis drafts expire (owner 2026-11-17: "kadaluwarsa otomatis", after a 06:10 UTC key-level map went out at 15:50).
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { addDrafts, getDraft, draftEvents, decideDraft, recordPublish, requeueFailed, duplicateDraft, nextApproved, expireStale, isStale, ANALYSIS_TTL_HOURS, STATUSES } from "../src/desk.mjs";

function sqlite() {
  const db = new DatabaseSync(":memory:");
  return { exec(q, ...b) { const s = db.prepare(q); const out = /^\s*SELECT/i.test(q) ? s.all(...b) : (s.run(...b), []); return { toArray: () => out.map((r) => ({ ...r })) }; } };
}
const T0 = Date.parse("2026-11-17T06:10:00Z");
const H = 3_600_000;
const text = "Education · XAUUSD key-level map\n\nDemand zones (buy area):\n• 3848.95–3852.58\n\nEducational analysis by Cryptophys. Not an invitation to buy or sell, and not financial advice.\n#XAUUSD";
const recap = "Education · XAUUSD\n\nGold held its range through London.\n\nEducational analysis by Cryptophys. Not an invitation to buy or sell, and not financial advice.\n#XAUUSD";
function seeded() {
  const sql = sqlite();
  addDrafts(sql, [
    { id: "levels:a:threads", kind: "key_levels", channel: "threads", text, status: "pending" },
    { id: "levels:b:threads", kind: "key_levels", channel: "threads", text, status: "pending" },
    { id: "recap:c:threads", kind: "daily_recap", channel: "threads", text: recap, status: "pending" }
  ], { now: T0 });
  return sql;
}

test("EX1. an analysis draft expires after the limit; a recap never does", () => {
  assert.equal(ANALYSIS_TTL_HOURS, 2);
  assert.ok(STATUSES.includes("expired"));
  const sql = seeded();
  assert.equal(isStale(getDraft(sql, "levels:a:threads"), { now: T0 + 1.9 * H }), false);
  assert.equal(isStale(getDraft(sql, "levels:a:threads"), { now: T0 + 2.1 * H }), true);
  assert.equal(isStale(getDraft(sql, "recap:c:threads"), { now: T0 + 30 * H }), false, "a recap is about the past");
  assert.deepEqual(expireStale(sql, { now: T0 + H }), [], "nothing before the limit");
  assert.deepEqual(expireStale(sql, { now: T0 + 3 * H }).sort(), ["levels:a:threads", "levels:b:threads"]);
  assert.equal(getDraft(sql, "recap:c:threads").status, "pending");
  assert.equal(draftEvents(sql, "levels:a:threads")[0].action, "expired");
  assert.deepEqual(expireStale(sql, { now: T0 + 4 * H }), [], "once");
});

test("EX2. approving, sending again, the next slot and a copy all refuse an aged analysis", () => {
  const sql = seeded();
  // Approval within the limit works; the approved one waits for a slot.
  assert.equal(decideDraft(sql, { id: "levels:a:threads", decision: "approve", actor: "owner" }, { now: T0 + H }).status, "approved");
  assert.equal(nextApproved(sql, "threads", { now: T0 + 1.5 * H })?.id, "levels:a:threads");
  // By the next slot it has aged: the slot finds nothing to post, and the draft is expired.
  assert.equal(nextApproved(sql, "threads", { now: T0 + 2.5 * H }), null);
  assert.equal(getDraft(sql, "levels:a:threads").status, "expired");
  // That run expired every aged analysis, the pending one too: it can no longer be approved.
  assert.match(decideDraft(sql, { id: "levels:b:threads", decision: "approve", actor: "owner" }, { now: T0 + 3 * H }).error, /expired, not pending/);
  // An approval after the limit, before any run marked it, expires the draft instead.
  const sql3 = seeded();
  const late = decideDraft(sql3, { id: "levels:b:threads", decision: "approve", actor: "owner" }, { now: T0 + 3 * H });
  assert.deepEqual([late.ok, late.status], [true, "expired"]);
  assert.match(late.note, /older than 2 hours/);
  // A failed post that has aged is not sent again.
  const sql2 = seeded();
  decideDraft(sql2, { id: "levels:a:threads", decision: "approve", actor: "owner" }, { now: T0 + H });
  recordPublish(sql2, { id: "levels:a:threads", error: "timeout" }, { now: T0 + H });
  assert.equal(requeueFailed(sql2, { id: "levels:a:threads", actor: "owner" }, { now: T0 + 3 * H }), false);
  assert.equal(getDraft(sql2, "levels:a:threads").status, "expired");
  // A copy of an aged analysis would carry old levels as new.
  const copy = duplicateDraft(sql, { id: "levels:a:threads", newId: "copy", actor: "owner", check: () => ({ guardian: { pass: true } }) }, { now: T0 + 3 * H });
  assert.equal(copy.ok, false); assert.match(copy.error, /older than 2 hours/);
});
