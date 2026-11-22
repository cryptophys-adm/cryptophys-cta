// The public profile on a page in the shared look (the one-theme backlog, PR 1): the Threads link of every
// [data-threads] link and the brand's disclaimer in #disclaimer, from GET /api/public/profile. Pure: no request and no
// side effect on import; the page passes its document (a test passes a stand-in).

export const PROFILE_URL = '/api/public/profile';
// Only Threads' own profile host is taken from the answer; anything else keeps the page's link.
const THREADS = /^https:\/\/www\.threads\.(net|com)\//;

/** What a profile answer gives the page: the Threads URL and the disclaimer, each `null` when the answer has none. */
export function profileView(p) {
  const url = (Array.isArray(p?.links) ? p.links : []).find((l) => l?.channel === 'threads')?.url;
  const disclaimer = p?.brand?.disclaimer;
  return {
    threads: typeof url === 'string' && THREADS.test(url) ? url : null,
    disclaimer: typeof disclaimer === 'string' && disclaimer.trim() ? disclaimer : null
  };
}

/** Writes the profile into the page: the Threads links' href, the disclaimer's text. Returns what it wrote. */
export function applyProfile(p, doc = document) {
  const v = profileView(p);
  if (v.threads) doc.querySelectorAll('[data-threads]').forEach((a) => { a.href = v.threads; });
  const box = doc.getElementById('disclaimer');
  if (v.disclaimer && box) box.textContent = v.disclaimer;
  return v;
}
