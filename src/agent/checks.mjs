// The CTA agent's Checks skill, for every channel (owner 2026-11-25: "setuju semua, mulai dari Checks"; "Agent jangan
// dedicated ke thread, harus untuk semua channel ... hanya fase 1 ini thread dulu"). Pure: for each recent draft of a
// channel, what the channel gets (on Threads: no hashtag line, no invisible character, the topic tag), the channel's
// linter and the humanizer's five checks, on the text as it goes out: humanized (humanize.py in full, owner 2026-11-25:
// "Everything, templates too"; src/agent/humanizer.mjs publishText at publish), then the channel's own form.
import { lintPost, textFor } from "./lint.mjs";
import { humanScore, humanize } from "./humanizer.mjs";
import { rulesOf } from "./rules.mjs";

/**
 * The CTA agent's skills, under the CTA's own names (owner 2026-11-25: "gunakan nama cta lebih general"), and where each
 * stands (the studio's Overview). All are adapted from instagram-agent-skill (MIT, src/agent/LICENSE-instagram-agent-skill)
 * for every channel; `live: false` ones are adopted next (owner: "lengkapi semua ... tiru semuanya").
 */
export const AGENT_SKILLS = Object.freeze([
  { id: "cta-lint", name: "Lint", what: "The channel's own rules on every draft: its length, the first line, a concrete hook, hashtags or the topic tag and where they sit, links, one ask, the search terms", runs: "each draft", model: "none", live: true },
  { id: "cta-human", name: "Humanize", what: "Scores five checks; rewrites every post before it goes out (invisible characters, typography, the 154-term lexicon), checked by the guardian again; flags the shapes it cannot rewrite", runs: "each draft", model: "none", live: true },
  { id: "cta-audit", name: "Audit", what: "Which posts of the last full week worked, against the channel's own median", runs: "each WIB week (Monday to Sunday)", model: "Beam writes the week's summary (studio only), once a week", live: true },
  { id: "cta-plan", name: "Plan", what: "The week's mix and posting slots, from the audit; a person adds a slot", runs: "each WIB week", model: "none: the reasons are the audit's numbers", live: true },
  { id: "cta-reply", name: "Reply", what: "Sorts replies under our posts and answers them without approval, within the caps; the first 72 hours a dry run", runs: "every 15 min", model: "Beam answers questions; buy or sell questions get a fixed answer; every answer checked", live: true },
  { id: "cta-write", name: "Write", what: "Writes a post from the xauusd facts behind rule 4's guards; the fixed template when it fails them", runs: "each draft", model: "Beam", live: false },
  { id: "cta-hook", name: "Hook", what: "Scores a post's opening against the hook formulas and suggests a stronger one", runs: "each draft", model: "none", live: false },
  { id: "cta-carousel", name: "Carousel", what: "Turns an analysis into a multi-image post, one point a card", runs: "each analysis", model: "Beam, behind rule 4's guards", live: false },
  { id: "cta-repurpose", name: "Repurpose", what: "One analysis in every channel's own form", runs: "each analysis", model: "Beam, behind rule 4's guards", live: false },
  { id: "cta-profile", name: "Profile", what: "Reviews each channel's profile against a 12-part rubric", runs: "each month", model: "none", live: false },
  { id: "cta-reel", name: "Reel", what: "Beats for a short video from an analysis", runs: "each video", model: "Beam, behind rule 4's guards", live: false },
  { id: "cta-story", name: "Story", what: "Frames for a story from an analysis", runs: "each story", model: "Beam, behind rule 4's guards", live: false },
  { id: "cta-trends", name: "Trends", what: "What gold talk is moving on the channel, from its official search", runs: "each day", model: "none", live: false },
  { id: "cta-comment", name: "Comment", what: "Short checked comments on others' gold posts, within strict caps", runs: "each day", model: "Beam, behind rule 4's guards", live: false },
  { id: "cta-dm", name: "Message", what: "Answers a person who wrote to us first, checked like a reply", runs: "on each message", model: "Beam, behind rule 4's guards", live: false }
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
