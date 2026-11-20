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
    if (metrics.length) weighing.push({ agent: a.id, text: metrics.join(', ') });
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

/* ---------- the minutes (the homepage's record of each room's last meeting) ---------- */
const TITLE = Object.fromEntries(PEOPLE.map((p) => [p.id, p.title]));
/** The rooms by meeting id, as the page names them. */
export const ROOM_NAME = { m15: '15-minute room', h1: 'Hourly room', h4: '4-hour room', d1: 'Daily room' };
/** A reading in words: never "neutral" (the room is undecided). Colours: bearish red, bullish green, undecided amber. */
export const BIAS_WORD = { bearish: 'bearish', bullish: 'bullish', neutral: 'undecided' };
const andList = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);

/**
 * Pure: one room's scene as its minutes: { id, room, at, bias, conclusion, speakers, tally }. Each speaker is a known
 * analyst whose claim passes the public filter (an analyst with no claim did not speak); its rebuttal and whom it
 * answered come with it. The same filter as the scene: no order word, no price, no position. Null when unusable.
 */
export function minutesFromScene(scene) {
  const id = meetingOf(scene?.source);
  if (!id || typeof scene.at !== 'string') return null;
  const speakers = [];
  for (const a of Array.isArray(scene.analysts) ? scene.analysts : []) {
    if (!KNOWN.has(a?.id)) continue;
    const claim = joined(a.claim);
    if (!claim) continue;
    const to = (Array.isArray(a.rebuts) ? a.rebuts : []).filter((r) => KNOWN.has(r) && r !== a.id).map((r) => TITLE[r]);
    speakers.push({ id: a.id, title: TITLE[a.id], bias: BIASES.has(a.bias) ? a.bias : 'neutral', claim, rebuttal: joined(a.rebuttal), to: [...new Set(to)] });
  }
  const conclusion = (Array.isArray(scene.moderator) ? scene.moderator : []).map(safeLine).filter(Boolean);
  if (!speakers.length && !conclusion.length) return null;
  const tally = { bearish: 0, neutral: 0, bullish: 0 };
  for (const s of speakers) tally[s.bias] += 1;
  return { id, room: ROOM_NAME[id], at: scene.at, bias: BIASES.has(scene.bias) ? scene.bias : 'neutral', conclusion, speakers, tally };
}

/** Every usable room's minutes, by meeting id. */
export function minutesFromResponse(body) {
  const out = {};
  for (const scene of Object.values(body?.rooms ?? {})) { const m = minutesFromScene(scene); if (m) out[m.id] = m; }
  return out;
}

/** "8 bearish, 3 undecided and 2 bullish of 13 who spoke". */
export function tallyWords(tally) {
  const parts = ['bearish', 'neutral', 'bullish'].filter((k) => tally[k]).map((k) => `${tally[k]} ${BIAS_WORD[k]}`);
  const n = tally.bearish + tally.neutral + tally.bullish;
  return n ? `${andList(parts)} of ${n} who spoke` : 'No analyst spoke';
}

/** "In reply to the Supertrend and Order Blocks", or "In reply" when the analysts it answered are not named. */
export const replyWords = (to) => (to?.length ? `In reply to ${andList(to)}` : 'In reply');

/**
 * Pure: the hero's status line. While a meeting replays in the scene: that room is meeting. Otherwise the 15-minute
 * room's reading (the room that meets most), else the room that met last. Null before any room.
 */
export function statusOf(meetings, playing = null) {
  if (playing && meetings[playing]) return { text: `The ${ROOM_NAME[playing].toLowerCase()} is meeting`, at: meetings[playing].at, bias: meetings[playing].bias };
  const id = meetings.m15 ? 'm15' : latestMeeting(meetings);
  if (!id) return null;
  return { text: `The ${ROOM_NAME[id].toLowerCase()} reads ${BIAS_WORD[meetings[id].bias] ?? 'undecided'}`, at: meetings[id].at, bias: meetings[id].bias };
}

/* ---------- the latest post (owner 2026-11-19: "Follow first", each channel's latest post; Threads only for now) ---------- */
/**
 * Pure: a post's headline for the home page: its first line without the "Education ·" prefix, the post's own dots as
 * commas, through the same filter as the rooms. Only the headline: a post's body may carry prices and levels.
 * Empty when the line does not pass.
 */
export function postHeadline(text) {
  const first = String(text ?? '').split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  return safeLine(first.replace(/^Education\s*·\s*/i, '').replace(/\s*·\s*/g, ', '));
}

/** Pure: the newest published post of a channel from GET /api/public/archive, or null. */
export function latestPost(posts, channel = 'threads') {
  const mine = (Array.isArray(posts) ? posts : []).filter((p) => p?.channel === channel && typeof p.published_at === 'string');
  const last = mine.sort((a, b) => b.published_at.localeCompare(a.published_at))[0];
  return last ? { channel, at: last.published_at, headline: postHeadline(last.text) } : null;
}
