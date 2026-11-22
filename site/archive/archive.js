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

function render() {
  const tabs = tabsOf(state.posts, state.kind);
  $('kinds').replaceChildren(...tabs.map((t) => {
    const b = make('button', null, t.label);
    b.type = 'button'; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(t.selected)); b.tabIndex = t.selected ? 0 : -1;
    b.dataset.kind = t.kind;
    b.append(make('span', 'c', String(t.count)));
    b.addEventListener('click', () => { state.kind = t.kind; render(); });
    return b;
  }));
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
  box.removeAttribute('aria-busy');
}

// Arrow keys, Home and End move between the tabs, as in the minutes.
$('kinds').addEventListener('keydown', (e) => {
  const tabs = [...$('kinds').querySelectorAll('[role="tab"]')];
  const at = tabs.indexOf(document.activeElement);
  const to = e.key === 'ArrowRight' ? at + 1 : e.key === 'ArrowLeft' ? at - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : null;
  if (at < 0 || to == null) return;
  e.preventDefault();
  state.kind = tabs[(to + tabs.length) % tabs.length].dataset.kind;
  render();
  $('kinds').querySelector('[aria-selected="true"]')?.focus();
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
