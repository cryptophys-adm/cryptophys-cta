// Pure: the Archive page's model (frontend mockup 2026-11-22, owner approved): the published posts grouped by their UTC
// day, newest first, filtered by kind, with the kind tabs and their counts. The words are the ones the page always
// showed (the kind names, "All posts", the empty lines); a post's text is shown as published, its first line set as
// the headline. No network, no DOM.
export const ARCHIVE_URL = '/api/public/archive?limit=100';
export const KIND = Object.freeze({ key_levels: 'Key-level map', pattern: 'Chart pattern', daily_recap: 'Daily recap', custom: 'Post' });
export const EMPTY = 'No posts published yet.';
export const EMPTY_KIND = 'No posts of this type yet.';

const DAY = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const DATE = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' });
const TIME = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'UTC' });
const valid = (iso) => typeof iso === 'string' && Number.isFinite(Date.parse(iso));

/** "Friday, 20 November 2026" (UTC). */
export const dayOf = (iso) => (valid(iso) ? DAY.format(new Date(iso)) : '');
/** "20 Nov 2026, 12:15 AM UTC": UTC clock times in 12-hour form (owner 2026-11-17), as the page showed them. */
export const whenUtc = (iso) => (valid(iso) ? `${DATE.format(new Date(iso))}, ${TIME.format(new Date(iso))} UTC` : '');
/**
 * "7:15 AM GMT+7": the visitor's own time and zone (owner: UTC plus the viewer's local time), with the weekday when
 * the local day is not the UTC day ("Fri 5:00 AM GMT+7" for Thursday 22:00 UTC); empty for a visitor on UTC.
 */
export function whenLocal(iso, timeZone) {
  if (!valid(iso)) return '';
  try {
    const at = new Date(iso), tz = timeZone ? { timeZone } : {};
    const parts = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'short', ...tz }).formatToParts(at);
    const zone = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
    if (/^(UTC|GMT)$/.test(zone)) return '';
    const time = parts.filter((p) => p.type !== 'timeZoneName').map((p) => p.value).join('').trim();
    const ymd = (o) => new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', ...o }).format(at);
    const day = ymd(tz) !== ymd({ timeZone: 'UTC' }) ? `${new Intl.DateTimeFormat('en-US', { weekday: 'short', ...tz }).format(at)} ` : '';
    return `${day}${time} ${zone}`.replace(/\u202f/g, ' ').trim();
  } catch { return ''; }
}

/** A post's text as published: its first line as the headline, the rest below (leading blank lines aside). */
export function splitText(text) {
  const s = String(text ?? '');
  const i = s.indexOf('\n');
  return i < 0 ? { head: s, body: '' } : { head: s.slice(0, i), body: s.slice(i + 1).replace(/^\s*\n/, '') };
}

/** The tabs: All posts, then each kind, with their counts; `kind` '' is All posts. */
export function tabsOf(posts, kind = '') {
  const list = Array.isArray(posts) ? posts : [];
  return ['', ...Object.keys(KIND)].map((k) => ({ kind: k, label: k ? KIND[k] : 'All posts', count: k ? list.filter((p) => p?.kind === k).length : list.length, selected: k === kind }));
}

/** The shown posts grouped by UTC day, in the answer's order (newest first), or the empty line. */
export function archiveModel(posts, kind = '', { label = {}, timeZone } = {}) {
  const list = (Array.isArray(posts) ? posts : []).filter((p) => p && typeof p.text === 'string');
  const shown = list.filter((p) => !kind || p.kind === kind);
  if (!shown.length) return { days: [], empty: list.length ? EMPTY_KIND : EMPTY };
  const days = [];
  for (const p of shown) {
    const d = dayOf(p.published_at);
    if (!days.length || days.at(-1).day !== d) days.push({ day: d, posts: [] });
    days.at(-1).posts.push({ id: p.id, channel: label[p.channel] || p.channel, kind: KIND[p.kind] ?? '', utc: whenUtc(p.published_at), local: whenLocal(p.published_at, timeZone), at: p.published_at, ...splitText(p.text) });
  }
  return { days, empty: '' };
}
