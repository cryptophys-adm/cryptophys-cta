// Gold's trading week, copied from the AI Worker's rule (xauusd-ai-trading-assistant src/market-hours.mjs, lines 6-22:
// goldClosedAt and nextGoldChange; the War Room's marketOpenAt is !goldClosedAt, src/war-room.mjs). Gold does not trade
// from Friday 17:00 to Sunday 18:00 New York time, so the UTC hours of the close and the reopen move by one hour with US
// daylight saving time (in November: Friday 22:00 to Sunday 23:00 UTC). Pure; test/clock.test.mjs keeps it equal.

const NY_WEEK = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const HOUR = 3_600_000;

/** Gold does not trade from Friday 17:00 to Sunday 18:00 New York time: true for an instant in that window. */
export function goldClosedAt(ms) {
  const p = Object.fromEntries(NY_WEEK.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const minutes = Number(p.hour) * 60 + Number(p.minute);
  return (p.weekday === "Fri" && minutes >= 17 * 60) || p.weekday === "Sat" || (p.weekday === "Sun" && minutes < 18 * 60);
}

/** The next weekly close (while open) or reopen (while closed) after `now`; both fall on a full UTC hour. */
export function nextGoldChange(now) {
  const closed = goldClosedAt(now);
  let t = Math.floor(now / HOUR) * HOUR + HOUR;
  for (let i = 0; i < 24 * 8; i++, t += HOUR) if (goldClosedAt(t) !== closed) return { to: closed ? "open" : "closed", at: t };
  return null;
}
