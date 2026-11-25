// The public pages' realtime read (owner 2026-11-25: "Cek kenapa cta performance di public tidak update realtime dengan
// yang di nexus ?", "harus realtime", then "Everything realtime"): `read` runs every POLL_MS while the tab is visible,
// once more as soon as it is visible again, never while hidden, and never twice at the same time. The first read is
// the page's own (the head's preload); this only keeps it fresh. The edge caches each answer for 60 seconds at most.
export const POLL_MS = 60_000;
export function pollWhileVisible(read, { everyMs = POLL_MS, doc = document, timers = globalThis } = {}) {
  let timer = null, busy = false;
  const run = async () => {
    if (busy || doc.hidden) return;
    busy = true;
    try { await read(); } catch { /* the next tick tries again */ } finally { busy = false; }
  };
  const start = () => { if (timer == null) timer = timers.setInterval(run, everyMs); };
  const stop = () => { if (timer != null) { timers.clearInterval(timer); timer = null; } };
  const onVisibility = () => { if (doc.hidden) stop(); else { run(); start(); } };
  doc.addEventListener('visibilitychange', onVisibility);
  if (!doc.hidden) start();
  return { run, stop: () => { stop(); doc.removeEventListener('visibilitychange', onVisibility); } };
}
/** A fresh read of a public JSON URL: past the browser's copy (the edge still answers from its 60-second cache). */
export const freshJson = (url) => fetch(url, { headers: { accept: 'application/json' }, cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
