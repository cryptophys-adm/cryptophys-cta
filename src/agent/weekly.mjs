// The Audit's weekly summary written by the model (the CTA agent, owner 2026-11-25: "setuju semua"; the mockup's
// "Beam writes the summary"). Once a week, at the first daily run after the WIB week closes: three sentences for the
// studio from the audit's own findings. Studio-only text. A summary that names a number the findings do not hold is
// thrown away (the model adds nothing), and so is one that reads as advice about buying or selling.
import { auditThreads } from "./audit.mjs";
import { askModel } from "./router.mjs";

export const SUMMARY_KEY = "agent_audit_summary";
const NUMBER = /\d+(?:[.,]\d+)?/g;
const ADVICE = /\b(buy|sell|long|short|entry|stop[- ]?loss|take[- ]?profit|target|signal)\b/i;

/** The numbers a text names, as plain strings ("1,200" and "1200" alike). */
const numbersOf = (s) => new Set((String(s).match(NUMBER) || []).map((n) => n.replace(/,/g, "")));

/** Whether a summary only restates the facts: each number it names is in them, and it gives no trading advice. */
export function summaryOk(text, facts) {
  const allowed = numbersOf(JSON.stringify(facts));
  for (const n of numbersOf(text)) if (!allowed.has(n)) return false;
  return !ADVICE.test(text) && text.length <= 700;
}

/** The facts the model is given: the week, the median and the findings, nothing else. */
export const factsOf = (audit) => ({ week_from: audit.week.from.slice(0, 10), week_to: audit.week.to.slice(0, 10), median_views: audit.median_views, kinds: audit.kinds.map((k) => ({ kind: k.name, posts: k.posts, median_multiple: k.median_multiple, replies: k.replies, reposts: k.reposts })), findings: audit.findings });

/** Writes this week's summary once. `store` as in router.mjs; `posts` the measured posts. */
export async function weeklySummary(env, store, posts, { now = Date.now(), fetcher } = {}) {
  const audit = auditThreads(posts, { now });
  const have = await store.setting(SUMMARY_KEY).catch(() => null);
  if (have?.value?.week === audit.week.from) return { status: "done_already", week: audit.week.from };
  if (!audit.posts.length) return { status: "nothing_to_sum_up", week: audit.week.from };
  const facts = factsOf(audit);
  const r = await askModel(env, store, {
    purpose: "audit_summary", now, ...(fetcher ? { fetcher } : {}),
    messages: [
      { role: "system", content: "You write a short internal note for a social media studio. In at most three plain English sentences, say which kinds of Threads post did best and worst last week and what to watch next week. Use only the facts given; do not add any number that is not in them. Never mention buying, selling, prices or trading advice." },
      { role: "user", content: JSON.stringify(facts) }
    ]
  });
  if (!r.ok) return { status: "no_summary", week: audit.week.from, ...(r.skipped ? { skipped: r.skipped } : { error: r.error }) };
  if (!summaryOk(r.text, facts)) return { status: "summary_refused", week: audit.week.from };
  await store.saveSetting({ key: SUMMARY_KEY, value: { week: audit.week.from, text: r.text, model: "beam" }, actor: "cta-agent" });
  return { status: "written", week: audit.week.from, cost_usd: r.cost_usd };
}
