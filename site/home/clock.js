// The hero's clock (owner 2026-11-20, "approved all"): the countdown to the next meeting with the rooms that meet then,
// the UTC time and the visitor's local time. Pure: no DOM; home.js writes the lines every second. Rooms meet at their
// candle's close in UTC: 15m every quarter hour, 1H on the hour, 4H at 22, 02, 06, 10, 14 and 18 UTC, 1D at 22:00 UTC.
// A room meets only when gold traded just before its close (the AI Worker's War Room: marketOpenAt(close - 1)), so
// while gold is closed for the weekend the next meeting is the first quarter hour after the reopen.
import { goldClosedAt } from './market-hours.js';

export const QUARTER_MS = 900000;
/** The rooms by meeting id, in the words of the countdown. */
export const ROOM_WORD = { m15: '15-minute', h1: 'hourly', h4: '4-hour', d1: 'daily' };
const andList = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
const two = (n) => String(n).padStart(2, '0');

/** Pure: the rooms whose candle closes at `ms` (a quarter-hour boundary in UTC), in meeting order; none between. */
export function roomsAt(ms) {
  if (ms % QUARTER_MS !== 0) return [];
  const d = new Date(ms), h = d.getUTCHours(), m = d.getUTCMinutes();
  const rooms = ['m15'];
  if (m === 0) rooms.push('h1');
  if (m === 0 && (h + 2) % 4 === 0) rooms.push('h4');
  if (m === 0 && h === 22) rooms.push('d1');
  return rooms;
}

/** Pure: true when the rooms meet at the quarter-hour close `q`: gold traded just before it. */
export const meetsAt = (q) => q % QUARTER_MS === 0 && !goldClosedAt(q - 1);

/** Pure: the next meeting after `now`: { at, rooms, closed } (`closed`: gold is closed now, the weekend). */
export function nextMeeting(now) {
  let q = Math.floor(now / QUARTER_MS) * QUARTER_MS + QUARTER_MS;
  for (let i = 0; i < 4 * 24 * 8 && !meetsAt(q); i++) q += QUARTER_MS;
  return { at: q, rooms: roomsAt(q), closed: goldClosedAt(now) };
}

/** Pure: whole seconds until `at` as mm:ss (the next meeting is never more than a quarter hour away while gold trades). */
export function countdown(now, at) {
  const left = Math.max(0, Math.ceil((at - now) / 1000));
  return `${two(Math.floor(left / 60))}:${two(left % 60)}`;
}

/** The time formats for one time zone (the visitor's when `timeZone` is undefined), built once. */
export function clockFormat(timeZone) {
  const tz = timeZone ? { timeZone } : {};
  const time = new Intl.DateTimeFormat('en-GB', { ...tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const day = new Intl.DateTimeFormat('en-GB', { ...tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const zoneOf = (ms) => {
    try { return new Intl.DateTimeFormat('en-US', { ...tz, timeZoneName: 'short' }).formatToParts(new Date(ms)).find((p) => p.type === 'timeZoneName')?.value ?? ''; }
    catch { return ''; }
  };
  return { time: (ms) => time.format(new Date(ms)), day: (ms) => day.format(new Date(ms)).replace(',', ''), zone: zoneOf };
}

/**
 * Pure: the clock's lines at `now`: the countdown row (`next`, `left`), the UTC time and the local time with its short
 * zone name. While gold is closed the countdown row names the local day and time the rooms meet again, without a count.
 */
export function clockLines(now, fmt = clockFormat()) {
  const n = nextMeeting(now);
  const d = new Date(now);
  const utc = `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}:${two(d.getUTCSeconds())} UTC`;
  const local = `${fmt.time(now)} ${fmt.zone(now)}`.trim();
  if (n.closed) return { closed: true, next: `Market closed, the rooms meet again ${fmt.day(n.at)} ${fmt.zone(n.at)}`.trim(), left: '', utc, local, at: n.at, rooms: n.rooms };
  const words = n.rooms.map((r) => ROOM_WORD[r]);
  return { closed: false, next: `Next: ${andList(words)} ${words.length > 1 ? 'rooms' : 'room'} in`, left: countdown(now, n.at), utc, local, at: n.at, rooms: n.rooms };
}
