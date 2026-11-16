// The per-channel scheduler (owner 2026-11-16: "opsi content creation terjadwal untuk masing-masing channel"). Each
// channel's schedule (src/settings.mjs: days of the week and times in WIB) says when its approved posts go out: at each
// slot, the oldest approved draft of that channel is published, one post per slot. A channel without slots publishes a
// draft at its approval, as before. Nothing is published while CONTENT_PUBLISH is "off"; a slot missed by more than
// MISSED_AFTER_MS (the Worker did not run) is skipped, never posted late. Pure: the slot arithmetic.
import { DAYS } from "./settings.mjs";

export const SCHEDULE_CRON = "*/5 * * * *";
export const WIB_OFFSET_MS = 7 * 3_600_000;
/** A slot later than this is skipped (a post at 19:00 is not sent at 21:00). */
export const MISSED_AFTER_MS = 30 * 60_000;

/** A slot's moment (UTC ms) on a WIB date ("2026-11-16") at "HH:MM" WIB. */
export function slotMs(wibDate, time) {
  const [y, m, d] = wibDate.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  return Date.UTC(y, m - 1, d, h, mi) - WIB_OFFSET_MS;
}
const wibDate = (ms) => new Date(ms + WIB_OFFSET_MS).toISOString().slice(0, 10);
const wibDay = (ms) => DAYS[(new Date(ms + WIB_OFFSET_MS).getUTCDay() + 6) % 7];

/** Every slot moment of a schedule in (from, to], oldest first: [{ at (ms), key ("YYYY-MM-DDTHH:MM" WIB) }]. */
export function slotsBetween(schedule, from, to) {
  const out = [];
  if (!Array.isArray(schedule) || !schedule.length || !(to > from)) return out;
  for (let day = Math.floor((from + WIB_OFFSET_MS) / 86_400_000) * 86_400_000 - WIB_OFFSET_MS; day <= to; day += 86_400_000) {
    const date = wibDate(day), dow = wibDay(day);
    for (const s of schedule) {
      if (!s?.days?.includes(dow)) continue;
      const at = slotMs(date, s.time);
      if (at > from && at <= to) out.push({ at, key: `${date}T${s.time}` });
    }
  }
  return out.sort((a, b) => a.at - b.at).filter((x, i, a) => i === 0 || a[i - 1].key !== x.key);
}

/** The slots due now (not older than MISSED_AFTER_MS), oldest first. */
export function dueSlots(schedule, now) {
  return slotsBetween(schedule, now - MISSED_AFTER_MS, now);
}

/** The next `n` slot moments after `now` (looks a fortnight ahead). */
export function nextSlots(schedule, now, n = 3) {
  return slotsBetween(schedule, now, now + 14 * 86_400_000).slice(0, n);
}
