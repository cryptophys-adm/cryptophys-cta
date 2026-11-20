// The home page (owner 2026-11-19, the homepage redesign): the hero's status, the minutes of each room's last meeting,
// the Threads link and the disclaimer from the public profile, and the holo war room, loaded after first paint and
// only where WebGL works. One feed of the rooms serves the minutes and the scene (../room/feed.js).
import { minutesFromResponse, meetingsFromResponse, statusOf, tallyWords, replyWords, whenOf, latestPost, BIAS_WORD } from '../room/script.js';
import { startFeed, onScene } from '../room/feed.js';

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

/* ---------- the scene: three.js and the mannequin are this site's own files, fetched once the page has painted ---------- */
const gl = (() => { try { const c = document.createElement('canvas'); return Boolean(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; } })();
if (!gl) {
  $('nogl').hidden = false;
  // Without the scene a cast title shows nothing: it is plain text then.
  document.querySelectorAll('[data-agent]').forEach((b) => b.replaceWith(document.createTextNode(b.textContent)));
}
else {
  const start = () => { $('loading').hidden = false; import('/room/room.js').catch(() => { $('loading').textContent = 'The scene did not load.'; }); };
  const later = () => (window.requestIdleCallback ? requestIdleCallback(start, { timeout: 1500 }) : setTimeout(start, 200));
  if (document.readyState === 'complete') later(); else window.addEventListener('load', later, { once: true });
}
