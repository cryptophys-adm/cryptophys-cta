// The cron triggers' weekdays, read the way Cloudflare reads them: 1 = Sunday to 7 = Saturday, or the three-letter
// names (developers.cloudflare.com/workers/configuration/cron-triggers). Until 2026-11-22 the triggers said "1-5" and
// "2-6" meaning Monday to Friday and Tuesday to Saturday, so the analysis ran Sunday to Thursday (Sunday 00:10 UTC while
// gold was closed, never on Friday) and the recap Monday to Friday (Friday's trading day never got its Saturday recap).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RECAP_CRON, ANALYSIS_CRON, PATTERN_CRON } from "../src/app.mjs";
import { SCHEDULE_CRON } from "../src/scheduler.mjs";

const NAMES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
// Cloudflare's weekday field as UTC day numbers (0 = Sunday, as Date#getUTCDay).
function cloudflareWeekdays(field) {
  const day = (t) => (/^\d+$/.test(t) ? Number(t) - 1 : NAMES.indexOf(t.toUpperCase()));
  const out = new Set();
  for (const part of field.split(",")) {
    if (part === "*") NAMES.forEach((_, i) => out.add(i));
    else if (part.includes("-")) { const [a, b] = part.split("-").map(day); for (let i = a; i <= b; i++) out.add(i); }
    else out.add(day(part));
  }
  assert.ok([...out].every((d) => d >= 0 && d <= 6), `weekday field "${field}"`);
  return [...out].sort().map((d) => NAMES[d]);
}
const weekdays = (cron) => cloudflareWeekdays(cron.trim().split(/\s+/)[4]);

test("CR1: the analysis runs Sunday to Friday and the recap Tuesday to Saturday (UTC), as Cloudflare reads the field", () => {
  assert.deepEqual(weekdays(ANALYSIS_CRON), ["SUN", "MON", "TUE", "WED", "THU", "FRI"], "Sunday for the hour after the reopen; the guard skips the closed hours");
  assert.deepEqual(weekdays(RECAP_CRON), ["TUE", "WED", "THU", "FRI", "SAT"]);
  assert.deepEqual(weekdays(SCHEDULE_CRON), NAMES);
  assert.deepEqual(weekdays("9 * * * 1-5"), ["SUN", "MON", "TUE", "WED", "THU"], "the old field, as it ran");
});

test("CR2: a weekday field is written with names, never numbers, and wrangler.jsonc carries the same triggers", () => {
  const cfg = JSON.parse(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8").replace(/^\s*\/\/.*$/gm, ""));
  assert.deepEqual([...cfg.triggers.crons].sort(), [RECAP_CRON, ANALYSIS_CRON, SCHEDULE_CRON, PATTERN_CRON].sort());
  for (const c of cfg.triggers.crons) assert.doesNotMatch(c.trim().split(/\s+/)[4], /\d/, `"${c}": use MON, TUE ... in the weekday field`);
});

test("CR3: the hourly analysis run drafts only while gold trades (Friday's hours after the close are skipped)", async () => {
  const { analysisRunDue } = await import("../src/app.mjs");
  assert.equal(analysisRunDue(Date.parse("2026-11-20T21:09:00Z")), true, "Friday 21:09 UTC, before the 22:00 close");
  assert.equal(analysisRunDue(Date.parse("2026-11-20T22:09:00Z")), false, "Friday 22:09 UTC, closed");
  assert.equal(analysisRunDue(Date.parse("2026-11-22T00:09:00Z")), false, "Sunday 00:09 UTC, closed (the old trigger ran here)");
  assert.equal(analysisRunDue(Date.parse("2026-11-22T22:09:00Z")), false, "Sunday 22:09 UTC in November, still closed");
  assert.equal(analysisRunDue(Date.parse("2026-11-22T23:09:00Z")), true, "Sunday 23:09 UTC, the week's first hour");
  assert.equal(analysisRunDue(Date.parse("2026-11-23T00:09:00Z")), true, "Monday 00:09 UTC, open since Sunday 23:00");
  const src = readFileSync(new URL("../src/index.mjs", import.meta.url), "utf8");
  assert.match(src, /event\?\.cron === ANALYSIS_CRON\) \{\s*if \(!analysisRunDue\(/, "the scheduled handler asks before drafting");
});

test("CR4: the pattern pass has its own cron at minute 3, 8, … 58, one minute after xauusd's 5-minute step (2-59/5) writes the patterns", () => {
  assert.equal(PATTERN_CRON, "3-59/5 * * * *");
  const [min] = PATTERN_CRON.split(/\s+/);
  const [range, step] = min.split("/"), [from, to] = range.split("-").map(Number);
  const minutes = []; for (let m = from; m <= to; m += Number(step)) minutes.push(m);
  assert.deepEqual(minutes, [3, 8, 13, 18, 23, 28, 33, 38, 43, 48, 53, 58]);
  assert.ok(minutes.every((m) => (m - 2) % 5 === 1), "always one minute after xauusd's writer");
  const src = readFileSync(new URL("../src/index.mjs", import.meta.url), "utf8");
  assert.match(src, /event\?\.cron === PATTERN_CRON\) \{[\s\S]{0,200}fastPassOn\(env\)[\s\S]{0,40}analysisRunDue\(at\)/);
  const schedule = src.slice(src.indexOf("event?.cron === SCHEDULE_CRON"), src.indexOf("event?.cron === PATTERN_CRON"));
  assert.doesNotMatch(schedule, /draftAnalysis/, "the */5 scheduler no longer runs the pattern pass");
});
