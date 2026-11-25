// The public pages read their records again while they are open (owner 2026-11-25: "harus realtime", the track record
// as live as Nexus's; then "Everything realtime"): every LIVE_MS while the tab is shown, and once when it is shown
// again. A hidden tab reads nothing; a read never starts while the one before it is still running; a failed read
// changes nothing on screen, so the page keeps the last good answer. The answers are cached at the edge for a minute
// (src/app.mjs), so the readers of a data centre reach the AI Worker at most once a minute.
import { TRACK_URL, trackAvailable } from './track.js';

export const LIVE_MS = 60000;

/**
 * Runs `read` (async) every `ms` while `doc.visibilityState` is "visible", and once each time the tab is shown again;
 * never two at once. A throw is swallowed (the caller keeps what it shows). Returns the guarded run, for a first read.
 */
export function everyMinute(read, { ms = LIVE_MS, doc = document, win = window } = {}) {
  let busy = false;
  const run = async () => {
    if (busy || doc.visibilityState !== 'visible') return;
    busy = true;
    try { await read(); } catch { /* the last good answer stays on screen */ } finally { busy = false; }
  };
  win.setInterval(run, ms);
  doc.addEventListener('visibilitychange', () => { if (doc.visibilityState === 'visible') run(); });
  return run;
}

/** A public JSON answer read again, past the browser's copy (the edge keeps it a minute); null when it failed. */
export const readAgain = (url, fetchImpl = fetch) =>
  fetchImpl(url, { headers: { accept: 'application/json' }, cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);

/**
 * The track record read again every minute: `onRecord(body)` only with a record that has numbers to show and that
 * differs from the last one handed over (`first`, the page's own first answer, when it had one). An empty or failed
 * answer keeps the last good numbers on screen.
 */
export function liveTrack(onRecord, { first = null, fetchImpl = fetch, ...opts } = {}) {
  let last = trackAvailable(first) ? JSON.stringify(first) : '';
  return everyMinute(async () => {
    const body = await readAgain(TRACK_URL, fetchImpl);
    if (!trackAvailable(body)) return;
    const s = JSON.stringify(body);
    if (s === last) return;
    last = s;
    onRecord(body);
  }, opts);
}
