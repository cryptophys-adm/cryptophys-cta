// The home page (owner 2026-11-19, the homepage redesign): the header's clock, the panels, the hero's meeting
// dial, the minutes of each room's last meeting, the Threads link and the disclaimer from the public profile, and the
// holo war room, loaded after first paint and only where WebGL works. One feed of the rooms serves the minutes and the scene (../room/feed.js).
import { minutesFromResponse, meetingsFromResponse, statusOf, tallyWords, replyWords, whenOf, latestPost, BIAS_WORD } from '../room/script.js';
import { startFeed, onScene } from '../room/feed.js';
import { clockFormat, meetDial } from './clock.js';
import { startClock } from './header.js';
import { initPanels } from './panels.js';
import { TRACK_URL } from './track.js';
import { renderAvgStrip } from './avg-strip.js';
import { tvQuoteSrc, quoteTop } from './gold.js';
import { lowEnd, mannequinUrl } from '../room/quality.js';

const $ = (id) => document.getElementById(id);
const make = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const CLS = { bearish: 'bear', bullish: 'bull', neutral: 'flat' };
const ROOMS = ['m15', 'h1', 'h4', 'd1'];
const SHOW = 5;

/* ---------- the hero's status: the page writes it until the scene takes over ---------- */
let sceneOwnsStatus = false;
function renderStatus(st) {
  const box = $('room-status');
  if (!box || !st) return;
  const tick = make('i', `tick ${CLS[st.bias] ?? 'flat'}`);
  box.replaceChildren(tick, make('span', null, st.text), make('small', null, whenOf(st.at)));
  box.hidden = false;
}
window.addEventListener('warroom-status', (e) => { sceneOwnsStatus = true; renderStatus(e.detail); });

/* ---------- the header: the clock; the panels under the hero ---------- */
initPanels();

/* ---------- the meeting dial (owner 2026-11-20: the countdown as an "atomic clock" over the Sound button) ---------- */
// The ring fills as the quarter hour runs out; the digits and the rooms are the dial's face. Written every second with
// the header's clock; nothing ticking is a live region. Reduced motion: the ring moves a step a minute, no sweep.
const CALM = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const dfmt = clockFormat();
const dial = { progress: -1, closed: null };
function renderDial(now, c) {
  const d = meetDial(now, dfmt);
  const box = $('hero-status');
  if (!box) return;
  $('next-rooms').textContent = d.closed ? c.next : `${c.next} ${c.left}`;
  $('next-in').textContent = d.closed ? 'Closed' : d.left;
  $('dial-rooms').textContent = d.rooms.join(' ');
  if (d.closed !== dial.closed) {
    box.classList.toggle('closed', d.closed);
    $('meet-label').textContent = d.closed ? 'Market closed' : 'Next meeting';
    dial.closed = d.closed;
  }
  $('meet-again').textContent = d.closed ? `Meets again ${d.again}` : '';
  const p = CALM ? Math.floor(d.progress * 15) / 15 : d.progress;
  if (p === dial.progress) return;
  // A new quarter hour: the ring empties at once (no sweep backwards) and the dial marks the meeting.
  const back = p < dial.progress;
  const fill = $('dial-fill'), head = $('dial-head');
  fill.classList.toggle('moving', !back && dial.progress >= 0);
  head.classList.toggle('moving', !back && dial.progress >= 0);
  fill.style.strokeDashoffset = String(100 - p * 100);
  head.style.transform = `rotate(${(p * 360).toFixed(2)}deg)`;
  if (back && !d.closed) { $('dial').classList.remove('met'); void $('dial').offsetWidth; $('dial').classList.add('met'); }
  dial.progress = p;
}
if ($('hero-status')) $('hero-status').hidden = false;
startClock(renderDial);

/* ---------- the minutes ---------- */
const view = { room: null, open: false, minutes: {}, failed: false };
const tabs = [...document.querySelectorAll('[data-room]')];

