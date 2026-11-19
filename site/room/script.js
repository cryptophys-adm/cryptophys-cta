// Pure: the live scene of the rooms (GET /api/public/warroom-scene) as the holo war room's meetings. No DOM, no
// three.js, so the tests run it in Node. The xauusd Worker already filters every sentence (publicRoomScene); this is
// a second, smaller net, so a line that still looks like an order, a price or a position is dropped, never shown.
import { PEOPLE, MEETINGS } from './data.js';

const KNOWN = new Set(PEOPLE.map((p) => p.id));
const BIASES = new Set(['bullish', 'bearish', 'neutral']);
// Order words, a price-like number, a position: never on the public page.
const UNSAFE = /\b(buy|sell|entry|entries|stop[- ]?loss|take[- ]?profit|tp|sl|target|leverage|lot|position(?:s|ed)?)\b|\d{3,}(?:[.,]\d+)?|#\s?\d/i;
const MAX_CLAIMS = 8, MAX_REBUTTALS = 3, MAX_WEIGHING = 6, MAX_REASONS = 3, MAX_TEXT = 260;

export const safeLine = (s) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  // A ratio such as the Fibonacci 0.618 is analysis, not a price (as in the Worker's filter).
  return t && t.length <= MAX_TEXT && !UNSAFE.test(t.replace(/\b0?\.\d+\b/g, ' ')) ? t : '';
};
const joined = (list) => safeLine((Array.isArray(list) ? list : []).join(' '));

/** The meeting id (m15, h1, h4, d1) of a room source (15m, 1h, 4h, 1d). */
export const meetingOf = (source) => Object.keys(MEETINGS).find((k) => MEETINGS[k].source === source) ?? null;

/**
 * One room's scene as a meeting: { id, at, bias, talk: [{ agent, text, to? }], reasons, analysts }. `analysts` keeps
 * each known analyst's public metrics and latest excerpt for its profile card. Null when the room is not usable.
 */
export function meetingFromScene(scene) {
  const id = meetingOf(scene?.source);
  if (!id || typeof scene.at !== 'string') return null;
  const analysts = {};
  const claims = [], rebuttals = [], weighing = [];
  for (const a of Array.isArray(scene.analysts) ? scene.analysts : []) {
    if (!KNOWN.has(a?.id)) continue;
    const claim = joined(a.claim), rebuttal = joined(a.rebuttal);
    const metrics = (Array.isArray(a.metrics) ? a.metrics : []).map(safeLine).filter(Boolean).slice(0, 3);
    analysts[a.id] = { metrics, latest: rebuttal || claim || '', bias: BIASES.has(a.bias) ? a.bias : null };
    if (claim) claims.push({ agent: a.id, text: claim });
    if (rebuttal) rebuttals.push({ agent: a.id, text: rebuttal, to: (Array.isArray(a.rebuts) ? a.rebuts : []).filter((r) => KNOWN.has(r)).slice(0, 2) });
    if (metrics.length) weighing.push({ agent: a.id, text: metrics.join(' · ') });
  }
  const talk = claims.length ? [...claims.slice(0, MAX_CLAIMS), ...rebuttals.slice(0, MAX_REBUTTALS)] : weighing.slice(0, MAX_WEIGHING);
  const reasons = (Array.isArray(scene.moderator) ? scene.moderator : []).map(safeLine).filter(Boolean).slice(0, MAX_REASONS);
  if (!talk.length && !reasons.length) return null;
  return { id, at: scene.at, bias: BIASES.has(scene.bias) ? scene.bias : 'neutral', talk, reasons, analysts };
}

/** Every usable room of a scene response, by meeting id. */
export function meetingsFromResponse(body) {
  const out = {};
  for (const scene of Object.values(body?.rooms ?? {})) {
    const m = meetingFromScene(scene);
    if (m) out[m.id] = m;
  }
  return out;
}

/** The meetings whose room concluded since the last poll (their `at` changed), oldest first. */
export function freshMeetings(prev, next) {
  return Object.values(next).filter((m) => prev[m.id]?.at !== m.at).sort((a, b) => a.at.localeCompare(b.at)).map((m) => m.id);
}

/** The meeting whose room concluded last. */
export const latestMeeting = (meetings) => Object.values(meetings).sort((a, b) => b.at.localeCompare(a.at))[0]?.id ?? null;

/** "18 Nov, 6:45 PM UTC" (UTC clock times in 12-hour form, as on the rest of the site). */
export function whenOf(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })}, ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'UTC' })} UTC`;
}
