// The hero's clock (owner 2026-11-20, "approved all"): gold's trading week copied from the AI Worker, the next meeting
// with the rooms that meet then, the weekend close and reopen, the UTC and local lines, and the status box on the page.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { goldClosedAt, nextGoldChange } from "../site/home/market-hours.js";
import { roomsAt, meetsAt, nextMeeting, countdown, clockLines, clockFormat, QUARTER_MS } from "../site/home/clock.js";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const at = (iso) => Date.parse(iso);
const iso = (ms) => new Date(ms).toISOString();

test("CK1 gold's week as the AI Worker reads it: Friday 17:00 to Sunday 18:00 New York time, so the UTC hours move with US daylight time", () => {
  // November (US standard time): Friday 22:00 to Sunday 23:00 UTC.
  assert.equal(goldClosedAt(at("2026-11-20T21:59:59Z")), false, "Friday 21:59 UTC trades");
  assert.equal(goldClosedAt(at("2026-11-20T22:00:00Z")), true, "Friday 22:00 UTC closed");
  assert.equal(goldClosedAt(at("2026-11-21T12:00:00Z")), true, "Saturday");
  assert.equal(goldClosedAt(at("2026-11-22T22:59:59Z")), true, "Sunday 22:59 UTC still closed");
  assert.equal(goldClosedAt(at("2026-11-22T23:00:00Z")), false, "Sunday 23:00 UTC open");
  assert.equal(goldClosedAt(at("2026-11-24T22:30:00Z")), false, "the daily break is not the weekend");
  // June (US daylight time): Friday 21:00 to Sunday 22:00 UTC.
  assert.equal(goldClosedAt(at("2026-06-19T20:59:59Z")), false);
  assert.equal(goldClosedAt(at("2026-06-19T21:00:00Z")), true);
  assert.equal(goldClosedAt(at("2026-06-21T21:59:59Z")), true);
  assert.equal(goldClosedAt(at("2026-06-21T22:00:00Z")), false);
  assert.deepEqual(nextGoldChange(at("2026-11-20T10:00:00Z")), { to: "closed", at: at("2026-11-20T22:00:00Z") });
  assert.deepEqual(nextGoldChange(at("2026-11-21T10:00:00Z")), { to: "open", at: at("2026-11-22T23:00:00Z") });
  // The copy names its source, so the two stay one rule.
  assert.match(read("site/home/market-hours.js"), /xauusd-ai-trading-assistant src\/market-hours\.mjs/);
});

test("CK2 which rooms meet at a close: 15m every quarter hour, 1H on the hour, 4H at 22, 02, 06, 10, 14 and 18 UTC, 1D at 22:00 UTC", () => {
  assert.deepEqual(roomsAt(at("2026-11-19T02:15:00Z")), ["m15"], "a quarter hour");
  assert.deepEqual(roomsAt(at("2026-11-19T02:45:00Z")), ["m15"]);
  assert.deepEqual(roomsAt(at("2026-11-19T03:00:00Z")), ["m15", "h1"], "an hour that is not a 4-hour close");
  for (const h of ["02", "06", "10", "14", "18"]) assert.deepEqual(roomsAt(at(`2026-11-19T${h}:00:00Z`)), ["m15", "h1", "h4"], `${h}:00`);
  assert.deepEqual(roomsAt(at("2026-11-19T22:00:00Z")), ["m15", "h1", "h4", "d1"], "the daily close is also a 4-hour close");
  assert.deepEqual(roomsAt(at("2026-11-19T00:00:00Z")), ["m15", "h1"], "midnight UTC is not a 4-hour close");
  assert.deepEqual(roomsAt(at("2026-11-19T02:07:00Z")), [], "between closes");
});

test("CK3 the countdown to the next meeting, across the quarter, hour, 4-hour and daily boundaries", () => {
  const lines = (t) => clockLines(at(t), clockFormat("UTC"));
  assert.deepEqual([lines("2026-11-19T02:07:13Z").next, lines("2026-11-19T02:07:13Z").left], ["Next: 15-minute room in", "07:47"]);
  assert.equal(lines("2026-11-19T02:14:59.200Z").left, "00:01", "a part second counts as one");
  assert.equal(iso(nextMeeting(at("2026-11-19T02:15:00Z")).at), "2026-11-19T02:30:00.000Z", "at the close itself, the next one");
  assert.equal(lines("2026-11-19T02:15:00.001Z").left, "15:00");
  assert.equal(lines("2026-11-19T02:50:00Z").next, "Next: 15-minute and hourly rooms in");
  assert.equal(lines("2026-11-19T05:50:00Z").next, "Next: 15-minute, hourly and 4-hour rooms in");
  const daily = lines("2026-11-19T21:45:30Z");
  assert.equal(daily.next, "Next: 15-minute, hourly, 4-hour and daily rooms in");
  assert.equal(daily.left, "14:30");
  assert.equal(countdown(10_000, 5_000), "00:00", "never negative");
  assert.equal(nextMeeting(at("2026-11-19T10:00:00Z")).closed, false);
});