function renderMinutes() {
  const m = view.minutes[view.room];
  tabs.forEach((t) => { const on = t.dataset.room === view.room; t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1; });
  const panel = $('minutes-panel');
  if (view.room) panel.setAttribute('aria-labelledby', `tab-${view.room}`);
  $('m-empty').hidden = Boolean(m);
  $('m-body').hidden = !m;
  if (!m) {
    $('m-empty').textContent = view.failed ? 'The minutes could not be loaded just now. They come back when the rooms answer.'
      : Object.keys(view.minutes).length ? 'This room has no published minutes yet. It meets when its candle closes.' : 'Loading the minutes.';
    return;
  }
  $('m-room').textContent = m.room;
  $('m-time').textContent = `Met ${whenOf(m.at)}`;
  $('m-reading').replaceChildren(make('span', null, 'The room reads'), make('b', CLS[m.bias], BIAS_WORD[m.bias]));
  const tally = $('m-tally'); tally.replaceChildren();
  for (const k of ['bearish', 'neutral', 'bullish']) if (m.tally[k]) { const b = make('b', CLS[k]); b.style.flexGrow = String(m.tally[k]); tally.append(b); }
  $('m-tally-words').textContent = tallyWords(m.tally);

  const fig = $('m-conclusion-fig');
  fig.hidden = !m.conclusion.length;
  $('m-conclusion').replaceChildren(...m.conclusion.map((s) => make('p', null, s)));

  const list = $('m-speakers'); list.replaceChildren();
  for (const s of m.speakers.slice(0, view.open ? undefined : SHOW)) {
    const li = make('li');
    const who = make('div', 'who'); who.append(make('b', null, s.title), make('span', CLS[s.bias], BIAS_WORD[s.bias]));
    const words = make('div', 'words'); words.append(make('p', null, s.claim));
    if (s.rebuttal) { const rep = make('p', 'reply'); rep.append(make('em', null, replyWords(s.to)), document.createTextNode(s.rebuttal)); words.append(rep); }
    li.append(who, words); list.append(li);
  }
  $('m-said').hidden = !m.speakers.length;
  const more = $('m-more');
  more.hidden = m.speakers.length <= SHOW;
  more.textContent = view.open ? 'Show fewer' : `Show all ${m.speakers.length} who spoke`;
  more.setAttribute('aria-expanded', String(view.open));
}

function select(room, focus = false) {
  if (view.room !== room) view.open = false;
  view.room = room;
  renderMinutes();
  if (focus) tabs.find((t) => t.dataset.room === room)?.focus();
}
tabs.forEach((t, i) => {
  t.addEventListener('click', () => select(t.dataset.room));
  t.addEventListener('keydown', (e) => {
    const n = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : null;
    if (n == null) return;
    e.preventDefault();
    select(tabs[(n + tabs.length) % tabs.length].dataset.room, true);
  });
});
$('m-more')?.addEventListener('click', () => { view.open = !view.open; renderMinutes(); });

onScene((body) => {
  if (!body) { view.failed = true; renderMinutes(); return; }
  view.failed = false;
  view.minutes = minutesFromResponse(body);
  // The first answer opens the 15-minute room, or the first room that has minutes.
  if (!view.room) view.room = view.minutes.m15 ? 'm15' : ROOMS.find((r) => view.minutes[r]) ?? 'm15';
  renderMinutes();
  if (!sceneOwnsStatus) renderStatus(statusOf(meetingsFromResponse(body)));
});
select('m15');
startFeed();

/* ---------- the Threads link, the disclaimer and the latest post, from the public profile and archive ---------- */
// The latest post on Threads (owner 2026-11-19, "Follow first"): its headline only (a body may carry prices and
// levels) and when it went out, linked to the channel. X stays hidden; only Threads is shown for now.
const json = (u) => fetch(u).then((r) => r.json()).catch(() => ({}));

