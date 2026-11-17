// Content management (owner 2026-11-16: "content management"): the library's filters, a person's edit with the
// guardian again (media made again), a copy of any draft, the calendar by WIB day, the media library.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { addDrafts, getDraft, draftEvents, decideDraft, recordPublish, attachImage, searchDrafts, editDraft, duplicateDraft, calendarMonth, listMedia, EDITABLE } from "../src/desk.mjs";
import { editCheck } from "../src/compose.mjs";

function sqlite() {
  const db = new DatabaseSync(":memory:");
  return { exec(q, ...b) { const s = db.prepare(q); const out = /^\s*SELECT/i.test(q) ? s.all(...b) : (s.run(...b), []); return { toArray: () => out.map((r) => ({ ...r })) }; } };
}
const T = "Education · XAUUSD\n\nGold held its range through London.\n\nEducational analysis by Cryptophys. Not an invitation to buy or sell, and not financial advice.\n#XAUUSD";
const IG = T.replace("\n\nEducational", "\n\nChart by TradingView.\nEducational");
const at = (iso) => Date.parse(iso);
const check = (d) => editCheck(d, { now: at("2026-11-17T09:00:00Z") });

function seeded() {
  const sql = sqlite();
  addDrafts(sql, [{ id: "a:threads", kind: "custom", channel: "threads", text: T, status: "pending" }], { now: at("2026-11-16T16:30:00Z") }); // 23:30 WIB, 16 Nov
  addDrafts(sql, [{ id: "b:threads", kind: "custom", channel: "threads", text: T.replace("London", "New York"), status: "pending" }], { now: at("2026-11-16T17:30:00Z") }); // 00:30 WIB, 17 Nov
  addDrafts(sql, [{ id: "c:instagram", kind: "key_levels", channel: "instagram", text: IG, status: "needs_image" }], { now: at("2026-11-17T02:00:00Z") });
  return sql;
}

test("the library: status, channel, kind, words and WIB days; newest first; a total for paging", () => {
  const sql = seeded();
  assert.deepEqual(searchDrafts(sql).drafts.map((d) => d.id), ["c:instagram", "b:threads", "a:threads"]);
  assert.equal(searchDrafts(sql).total, 3);
  assert.deepEqual(searchDrafts(sql, { channel: "threads", status: "pending" }).drafts.map((d) => d.id), ["b:threads", "a:threads"]);
  assert.deepEqual(searchDrafts(sql, { kind: "key_levels" }).drafts.map((d) => d.id), ["c:instagram"]);
  assert.deepEqual(searchDrafts(sql, { q: "new york" }).drafts.map((d) => d.id), ["b:threads"], "words, any case");
  assert.deepEqual(searchDrafts(sql, { from: "2026-11-17", to: "2026-11-17" }).drafts.map((d) => d.id), ["c:instagram", "b:threads"], "00:30 WIB is the 17th");
  assert.deepEqual(searchDrafts(sql, { to: "2026-11-16" }).drafts.map((d) => d.id), ["a:threads"]);
  const page = searchDrafts(sql, { limit: 2, offset: 2 });
  assert.deepEqual([page.drafts.map((d) => d.id), page.total], [["a:threads"], 3]);
  assert.equal(searchDrafts(sql, { status: "nonsense", from: "yesterday" }).total, 3, "unknown filters are ignored");
  assert.equal(searchDrafts(sql, { q: "'); DROP TABLE drafts; --" }).total, 0, "words are bound, never SQL");
});

test("an edit: the guardian again, nothing stored when it refuses, the card made again, only before approval", () => {
  const sql = seeded();
  const now = { now: at("2026-11-17T09:00:00Z") };
  const refused = editDraft(sql, { id: "a:threads", text: T.replace("Gold held", "Buy now, gold held"), actor: "owner@example.com", check }, now);
  assert.equal(refused.ok, false);
  assert.ok(refused.guardian.failures.some((f) => f.check === "instruction"));
  assert.equal(getDraft(sql, "a:threads").text, T, "nothing stored");
  const ok = editDraft(sql, { id: "a:threads", text: T.replace("London", "the London session"), actor: "owner@example.com", check }, now);
  assert.deepEqual([ok.ok, ok.status], [true, "pending"]);
  assert.match(getDraft(sql, "a:threads").text, /the London session/);
  assert.deepEqual(draftEvents(sql, "a:threads").map((e) => e.action).sort(), ["drafted", "edited"]);
  assert.equal(editDraft(sql, { id: "a:threads", text: getDraft(sql, "a:threads").text, actor: "o", check }, now).error, "nothing changed");
  // Instagram: the card carries the text, so an edit after the card drops it and the draft waits for a new one.
  attachImage(sql, { id: "c:instagram", mediaId: "f".repeat(32), data: "AAAA", bytes: 3, imageUrl: `https://cta.cryptophys.work/media/${"f".repeat(32)}.jpg` }, now);
  assert.equal(getDraft(sql, "c:instagram").status, "pending");
  const ig = editDraft(sql, { id: "c:instagram", text: IG.replace("London", "Asia"), actor: "owner@example.com", check }, now);
  assert.deepEqual([ig.status, getDraft(sql, "c:instagram").image_url], ["needs_image", null]);
  // Approved, published or rejected: never rewritten.
  decideDraft(sql, { id: "b:threads", decision: "approve", actor: "owner" }, now);
  assert.match(editDraft(sql, { id: "b:threads", text: T, actor: "o", check }, now).error, /approved draft cannot be edited; duplicate it/);
  assert.deepEqual(EDITABLE, ["pending", "blocked", "needs_image", "needs_video"]);
  assert.equal(editDraft(sql, { id: "nope", text: T, actor: "o", check }, now).error, "no such draft");
  assert.equal(editDraft(sql, { id: "a:threads", text: T, actor: "", check }, now).error, "actor is required");
});

