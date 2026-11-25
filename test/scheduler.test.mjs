// The per-channel scheduler's slot arithmetic (WIB, UTC+7): which slots are due, which come next, a slot used once.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { slotMs, slotsBetween, dueSlots, nextSlots, MISSED_AFTER_MS, SCHEDULE_CRON } from "../src/scheduler.mjs";
import { readFileSync } from "node:fs";
import { claimSlot, slotOutcome, recentSlots, addDrafts, decideDraft, nextApproved, approvedCounts, supersedeMaps, getDraft, draftEvents, recordPublish } from "../src/desk.mjs";

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
  const sql = { exec(q, ...b) { const s = db.prepare(q); const out = /^\s*SELECT|\bRETURNING\b/i.test(q) ? s.all(...b) : (s.run(...b), []); return { toArray: () => out.map((r) => ({ ...r })) }; } };
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

test("newest wins (orchestrator, 2026-11-25): a slot sends the newest approved map of each chart; older ones of the same chart are superseded, other kinds keep their order", () => {
  const db = new DatabaseSync(":memory:");
  const sql = { exec(q, ...b) { const s = db.prepare(q); const out = /^\s*SELECT|\bRETURNING\b/i.test(q) ? s.all(...b) : (s.run(...b), []); return { toArray: () => out.map((r) => ({ ...r })) }; } };
  const T = Date.parse("2026-11-25T10:00:00Z");
  const text = "Education · XAUUSD key-level map\nx\n\nEducational analysis by Cryptophys. Not an invitation to buy or sell, and not financial advice.";
  const map = (id) => ({ id, channel: "threads", kind: "key_levels", text, status: "pending" });
  addDrafts(sql, [map("levels:H1:20261125T080000Z:threads"), map("levels:H1:20261125T090000Z:threads"), map("levels:H4+H1:20261125T080000Z:threads"),
    { id: "daily:2026-11-24:threads", channel: "threads", kind: "daily_recap", text: "Education only. Not financial advice.", status: "pending" }], { now: T - 3_000_000 });
  for (const [id, at] of [["daily:2026-11-24:threads", T - 2_900_000], ["levels:H1:20261125T080000Z:threads", T - 2_800_000], ["levels:H4+H1:20261125T080000Z:threads", T - 2_700_000], ["levels:H1:20261125T090000Z:threads", T - 2_600_000]])
    decideDraft(sql, { id, decision: "approve", actor: "auto-approve" }, { now: at });
  assert.equal(nextApproved(sql, "threads", { now: T }).id, "daily:2026-11-24:threads", "other kinds keep their order");
  const older = getDraft(sql, "levels:H1:20261125T080000Z:threads");
  assert.deepEqual([older.status, older.error], ["expired", "superseded:levels:H1:20261125T090000Z:threads"], "the older H1 map never goes out");
  assert.ok(draftEvents(sql, "levels:H1:20261125T080000Z:threads").some((e) => e.action === "superseded" && e.detail === "superseded:levels:H1:20261125T090000Z:threads"));
  assert.equal(getDraft(sql, "levels:H4+H1:20261125T080000Z:threads").status, "approved", "another chart key stays");
  assert.deepEqual(supersedeMaps(sql, "threads", { now: T }), [], "nothing left to supersede");
  recordPublish(sql, { id: "daily:2026-11-24:threads", remoteId: "r1" }, { now: T });
  assert.equal(nextApproved(sql, "threads", { now: T }).id, "levels:H4+H1:20261125T080000Z:threads", "then the maps in approval order: H4+H1, then H1 09:00");
  recordPublish(sql, { id: "levels:H4+H1:20261125T080000Z:threads", remoteId: "r2" }, { now: T });
  assert.equal(nextApproved(sql, "threads", { now: T }).id, "levels:H1:20261125T090000Z:threads");
  // compared as times, not as text (orchestrator review of #87): an older four-digit id "T0900Z" never beats "T100000Z"
  addDrafts(sql, [map("levels:H1:20261125T0900Z:threads"), map("levels:H1:20261125T100000Z:threads")], { now: T });
  for (const id of ["levels:H1:20261125T100000Z:threads", "levels:H1:20261125T0900Z:threads"]) decideDraft(sql, { id, decision: "approve", actor: "o" }, { now: T });
  supersedeMaps(sql, "threads", { now: T });
  assert.deepEqual(["levels:H1:20261125T0900Z:threads", "levels:H1:20261125T100000Z:threads"].map((id) => getDraft(sql, id).status), ["expired", "approved"]);
  // the log of each scheduler run names every auto-approve (orchestrator: answerable from telemetry)
  assert.match(readFileSync("src/index.mjs", "utf8"), /r\?\.auto\?\.length/);
  assert.match(readFileSync("src/app.mjs", "utf8"), /const row = \{ channel, id: c\.id, kind: c\.kind, decided_by: AUTO_ACTOR, status:/);
});
