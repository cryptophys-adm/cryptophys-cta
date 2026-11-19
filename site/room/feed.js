// The one feed of the rooms on the home page (owner 2026-11-19, the homepage redesign): the page polls
// GET /api/public/warroom-scene once a minute and shares each answer with the scene and the minutes, so the two never
// fetch twice. The home bundle starts it; the scene bundle only listens. No DOM beyond `window`.
export const SCENE_URL = '/api/public/warroom-scene';
export const SCENE_EVENT = 'warroom-scene';
export const POLL_MS = 60000;
const KEY = '__warroomScene';

/** Calls fn with the latest answer (at once when one is already here) and with every later one. */
export function onScene(fn) {
  if (window[KEY]) fn(window[KEY]);
  window.addEventListener(SCENE_EVENT, (e) => fn(e.detail));
}

/** Starts the minute poll (home bundle only). A failed read is announced as null; the page keeps the last answer. */
export function startFeed() {
  const read = async () => {
    try {
      const r = await fetch(SCENE_URL, { headers: { accept: 'application/json' }, cache: 'no-store' }); // the edge caches it; the browser never
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      window[KEY] = await r.json();
      window.dispatchEvent(new CustomEvent(SCENE_EVENT, { detail: window[KEY] }));
    } catch (e) {
      console.warn('warroom-scene', String(e?.message ?? e));
      if (!window[KEY]) window.dispatchEvent(new CustomEvent(SCENE_EVENT, { detail: null }));
    }
  };
  read();
  setInterval(read, POLL_MS);
}
