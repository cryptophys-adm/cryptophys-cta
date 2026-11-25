// The CTA agent's auto-approve (owner 2026-11-25: "Yes, posted by itself"; kinds "Chart pattern (confirmed), Key-level
// map, Daily recap, War Room"; the mockup "CTA Studio: auto-approve", its six public sentences "Use the mockup's
// sentences"; the lawyer "No, go ahead"). AGENTS.md rule 2's second exception.
//
// Every 5 minutes, on a channel that publishes: each pending draft of a kind the channel approves automatically
// (settings `auto_approve`, Threads by default) is approved AUTO_WINDOW_MINUTES after it became ready (drafted, or its
// card attached), unless a person edited it (then it waits for a person, as before). The approval is the same as a
// person's: the guardian runs again, an expired analysis draft is not approved, and the post then goes out at once or at
// the channel's next posting slot. A person can approve, edit or reject it in the window.
export const AUTO_WINDOW_MINUTES = 15;
export const AUTO_ACTOR = "auto-approve";

/** When a draft is approved automatically (ISO), or null when it waits for a person. */
export function autoAt(candidate) {
  if (!candidate || candidate.edited) return null;
  const t = Date.parse(candidate.ready_at ?? "");
  return Number.isFinite(t) ? new Date(t + AUTO_WINDOW_MINUTES * 60_000).toISOString() : null;
}
/** The candidates whose window has passed at `now`. */
export const dueNow = (candidates, now = Date.now()) => (candidates || []).filter((c) => { const at = autoAt(c); return at && Date.parse(at) <= now; });
