// The CTA agent's Checks skill (owner 2026-11-25: "setuju semua, mulai dari Checks"; the studio's Agent page, from the
// mockup "CTA Studio: the Agent page"). Pure: for each recent Threads draft, what Threads gets (no hashtag line, no
// invisible character, the topic tag), the Threads linter and the humanizer's five checks. It changes no draft: the
// posts come from the xauusd templates (owner: "post sementara tetap dari xauusd").
import { lintThreads, threadsText, THREADS_TOPIC_TAG } from "./threads-lint.mjs";
import { humanScore } from "./humanizer.mjs";

/** The agent's skills and where each stands (the studio's Overview). Audit, Plan and Replies come in their own PRs. */
export const AGENT_SKILLS = Object.freeze([
  { id: "linter", name: "Linter", what: "Threads rules on every draft: 500 characters, the first line, one topic tag, links", runs: "each draft", model: "none", live: true },
  { id: "humanizer", name: "Humanizer", what: "Removes invisible characters when it is published; scores five checks; never rewrites the template's words", runs: "each draft", model: "none", live: true },
  { id: "audit", name: "Audit", what: "Which posts of the last full week worked, against our own median", runs: "each WIB week (Monday to Sunday)", model: "Beam writes the week's summary (studio only), once a week", live: true },
  { id: "plan", name: "Plan", what: "The week's mix and posting slots, from the audit; a person adds a slot", runs: "each WIB week", model: "none: the reasons are the audit's numbers", live: true },
  { id: "replies", name: "Reply triage", what: "Sorts replies under our posts and answers them", runs: "every 15 min", model: "Beam drafts; the guardian checks", live: false }
]);

/** The Agent page's data from the latest Threads drafts (newest first). */
export function agentChecks(drafts = [], { topicTag = THREADS_TOPIC_TAG } = {}) {
  const checks = (drafts || []).filter((d) => d?.channel === "threads" && typeof d.text === "string").map((d) => {
    const text = threadsText(d.text);
    return { id: d.id, kind: d.kind, status: d.status, created_at: d.created_at ?? null, text, lint: lintThreads(text, { topicTag }), human: humanScore(text) };
  });
  const by = (v) => checks.filter((c) => c.lint.verdict === v).length;
  return { topic_tag: topicTag, skills: AGENT_SKILLS, checks, summary: { checked: checks.length, ready: by("READY"), review: by("REVIEW"), fix: by("FIX"), human_pass: checks.filter((c) => c.human.verdict === "PASS").length } };
}
