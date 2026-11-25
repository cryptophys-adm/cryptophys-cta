// The CTA agent's Checks skill, for every channel (owner 2026-11-25: "setuju semua, mulai dari Checks"; "Agent jangan
// dedicated ke thread, harus untuk semua channel ... hanya fase 1 ini thread dulu"). Pure: for each recent draft of a
// channel, what the channel gets (on Threads: no hashtag line, no invisible character, the topic tag), the channel's
// linter and the humanizer's five checks, on the text as it goes out: humanized (humanize.py in full, owner 2026-11-25:
// "Everything, templates too"; src/agent/humanizer.mjs publishText at publish), then the channel's own form.
import { lintPost, textFor } from "./lint.mjs";
import { humanScore, humanize } from "./humanizer.mjs";
import { rulesOf } from "./rules.mjs";

/** The agent's skills and where each stands (the studio's Overview). Replies come in their own PR. */
export const AGENT_SKILLS = Object.freeze([
  { id: "linter", name: "Linter", what: "The channel's own rules on every draft: its length, the first line, a concrete hook, hashtags or the topic tag and where they sit, links, one ask, the search terms", runs: "each draft", model: "none", live: true },
  { id: "humanizer", name: "Humanizer", what: "Scores five checks; rewrites every post before it goes out (invisible characters, typography, the 154-term lexicon), checked by the guardian again; flags the shapes it cannot rewrite", runs: "each draft", model: "none", live: true },
  { id: "audit", name: "Audit", what: "Which posts of the last full week worked, against the channel's own median", runs: "each WIB week (Monday to Sunday)", model: "Beam writes the week's summary (studio only), once a week", live: true },
  { id: "plan", name: "Plan", what: "The week's mix and posting slots, from the audit; a person adds a slot", runs: "each WIB week", model: "none: the reasons are the audit's numbers", live: true },
  { id: "replies", name: "Replies", what: "Sorts replies under our posts and answers them without approval, within the caps; the first 72 hours a dry run", runs: "every 15 min", model: "Beam answers questions; buy or sell questions get a fixed answer; every answer checked", live: true }
]);

/** The Agent page's data for one channel from its latest drafts (newest first). */
export function agentChecks(drafts = [], { channel = "threads" } = {}) {
  const checks = (drafts || []).filter((d) => d?.channel === channel && typeof d.text === "string").map((d) => {
    const h = d.status === "published" ? { text: d.text, report: null } : humanize(d.text);
    const text = textFor(channel, h.text);
    return { id: d.id, kind: d.kind, status: d.status, created_at: d.created_at ?? null, text, humanized: h.text !== d.text, structures: h.report?.structures ?? [], lint: lintPost(channel, text), human: humanScore(text) };
  });
  const by = (v) => checks.filter((c) => c.lint.verdict === v).length;
  return { channel, topic_tag: rulesOf(channel)?.topic_tag ?? null, skills: AGENT_SKILLS, checks, summary: { checked: checks.length, ready: by("READY"), review: by("REVIEW"), fix: by("FIX"), human_pass: checks.filter((c) => c.human.verdict === "PASS").length } };
}