test("a copy of any draft (a published post reused): checked again, a new draft that waits, its source in the history", () => {
  const sql = seeded();
  const now = { now: at("2026-11-17T09:00:00Z") };
  decideDraft(sql, { id: "b:threads", decision: "approve", actor: "owner" }, now);
  recordPublish(sql, { id: "b:threads", remoteId: "777" }, now);
  const c = duplicateDraft(sql, { id: "b:threads", newId: "manual:2026-11-17:0a0b0c0d", actor: "owner@example.com", check }, now);
  assert.deepEqual([c.ok, c.id, c.status, c.from], [true, "manual:2026-11-17:0a0b0c0d:threads", "pending", "b:threads"]);
  const copy = getDraft(sql, c.id);
  assert.deepEqual([copy.text, copy.kind, copy.remote_id, copy.published_at], [getDraft(sql, "b:threads").text, "custom", null, null]);
  assert.deepEqual(draftEvents(sql, c.id).map((e) => [e.action, e.actor]).sort(), [["composed", "owner@example.com"], ["duplicated", "owner@example.com"]]);
  assert.equal(duplicateDraft(sql, { id: "b:threads", newId: "manual:2026-11-17:0a0b0c0d", actor: "o", check }, now).error, "the copy exists already");
  // c:instagram is a key-level map made at 02:00: at 09:00 it has aged, so a copy is refused (it would carry old levels);
  // within the limit (03:00) the copy gets its own card.
  const stale = duplicateDraft(sql, { id: "c:instagram", newId: "manual:2026-11-17:01020304", actor: "o", check }, now);
  assert.equal(stale.ok, false); assert.match(stale.error, /older than 2 hours/);
  const ig = duplicateDraft(sql, { id: "c:instagram", newId: "manual:2026-11-17:01020305", actor: "o", check }, { now: at("2026-11-17T03:00:00Z") });
  assert.equal(ig.status, "needs_image", "a copy gets its own card");
});

test("the calendar by WIB day and the media library", () => {
  const sql = seeded();
  const now = { now: at("2026-11-17T09:00:00Z") };
  decideDraft(sql, { id: "a:threads", decision: "approve", actor: "owner" }, now);
  recordPublish(sql, { id: "a:threads", remoteId: "1" }, now);
  const cal = calendarMonth(sql, "2026-11");
  assert.deepEqual(cal.days["2026-11-16"], { created: 1, published: 0, channels: { threads: { created: 1, published: 0 } } });
  assert.deepEqual([cal.days["2026-11-17"].created, cal.days["2026-11-17"].published], [2, 1]);
  assert.deepEqual(cal.days["2026-11-17"].channels.instagram, { created: 1, published: 0 });
  assert.equal(calendarMonth(sql, "2026-13").ok, false);
  assert.deepEqual(calendarMonth(sql, "2026-10").days, {});
  attachImage(sql, { id: "c:instagram", mediaId: "e".repeat(32), data: "AAAA", bytes: 3, imageUrl: `https://cta.cryptophys.work/media/${"e".repeat(32)}.jpg` }, now);
  const m = listMedia(sql);
  assert.equal(m.total, 1);
  assert.deepEqual([m.media[0].id, m.media[0].channel, m.media[0].status, "data" in m.media[0]], ["e".repeat(32), "instagram", "pending", false]);
});

test("the studio pages: Library, Calendar and Media in the navigation, an edit and a copy through the studio API", () => {
  const html = readFileSync(new URL("../public/studio/index.html", import.meta.url), "utf8");
  const js = readFileSync(new URL("../public/studio/studio.js", import.meta.url), "utf8");
  for (const v of ["library", "calendar", "media"]) { assert.match(html, new RegExp(`data-view="${v}"`)); assert.match(html, new RegExp(`id="view-${v}"`)); }
  for (const p of ["/api/studio/library", "/api/studio/edit", "/api/studio/duplicate", "/api/studio/calendar", "/api/studio/media-library"]) assert.ok(js.includes(p), p);
  assert.doesNotMatch(js + html, /innerHTML|<script>|style="/);
});
