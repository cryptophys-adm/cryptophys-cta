// The header of the home and Performance pages (owner 2026-11-20: "jangan tempatkan semua di pojok"): the UTC clock
// and the visitor's local time, and the menu. Wide screens show the nav inline; where the header has no room the same
// nav folds into one Menu button with grouped links (The room, Results, Follow): a disclosure (aria-expanded), Esc
// closes it and gives focus back to the button, arrow keys move through the links, a tap or focus outside closes it.

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
    set('menu-local', c.local);
    each?.(now, c);
  };
  tick();
  setTimeout(() => { tick(); setInterval(tick, 1000); }, 1000 - (Date.now() % 1000));
}

/** The header's menu: the Menu button and its grouped links. */
export function initMenu(doc = document) {
  const btn = doc.getElementById('menu-btn'), menu = doc.getElementById('menu'), nav = btn?.closest('nav');
  if (!btn || !menu || !nav) return;
  const links = () => [...menu.querySelectorAll('a')].filter((a) => a.offsetParent !== null);
  const isOpen = () => btn.getAttribute('aria-expanded') === 'true';
  const set = (open, back = false) => {
    btn.setAttribute('aria-expanded', String(open));
    menu.classList.toggle('open', open);
    if (!open && back) btn.focus();
  };
  btn.addEventListener('click', () => set(!isOpen()));
  btn.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown') return;
    e.preventDefault(); set(true); links()[0]?.focus();
  });
  menu.addEventListener('keydown', (e) => {
    if (!isOpen()) return;
    const all = links(), i = all.indexOf(doc.activeElement);
    const n = e.key === 'ArrowDown' ? i + 1 : e.key === 'ArrowUp' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : null;
    if (n == null || i < 0) return;
    e.preventDefault(); all[(n + all.length) % all.length].focus();
  });
  doc.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen()) set(false, true); });
  doc.addEventListener('pointerdown', (e) => { if (isOpen() && !nav.contains(e.target)) set(false); });
  nav.addEventListener('focusout', (e) => { if (isOpen() && e.relatedTarget && !nav.contains(e.relatedTarget)) set(false); });
  menu.addEventListener('click', (e) => { if (e.target.closest('a')) set(false); });
  // Grown to the inline nav (a rotated tablet): the folded state is dropped.
  window.matchMedia?.('(min-width: 1200px)').addEventListener?.('change', () => set(false));
}
