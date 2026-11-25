// The public pages' realtime read (owner 2026-11-25: "harus realtime", "Everything realtime"): every 60 seconds while
// the tab is visible, once on coming back, never while hidden, never two at a time; the edge keeps answers 60 seconds.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pollWhileVisible, POLL_MS } from "../site/page/poll.js";
import { TRACK_TTL_S, SCENE_TTL_S } from "../src/app.mjs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
function fakes() {
  const listeners = new Set(), timers = new Map();
  let id = 0;
  const doc = { hidden: false, addEventListener: (t, f) => t === "visibilitychange" && listeners.add(f), removeEventListener: (t, f) => listeners.delete(f) };
  const clock = { setInterval: (f, ms) => { timers.set(++id, { f, ms }); return id; }, clearInterval: (i) => timers.delete(i) };
  const tick = async () => { for (const t of [...timers.values()]) await t.f(); };
  const show = async (hidden) => { doc.hidden = hidden; for (const f of [...listeners]) await f(); };
  return { doc, clock, timers, tick, show };
}

test("PL1 the poller: every 60 seconds while visible; stops when hidden; reads once and resumes when visible again", async () => {
  assert.equal(POLL_MS, 60_000);
  const f = fakes(); let reads = 0;
  pollWhileVisible(async () => { reads++; }, { doc: f.doc, timers: f.clock });
  assert.deepEqual([...f.timers.values()].map((t) => t.ms), [60_000], "one timer, at 60 seconds; no read at start (the page's own first read)");
  await f.tick(); await f.tick();
  assert.equal(reads, 2);
  await f.show(true);
  assert.equal(f.timers.size, 0, "hidden: the timer stops");
  await f.tick();
  assert.equal(reads, 2, "nothing while hidden");
  await f.show(false);
  assert.equal(reads, 3, "visible again: one read at once");
  assert.equal(f.timers.size, 1, "and the timer again");
  const hiddenAtStart = fakes(); hiddenAtStart.doc.hidden = true;
  pollWhileVisible(async () => {}, { doc: hiddenAtStart.doc, timers: hiddenAtStart.clock });
  assert.equal(hiddenAtStart.timers.size, 0, "a page opened in a hidden tab waits");
});

test("PL2 never two reads at a time; a failed read keeps polling; stop() ends it", async () => {
  const f = fakes(); let reads = 0, release;
  const p = pollWhileVisible(() => { reads++; return new Promise((r) => { release = r; }); }, { doc: f.doc, timers: f.clock });
  const first = p.run(); p.run(); p.run();
  assert.equal(reads, 1, "one request in flight");
  release(); await first;
  const second = p.run();
  assert.equal(reads, 2, "the next read once the first is done");
  release(); await second;
  const g = fakes(); let n = 0;
  pollWhileVisible(async () => { n++; throw new Error("network"); }, { doc: g.doc, timers: g.clock });
  await g.tick(); await g.tick();
  assert.equal(n, 2, "a failure does not stop the next tick");
  const h = fakes();
  const q = pollWhileVisible(async () => {}, { doc: h.doc, timers: h.clock });
  q.stop();
  assert.equal(h.timers.size, 0);
  await h.show(false);
  assert.equal(h.timers.size, 0, "stopped: visibility no longer restarts it");
});

test("PL3 every public page that shows the record or the posts keeps them fresh; the edge keeps them 60 seconds at most", () => {
  assert.equal(TRACK_TTL_S, 60);
  assert.ok(SCENE_TTL_S <= 60);
  assert.match(read("src/app.mjs"), /const JSON_HEADERS = \{ "content-type": "application\/json; charset=utf-8", "cache-control": "no-store"/, "the archive is never cached");
  for (const f of ["site/performance/performance.js", "site/home/home.js", "site/page/page.js", "site/archive/archive.js"]) assert.match(read(f), /pollWhileVisible\(/, `${f} polls`);
  assert.match(read("site/archive/archive.js"), /sig\(list\.posts\) !== sig\(state\.posts\)/, "the archive redraws only on a change, so an open card stays open");
  assert.match(read("site/page/poll.js"), /cache: 'no-store'/, "past the browser's copy");
  for (const f of ["public/performance.js", "public/home.js", "public/page.js", "public/archive.js"]) assert.match(read(f), /visibilitychange/, `${f} is built with the poller`);
});
