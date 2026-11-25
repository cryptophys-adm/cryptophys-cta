// The shared script of the pages in the one look that have no script of their own (About, Disclaimer, Privacy, Terms,
// Sign in; the one-theme backlog, PR 1, PR 2 and PR 4): the header's UTC and local clock, the average strip, and one
// GET of the public profile (the Threads link and the disclaimer, ./profile.js). It never loads the war room, the home
// page's script or the TradingView quote: only the header, the strip, the record's URL and the profile.
import { startClock } from '../home/header.js';
import { renderAvgStrip } from '../home/avg-strip.js';
import { TRACK_URL } from '../home/track.js';
import { applyProfile, PROFILE_URL } from './profile.js';
import { pollWhileVisible, freshJson } from './poll.js';

startClock();

const json = (url) => fetch(url, { headers: { accept: 'application/json' } }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
json(PROFILE_URL).then((p) => applyProfile(p));
json(TRACK_URL).then((body) => renderAvgStrip(body));
// The strip stays realtime (owner 2026-11-25: "Everything realtime"): read again every minute while visible.
pollWhileVisible(() => freshJson(TRACK_URL).then((b) => { if (b) renderAvgStrip(b); }));
