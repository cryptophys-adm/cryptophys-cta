// The simulated track record (owner 2026-11-20, "approved all"): the Performance page's table and the home's average
// box, from GET /api/public/track-record (PublicProjection.trackRecord). Aggregates only, in R only. Pure: no DOM.
// The three columns cover different sets (orchestrator review, 2026-11-20): Exit at TP2 counts only the plans with a
// second target, and the managed exit is a separate replayed account under its own rules, so each column carries its
// own count and start. The managed exit shows numbers only once the data says so (replay_check.shown and its own shown).
export const TRACK_URL = '/api/public/track-record';
export const COLUMNS = Object.freeze([
  { id: 'first', title: 'Exit at TP1', one: 'plan', many: 'plans' },
  { id: 'second', title: 'Exit at TP2', one: 'plan', many: 'plans' },
  { id: 'managed', title: 'Managed exit', one: 'trade', many: 'trades' }
]);
export const PENDING_NOTE = 'Shown once the replay matches the live account.';
export const NOT_YET = 'The numbers are not available yet. They appear here once the record is published.';
const MINUS = '−';
const finite = (x) => typeof x === 'number' && Number.isFinite(x);

/** Pure: an R value with its sign ("+0.21R", "−1R"); `digits` fixed, or trimmed of trailing zeros when `trim`. */
export function signedR(x, digits = 2, trim = false) {
  if (!finite(x)) return '';
  let s = Math.abs(x).toFixed(digits);
  if (trim && s.includes('.')) s = s.replace(/\.?0+$/, '');
  if (Number(s) === 0) return `${s}R`;
  return `${x < 0 ? MINUS : '+'}${s}R`;
}
/** Pure: "9 Nov 2026" from "2026-11-09", or "". */
export function dayWords(iso) {
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(iso)) ? `${iso}T00:00:00Z` : iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** Pure: a scenario of the record that may show numbers, or null (the managed exit also needs the replay check). */
export function shownScenario(body, id) {
  const s = (Array.isArray(body?.scenarios) ? body.scenarios : []).find((x) => x?.id === id);
  if (!s || s.shown !== true || !finite(s.count)) return null;
  if (id === 'managed' && body?.replay_check?.shown !== true) return null;
  return s;
}
/** Pure: true when the record has numbers to show (in R). */
export const trackAvailable = (body) => body?.available !== false && body?.unit === 'R' && COLUMNS.some((c) => shownScenario(body, c.id));

const count = (c, n) => `${n} ${n === 1 ? c.one : c.many}`;
function cells(c, s) {
  const none = { value: 'None yet', note: '', empty: true };
  const won = [`${s.won ?? 0} won`, `${s.lost ?? 0} lost`, ...(s.even ? [`${s.even} even`] : [])].join(', ');
  const avg = [finite(s.avg_win_r) ? `average win ${signedR(s.avg_win_r, 2, true)}` : '', finite(s.avg_loss_r) ? `loss ${signedR(s.avg_loss_r, 2, true)}` : ''].filter(Boolean).join(', ');
  return [
    finite(s.win_rate) ? { value: `${Math.round(s.win_rate * 100)}%`, note: won } : none,
    finite(s.expectancy_r) ? { value: signedR(s.expectancy_r, 2), note: `per ${c.one}` } : none,
    finite(s.net_r) && s.count > 0 ? { value: signedR(s.net_r, 1), note: avg } : none,
    finite(s.profit_factor) ? { value: s.profit_factor.toFixed(2), note: '' } : s.count > 0 && !s.lost ? { value: 'No losses', note: '', empty: true } : none
  ];
}

/**
 * Pure: the Performance table as the page draws it: the basis line, each column's own count and start under its title,
 * four rows (win rate, expectancy, net R, profit factor). A column without numbers is one pending cell over the four
 * rows (`rowspan` 4) that reads PENDING_NOTE. `available` false: the page says the numbers are not available yet.
 */
export function trackModel(body) {
  const rowLabels = ['Win rate', 'Expectancy', 'Net R', 'Profit factor'];
  if (!trackAvailable(body)) return { available: false, basis: '', columns: COLUMNS.map((c) => ({ id: c.id, title: c.title, sub: '', shown: false })), rows: [] };
  const delay = finite(body.delay_hours) ? body.delay_hours : 24;
  const columns = COLUMNS.map((c) => {
    const s = shownScenario(body, c.id);
    const since = s ? dayWords(s.since) : '';
    return { id: c.id, title: c.title, shown: Boolean(s), sub: s ? `${count(c, s.count)}${since ? ` since ${since}` : ''}` : '', cells: s ? cells(c, s) : null };
  });
  const rows = rowLabels.map((label, i) => ({
    label,
    cells: columns.flatMap((c) => (c.cells ? [{ col: c.title, ...c.cells[i] }] : i === 0 ? [{ col: c.title, value: '', note: PENDING_NOTE, pending: true, rowspan: rowLabels.length }] : []))
  }));
  return {
    available: true,
    basis: `Simulated. Updated daily, ${delay === 24 ? 'a day' : `${delay} hours`} behind.`,
    columns: columns.map(({ cells: _, ...c }) => c),
    rows
  };
}

/** Pure: the home's average box: each column's expectancy per plan, the managed exit only once it is shown. */
export function averages(body) {
  if (!trackAvailable(body)) return [];
  return COLUMNS.map((c) => ({ c, s: shownScenario(body, c.id) })).filter(({ s }) => s && finite(s.expectancy_r)).map(({ c, s }) => ({ id: c.id, title: c.title, value: signedR(s.expectancy_r, 2) }));
}
