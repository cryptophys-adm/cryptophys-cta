// The home's panels (owner 2026-11-20: "per tab panel klik jangan continuous halaman"): Minutes, The cast and How it
// works open one at a time under the hero, chosen by the URL hash (#minutes, #cast, #how), so a deep link, back and
// forward work. The stylesheet shows the panel the hash targets (:target), else Minutes; the page itself only marks
// the nav link of the open panel (aria-current) and moves focus to its heading when a link opens it. Opening a panel
// fetches nothing. Pure, except initPanels.

export const PANELS = Object.freeze(['minutes', 'cast', 'how']);
export const DEFAULT_PANEL = 'minutes';

/** Pure: the panel a URL hash opens: one of PANELS, else the default (Minutes). */
export function panelOf(hash) {
  const id = String(hash ?? '').replace(/^#/, '');
  return PANELS.includes(id) ? id : DEFAULT_PANEL;
}

/** Pure: true when the hash names a panel (a link opened it, so its heading takes focus). */
export const namesPanel = (hash) => PANELS.includes(String(hash ?? '').replace(/^#/, ''));

/** Marks the open panel's links and gives its heading focus after a link opens it. */
export function initPanels(doc = document, win = window) {
  const mark = () => {
    const open = panelOf(win.location.hash);
    for (const a of doc.querySelectorAll('a[data-panel]')) {
      if (a.dataset.panel === open) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
    }
    return open;
  };
  mark();
  win.addEventListener('hashchange', () => {
    const open = mark();
    if (!namesPanel(win.location.hash)) return;
    doc.getElementById(open)?.querySelector('h2')?.focus({ preventScroll: true });
  });
}
