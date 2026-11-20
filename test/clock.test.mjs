// The hero's clock (owner 2026-11-20, "approved all"): gold's trading week copied from the AI Worker, the next meeting
// with the rooms that meet then, the weekend close and reopen, the UTC and local lines (the header), and the meeting
// dial on the hero.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { goldClosedAt, nextGoldChange } from "../site/home/market-hours.js";
import { roomsAt, meetsAt, nextMeeting, countdown, clockLines, clockFormat, meetDial, ROOM_SHORT, QUARTER_MS } from "../site/home/clock.js";
import { MEETINGS } from "../site/room/data.js";

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

test("CK6 the clock in the header (UTC with seconds, the local time; UTC only on a phone) and the meeting dial bottom right of the hero, over the room's controls; no live region on anything that ticks", () => {
  for (const f of ["public/index.html", "public/performance.html"]) {
    const page = read(f);
    const header = page.slice(page.indexOf("<header"), page.indexOf("</header>"));
    assert.match(header, /<p class="top-clock"><b id="clock-utc"><\/b><span id="clock-local"><\/span><\/p>/, `${f}: the clock in the header`);
    assert.doesNotMatch(header, /aria-live/, `${f}: no live region in the header`);
  }
  const page = read("public/index.html");
  const hud = page.slice(page.indexOf('<div class="hud">'), page.indexOf('<div class="hero-copy">'));
  assert.ok(hud.indexOf('id="hero-status"') >= 0 && hud.indexOf('id="hero-status"') < hud.indexOf('class="room-bar"'), "the dial over the room's controls");
  assert.ok(hud.indexOf('id="room-status"') < hud.indexOf('id="next-in"'), "the reading beside the dial");
  for (const id of ["next-in", "dial-rooms", "dial-fill", "dial-head", "next-rooms", "meet-again"]) assert.match(hud, new RegExp(`id="${id}"`), id);
  assert.doesNotMatch(hud, /aria-live/, "nothing in the hud is a live region");
  assert.match(hud, /<div class="dial" id="dial" aria-hidden="true">/, "the dial is drawn; its words are in #next-rooms");
  assert.ok(page.indexOf('class="hud"') < page.indexOf('class="hero-copy"'), "in the page's order the dial and controls come before the copy (a phone: under the scene)");
  assert.equal(page.indexOf('class="hero-side"'), -1, "the top-right column is gone (owner: \"jangan tempatkan semua di pojok\")");
  const header = read("site/home/header.js");
  assert.match(header, /clockLines\(now, fmt\)/);
  assert.match(header, /1000 - \(Date\.now\(\) % 1000\)/, "on the second's edge");
  const home = read("site/home/home.js");
  assert.match(home, /startClock\(renderDial\)/, "the dial ticks with the header's clock");
  assert.match(home, /meetDial\(now, dfmt\)/);
  assert.match(home, /addEventListener\('warroom-status'/, "the scene's status still feeds the reading");
  assert.match(home, /CALM \? Math\.floor\(d\.progress \* 15\) \/ 15/, "reduced motion: the ring moves a step a minute");
  assert.match(read("site/performance/performance.js"), /startClock\(\)/, "the Performance page's header ticks too");
  const css = read("public/home.css");
  assert.match(css, /\.hud\{position:absolute;z-index:3;right:16px;bottom:16px;display:flex;flex-direction:column/, "bottom right, the dial over the controls");
  assert.match(css, /@media \(max-width:900px\)\{[\s\S]*?\.hud\{position:relative/, "on a phone under the scene");
  assert.match(css, /@media \(max-width:600px\)\{[\s\S]*?\.top-clock span\{display:none\}/, "a phone: UTC only in the header");
  // The sweep, the electron and the orbits move only without a reduced-motion preference.
  const moving = css.slice(css.indexOf("@media (prefers-reduced-motion:no-preference){\n  .dial"));
  assert.match(moving.slice(0, moving.indexOf("\n}\n")), /\.dial \.fill\.moving\{transition[\s\S]*\.dial \.orbits\{animation:precess/);
  assert.doesNotMatch(css.replace(/@media \(prefers-reduced-motion:no-preference\)\{[\s\S]*?\n\}\n/g, ""), /animation:precess|transition:stroke-dashoffset/, "no sweep or precession outside that block");
});

test("CK7 the dial: the ring fills over the quarter hour, the rooms as the replay buttons name them, the weekend without a count", () => {
  const utc = clockFormat("UTC");
  const d = meetDial(at("2026-11-19T02:07:30Z"), utc);
  assert.equal(d.closed, false);
  assert.equal(d.left, "07:30");
  assert.equal(d.progress, 0.5, "half the quarter hour gone");
  assert.deepEqual(d.rooms, ["15m"]);
  assert.equal(meetDial(at("2026-11-19T02:15:00.001Z"), utc).progress < 0.001, true, "a new quarter hour starts empty");
  assert.equal(meetDial(at("2026-11-19T02:14:59.999Z"), utc).progress > 0.999, true);
  assert.deepEqual(meetDial(at("2026-11-19T02:50:00Z"), utc).rooms, ["15m", "1h"]);
  assert.deepEqual(meetDial(at("2026-11-19T21:50:30Z"), utc).rooms, ["15m", "1h", "4h", "1d"]);
  assert.deepEqual(Object.entries(ROOM_SHORT).map(([id, s]) => [id, s]), Object.entries(MEETINGS).map(([id, m]) => [id, m.short]), "the dial names rooms as the replay buttons under it");
  const closed = meetDial(at("2026-11-21T09:00:00Z"), clockFormat("Asia/Jakarta"));
  assert.deepEqual([closed.closed, closed.left, closed.progress, closed.rooms, closed.again], [true, "", 0, [], "Mon 06:15 GMT+7"]);
  // After the reopen the first quarter hour fills from empty.
  assert.equal(meetDial(at("2026-11-22T23:00:00Z"), utc).progress, 0);
  for (let t = at("2026-11-20T20:00:00Z"); t < at("2026-11-23T02:00:00Z"); t += 11 * 60_000) {
    const x = meetDial(t, utc);
    assert.ok(x.progress >= 0 && x.progress <= 1, iso(t));
    assert.equal(x.left, x.closed ? "" : countdown(t, x.at));
  }
});