test("CK4 the weekend: after Friday's close the countdown names the local day and time the rooms meet again; they resume a quarter hour after the reopen", () => {
  const jakarta = clockFormat("Asia/Jakarta");
  const fri = clockLines(at("2026-11-20T21:59:59Z"), jakarta);
  assert.equal(fri.closed, false, "the last minute before the close still counts down");
  assert.deepEqual(fri.rooms, ["m15", "h1", "h4", "d1"], "Friday's 22:00 close meets: gold traded just before it");
  const closed = clockLines(at("2026-11-20T22:00:00Z"), jakarta);
  assert.equal(closed.closed, true);
  assert.equal(closed.left, "");
  assert.equal(iso(closed.at), "2026-11-22T23:15:00.000Z", "the first close after the Sunday 23:00 UTC reopen");
  assert.equal(closed.next, "Market closed, the rooms meet again Mon 06:15 GMT+7", "the visitor's own day and time");
  assert.equal(clockLines(at("2026-11-21T09:00:00Z"), clockFormat("UTC")).next, "Market closed, the rooms meet again Sun 23:15 UTC");
  assert.equal(clockLines(at("2026-11-21T09:00:00Z"), clockFormat("America/New_York")).next, "Market closed, the rooms meet again Sun 18:15 EST");
  assert.equal(meetsAt(at("2026-11-22T23:00:00Z")), false, "the Sunday 23:00 close is still the weekend's");
  const reopen = clockLines(at("2026-11-22T23:00:00Z"), jakarta);
  assert.equal(reopen.closed, false);
  assert.equal(reopen.left, "15:00");
  // In US daylight time the week ends and starts an hour earlier in UTC.
  assert.equal(iso(nextMeeting(at("2026-06-19T21:00:00Z")).at), "2026-06-21T22:15:00.000Z");
  assert.equal(nextMeeting(at("2026-06-19T21:00:00Z")).closed, true);
  // Every meeting found is a quarter-hour close after which gold traded.
  for (let t = at("2026-11-20T20:00:00Z"); t < at("2026-11-23T02:00:00Z"); t += 7 * 60_000) {
    const n = nextMeeting(t);
    assert.ok(n.at > t && n.at % QUARTER_MS === 0 && meetsAt(n.at), iso(t));
  }
});

test("CK5 UTC ticks with seconds; local time with the short zone name, from Intl", () => {
  const t = at("2026-11-20T02:07:13Z");
  assert.equal(clockLines(t, clockFormat("Asia/Jakarta")).utc, "02:07:13 UTC");
  assert.equal(clockLines(t, clockFormat("Asia/Jakarta")).local, "09:07 GMT+7");
  assert.equal(clockLines(t, clockFormat("Europe/London")).local, "02:07 GMT");
  assert.equal(clockLines(t, clockFormat("America/New_York")).local, "21:07 EST");
  assert.equal(clockLines(at("2026-06-20T02:07:13Z"), clockFormat("America/New_York")).local, "22:07 EDT");
});

test("CK6 the status box on the home page: the reading, the countdown and the clock, top right; on a phone below the hero buttons; no live region on the ticking rows", () => {
  const page = read("public/index.html");
  const side = page.slice(page.indexOf('class="hero-side"'), page.indexOf("</section>", page.indexOf('class="hero-side"')));
  assert.ok(page.indexOf('class="hero-actions"') < page.indexOf('class="hero-side"'), "after the hero buttons in the page's order");
  assert.ok(side.indexOf('id="room-status"') < side.indexOf('id="next-in"') && side.indexOf('id="next-in"') < side.indexOf('id="clock-utc"'), "the reading, the countdown, the clock");
  assert.equal((side.match(/aria-live="off"/g) ?? []).length, 2, "both ticking rows");
  assert.doesNotMatch(side, /aria-live="(polite|assertive)"/);
  assert.ok(side.indexOf('id="hero-status"') < side.indexOf('id="avg"'), "the average box under the status box");
  const home = read("site/home/home.js");
  assert.match(home, /clockLines\(Date\.now\(\), fmt\)/);
  assert.match(home, /addEventListener\('warroom-status'/, "the scene's status still feeds the reading");
  const css = read("public/home.css");
  assert.match(css, /\.hero-side\{position:absolute;z-index:3;top:24px;right:var\(--gut\)/);
  assert.match(css, /@media \(max-width:900px\)\{[\s\S]*?\.hero-side\{position:static/, "on a phone it follows the copy");
});
