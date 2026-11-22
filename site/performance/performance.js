// The Performance page (owner 2026-11-20, "approved all"): the simulated track record from GET /api/public/track-record,
// drawn from trackModel (site/home/track.js): one table, each column with its own count and start, the managed exit's
// numbers only once the data says they are shown. Without a record the page says the numbers are not available yet.
// The record is preloaded in the page's head and its box (.track-box, aria-busy) holds the table's height while it
// loads, so the footnote, the terms and the footer never move (the one-theme backlog, PR 3, C1). The Threads links come
// from the public profile through the shared applyProfile (C3), as on the pages of ../page/page.js.
import { trackModel, TRACK_URL, NOT_YET } from '../home/track.js';
import { renderAvgStrip } from '../home/avg-strip.js';
import { startClock } from '../home/header.js';
import { applyProfile, PROFILE_URL } from '../page/profile.js';

// The header as on the home page: the four links and the UTC and local clock.
startClock();

const $ = (id) => document.getElementById(id);
const make = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

function draw(body) {
  const m = trackModel(body);
  if (!m.available) {
    $('basis').textContent = 'Simulated. Updated daily, a day behind.';
    $('track-empty').textContent = NOT_YET;
    $('track-empty').hidden = false;
    $('track-body').hidden = true;
    return;
  }
  $('basis').textContent = m.basis;
  for (const c of m.columns) {
    const th = $(`col-${c.id}`);
    th.replaceChildren(document.createTextNode(c.title), ...(c.sub ? [make('small', null, c.sub)] : []));
  }
  // On a phone the header row is hidden: each column's count is listed above the rows instead.
  $('bases').replaceChildren(...m.columns.filter((c) => c.sub).map((c) => { const li = make('li'); li.append(make('b', null, c.title), document.createTextNode(` ${c.sub}`)); return li; }));
  $('track-rows').replaceChildren(...m.rows.map((r) => {
    const tr = make('tr');
    const th = make('th', null, r.label); th.scope = 'row'; tr.append(th);
    for (const cell of r.cells) {
      const td = make('td', cell.pending ? 'pending' : cell.empty ? 'none' : null);
      td.dataset.col = cell.col;
      if (cell.rowspan) td.rowSpan = cell.rowspan;
      if (cell.pending) td.textContent = cell.note;
      else { td.append(make('b', cell.tone ? `t-${cell.tone}` : null, cell.value)); if (cell.note) td.append(make('span', null, cell.note)); }
      tr.append(td);
    }
    return tr;
  }));
  $('track-body').hidden = false;
}

const json = (r) => (r.ok ? r.json() : null);
// A plain fetch of the very URL the head preloads (no extra header), so the browser uses that answer.
fetch(TRACK_URL)
  .then(json)
  .catch(() => null)
  .then((body) => {
    // The box keeps the height it held while loading as its floor (read before the drawing, in the same task), then
    // gives up its loading state: a record or an empty line that needs less room moves nothing below it. A resize lets
    // the box take its own height again.
    const box = $('track-box');
    const held = box.getBoundingClientRect().height;
    draw(body);
    renderAvgStrip(body);
    box.style.minHeight = `${held}px`;
    box.removeAttribute('aria-busy');
    addEventListener('resize', () => { box.style.minHeight = ''; }, { once: true });
  });
fetch(PROFILE_URL).then(json).catch(() => null).then((p) => applyProfile(p));