/* ---------- the header's average strip (owner 2026-11-20: in the header, Nexus colours) ---------- */
json(TRACK_URL).then((body) => renderAvgStrip(body));
Promise.all([json('/api/public/profile'), json('/api/public/archive?limit=30')]).then(([p, a]) => {
  const threads = (p?.links ?? []).find((l) => l.channel === 'threads')?.url;
  if (threads && /^https:\/\/www\.threads\.(net|com)\//.test(threads)) document.querySelectorAll('[data-threads]').forEach((el) => { el.href = threads; });
  if (p?.brand?.disclaimer && $('disclaimer-text')) $('disclaimer-text').textContent = p.brand.disclaimer;
  const post = latestPost(a?.posts, 'threads');
  if (!post) return;
  $('latest-headline').textContent = post.headline || 'The latest post';
  $('latest-time').textContent = `Posted ${whenOf(post.at)}`;
  $('latest').hidden = false;
});

/* ---------- after the page's load event: the scene and the TradingView quote, never before first paint ---------- */
const afterLoad = (fn) => {
  const later = () => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 1500 }) : setTimeout(fn, 200));
  if (document.readyState === 'complete') later(); else window.addEventListener('load', later, { once: true });
};

/* ---------- the live quote (owner 2026-11-20: "widget hanya ditempatkan dalam core"): TradingView's Single Quote widget on the core ---------- */
// Its own frame from TradingView's widget host (the CSP's one frame-src), so the page runs no TradingView script. The
// lens floats over the scene (nothing shifts) and appears with its frame after the load event; the scene keeps it on
// the core (site/room/main.js), and without the scene it stays where the core stands. The attribution stays.
if ($('gold-live')) {
  afterLoad(() => {
    const f = document.createElement('iframe');
    f.src = tvQuoteSrc(`${location.host}${location.pathname}`);
    f.title = 'XAUUSD live quote by TradingView';
    f.setAttribute('scrolling', 'no');
    f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox');
    f.referrerPolicy = 'strict-origin-when-cross-origin';
    $('tv-frame').append(f);
    $('gold-live').hidden = false;
    placeQuote();
  });
}

// On a wide screen the strip sits right above the headline (the copy is pinned to the hero's foot, so its top moves
// with the window): measured, then set through the CSSOM (the CSP allows no inline style). A phone keeps the CSS place.
const WIDE = window.matchMedia?.('(min-width: 901px)');
function placeQuote() {
  const g = $('gold-live'), h = $('hero-title'), hero = h?.closest('.hero');
  if (!g || g.hidden || !hero) return;
  if (!WIDE?.matches) { g.style.removeProperty('top'); return; }
  const top = quoteTop({ titleTop: h.getBoundingClientRect().top - hero.getBoundingClientRect().top, height: g.offsetHeight });
  if (top != null) g.style.top = `${top}px`;
}
if ($('gold-live')) {
  window.ResizeObserver && new ResizeObserver(placeQuote).observe($('hero-title')?.closest('.hero') ?? document.body);
  WIDE?.addEventListener?.('change', placeQuote);
}

/* ---------- the scene: three.js and the mannequin are this site's own files, fetched once the page has painted ---------- */
const gl = (() => { try { const c = document.createElement('canvas'); return Boolean(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; } })();
if (!gl) {
  $('nogl').hidden = false;
  // Without the scene a cast title shows nothing: it is plain text then.
  document.querySelectorAll('[data-agent]').forEach((b) => b.replaceWith(document.createTextNode(b.textContent)));
}
else {
  // The scene's URL carries its build's hash, so a deploy is never hidden behind the hour browsers keep /room/* (owner
  // 2026-11-20: the live page still showed the blue core from before the deploy).
  // The mannequin is the scene's other large file: its download starts with the scene's, not after it (frontend audit:
  // the scene caption is the page's LCP). The scene takes the bytes from window.__mannequin (site/room/main.js).
  const start = () => { $('loading').hidden = false; window.__mannequin = fetch(mannequinUrl(lowEnd())).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null); import(`/room/room.js?v=${__ROOM_VERSION__}`) /* global __ROOM_VERSION__: set by scripts/build-room.mjs */.catch(() => { $('loading').textContent = 'The scene did not load.'; }); };
  afterLoad(start);
}
