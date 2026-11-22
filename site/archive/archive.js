// The Archive page (frontend mockup 2026-11-22, owner approved): every published post in the home and Performance look,
// the date beside its posts, from GET /api/public/archive (preloaded in the page's head). The header as on the other
// pages: the links, the average strip and the UTC and local clock. The list keeps its height while it loads
// (aria-busy), so nothing below it jumps; the empty line shows only once the answer is empty.
import { archiveModel, tabsOf, ARCHIVE_URL } from './model.js';
import { startClock } from '../home/header.js';
import { renderAvgStrip } from '../home/avg-strip.js';
import { TRACK_URL } from '../home/track.js';

startClock();

const $ = (id) => document.getElementById(id);
const make = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const state = { posts: [], kind: '', label: {} };

// The tabs are built once and then only marked, so the focused tab keeps focus (click, Enter, Space, a screen
// reader's double tap); the list is their tabpanel.
const TAB_ID = (k) => `kind-${k || 'all'}`;
function drawTabs() {
  const box = $('kinds');
  if (!box.children.length) {
    box.replaceChildren(...tabsOf(state.posts, state.kind).map((t) => {
      const b = make('button', null, t.label);
      b.type = 'button'; b.id = TAB_ID(t.kind); b.setAttribute('role', 'tab'); b.setAttribute('aria-controls', 'archive');
      b.dataset.kind = t.kind;
      b.append(make('span', 'c'));
      b.addEventListener('click', () => select(t.kind));
      return b;
    }));
  }
  for (const t of tabsOf(state.posts, state.kind)) {
    const b = $(TAB_ID(t.kind));
    b.setAttribute('aria-selected', String(t.selected)); b.tabIndex = t.selected ? 0 : -1;
    b.querySelector('.c').textContent = String(t.count);
  }
  $('archive').setAttribute('aria-labelledby', TAB_ID(state.kind));
}

function render() {
  drawTabs();
  const m = archiveModel(state.posts, state.kind, { label: state.label });
  const box = $('archive');
  box.replaceChildren();
  if (m.empty) box.append(make('p', 'empty', m.empty));
  for (const d of m.days) {
    const sec = make('section', 'a-day');
    sec.setAttribute('aria-label', d.day);
    const list = make('div', 'a-posts');
    for (const p of d.posts) {
      const art = make('article', 'a-post');
      const hd = make('div', 'a-meta');
      hd.append(make('b', null, p.channel));
      if (p.kind) hd.append(make('span', 'a-kind', p.kind));
      const t = make('time', 'a-time'); t.dateTime = p.at;
      t.append(make('span', null, p.utc));
      if (p.local) t.append(make('span', 'a-local', p.local));
      hd.append(t);
      art.append(hd, make('p', 'a-head', p.head));
      if (p.body) art.append(make('p', 'a-body', p.body));
      list.append(art);
    }
    sec.append(make('h2', null, d.day), list);
    box.append(sec);
  }
  // With nothing to show at first (an empty or failed read) the list keeps the height it held while loading, so the
  // note and the footer do not jump up (orchestrator review of #63).
  if (box.hasAttribute('aria-busy')) box.classList.toggle('hold', !state.posts.length);
  box.removeAttribute('aria-busy');
}
const select = (kind) => { state.kind = kind; render(); };

// Arrow keys, Home and End move between the tabs, as in the minutes.
$('kinds').addEventListener('keydown', (e) => {
  const tabs = [...$('kinds').querySelectorAll('[role="tab"]')];
  const at = tabs.indexOf(document.activeElement);
  const to = e.key === 'ArrowRight' ? at + 1 : e.key === 'ArrowLeft' ? at - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : null;
  if (at < 0 || to == null) return;
  e.preventDefault();
  select(tabs[(to + tabs.length) % tabs.length].dataset.kind);
  $(TAB_ID(state.kind)).focus();
});

const json = (url) => fetch(url, { headers: { accept: 'application/json' } }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
const profile = json('/api/public/profile').then((p) => {
  for (const l of p?.links ?? []) state.label[l.channel] = l.label;
  if (p?.brand?.disclaimer) $('disclaimer').textContent = p.brand.disclaimer;
  const threads = (p?.links ?? []).find((l) => l.channel === 'threads')?.url;
  if (threads && /^https:\/\/www\.threads\.(net|com)\//.test(threads)) document.querySelectorAll('[data-threads]').forEach((a) => { a.href = threads; });
});
// The same URL as the head's preload, so the browser uses that answer.
Promise.all([profile, fetch(ARCHIVE_URL).then((r) => (r.ok ? r.json() : null)).catch(() => null)]).then(([, a]) => {
  state.posts = Array.isArray(a?.posts) ? a.posts : [];
  render();
});
json(TRACK_URL).then((body) => renderAvgStrip(body));
