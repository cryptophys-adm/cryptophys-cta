// The per-channel scheduler's slot arithmetic (WIB, UTC+7): which slots are due, which come next, a slot used once.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { slotMs, slotsBetween, dueSlots, nextSlots, MISSED_AFTER_MS, SCHEDULE_CRON } from "../src/scheduler.mjs";
import { claimSlot, slotOutcome, recentSlots, addDrafts, decideDraft, nextApproved, approvedCounts } from "../src/desk.mjs";

const S = [{ days: ["mon", "tue", "wed", "thu", "fri"], time: "19:00" }, { days: ["sat"], time: "06:30" }];
const MON = Date.parse("2026-11-16T12:00:00Z"); // Monday 19:00 WIB

test("slots in WIB: due within 30 minutes, the next ones, across midnight and the week's end", () => {
  assert.equal(SCHEDULE_CRON, "*/5 * * * *");
  assert.equal(slotMs("2026-11-16", "19:00"), MON);
  assert.equal(slotMs("2026-11-21", "06:30"), Date.parse("2026-11-20T23:30:00Z"), "Saturday 06:30 WIB is Friday 23:30 UTC");
  assert.deepEqual(dueSlots(S, MON).map((x) => x.key), ["2026-11-16T19:00"]);
  assert.deepEqual(dueSlots(S, MON + MISSED_AFTER_MS - 1).map((x) => x.key), ["2026-11-16T19:00"]);
  assert.deepEqual(dueSlots(S, MON + MISSED_AFTER_MS + 1), [], "older than 30 minutes: skipped");
  assert.deepEqual(dueSlots(S, MON - 1), []);
  assert.deepEqual(nextSlots(S, MON, 6).map((x) => x.key), ["2026-11-17T19:00", "2026-11-18T19:00", "2026-11-19T19:00", "2026-11-20T19:00", "2026-11-21T06:30", "2026-11-23T19:00"]);
  assert.deepEqual(slotsBetween([{ days: ["mon"], time: "19:00" }, { days: ["mon"], time: "19:00" }], MON - 1, MON).length, 1, "one slot per moment");
  assert.deepEqual(nextSlots([], MON), []);
  assert.deepEqual(nextSlots([{ days: ["sun"], time: "00:00" }], MON, 1).map((x) => [x.key, new Date(x.at).toISOString()]), [["2026-11-22T00:00", "2026-11-21T17:00:00.000Z"]]);
});

test("the desk: a slot is claimed once; the oldest approved draft is next; outcomes are kept", () => {
  const db = new DatabaseSync(":memory:");
  const sql = { exec(q, ...b) { const s = db.prepare(q); const out = /^\s*SELECT/i.test(q) ? s.all(...b) : (s.run(...b), []); return { toArray: () => out.map((r) => ({ ...r })) }; } };
  assert.equal(claimSlot(sql, { key: "2026-11-16T19:00", channel: "threads", at: MON }, { now: MON }), true);
  assert.equal(claimSlot(sql, { key: "2026-11-16T19:00", channel: "threads", at: MON }, { now: MON + 1 }), false);
  assert.equal(claimSlot(sql, { key: "2026-11-16T19:00", channel: "x", at: MON }, { now: MON }), true, "per channel");
  slotOutcome(sql, { key: "2026-11-16T19:00", channel: "threads", outcome: "empty" });
  assert.deepEqual(recentSlots(sql).map((r) => [r.key, r.outcome]).sort(), [["threads@2026-11-16T19:00", "empty"], ["x@2026-11-16T19:00", "claimed"]]);
  addDrafts(sql, [{ id: "a", channel: "threads", kind: "custom", text: "Education only. Not financial advice.", status: "pending" }, { id: "b", channel: "threads", kind: "custom", text: "Education only. Not financial advice. b", status: "pending" }]);
  decideDraft(sql, { id: "b", decision: "approve", actor: "o" }, { now: MON - 2000 });
  decideDraft(sql, { id: "a", decision: "approve", actor: "o" }, { now: MON - 1000 });
  assert.equal(nextApproved(sql, "threads").id, "b", "approved first, posted first");
  assert.equal(nextApproved(sql, "x"), null);
  assert.deepEqual(approvedCounts(sql), { threads: 2 });
});
