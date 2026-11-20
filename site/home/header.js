// The header of the home and Performance pages (owner 2026-11-20: "waktu utc dan lokal tempatkan di header"): the UTC
// clock and the visitor's local time. The nav is plain links, inline at every width (owner: "jangan digabungkan semua").

import { clockLines, clockFormat } from './clock.js';

/**
 * Writes the header's clock every second, on the second's edge (the UTC seconds never skip), and calls `each(now)`
 * on the same tick. The clock carries no live region, so a screen reader is not interrupted by it.
 */
export function startClock(each, doc = document) {
  const fmt = clockFormat();
  const set = (id, text) => { const el = doc.getElementById(id); if (el && el.textContent !== text) el.textContent = text; };
  const tick = () => {
    const now = Date.now(), c = clockLines(now, fmt);
    set('clock-utc', c.utc);
    set('clock-local', c.local);
    each?.(now, c);
  };
  tick();
  setTimeout(() => { tick(); setInterval(tick, 1000); }, 1000 - (Date.now() % 1000));
}
