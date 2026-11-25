// The CTA agent's Checks skill, for every channel (owner 2026-11-25: "setuju semua, mulai dari Checks"; "Agent jangan
// dedicated ke thread, harus untuk semua channel ... hanya fase 1 ini thread dulu"). Pure: for each recent draft of a
// channel, what the channel gets (on Threads: no hashtag line, no invisible character, the topic tag), the channel's
// linter and the humanizer's five checks. It changes no draft: the posts come from the xauusd templates (owner: "post
// sementara tetap dari xauusd").
import { lintPost, textFor } from "./lint.mjs";
import { humanScore } from "./humanizer.mjs";
import { rulesOf } from "./rules.mjs";

/** The agent's skills and where each stands (the studio's Overview). Replies come in their own PR. */
export const AGENT_SKILLS = Object.freeze([
  { id: "linter", name: "Linter", what: "The channel's own rules on every draft: its length, the first line, hashtags or the topic tag, links", runs: "each draft", model: "none", live: true },
  { id: "humanizer", name: "Humanizer", what: "Scores five checks; removes invisible characters on Threads when it is published; never rewrites the template's words", runs: "each draft", model: "none", live: true },
  { id: "audit", name: "Audit", what: "Which posts of the last full week worked, against the channel's own median", runs: "each WIB week (Monday to Sunday)", model: "Beam writes the week's summary (studio only), once a week", live: true },
  { id: "plan", name: "Plan", what: "The week's mix and posting slots, from the audit; a person adds a slot", runs: "each WIB week", model: "none: the reasons are the audit's numbers", live: true },
  { id: "replies", name: "Replies", what: "Sorts replies under our posts and answers them without approval, within the caps; the first 72 hours a dry run", runs: "every 15 min", model: "Beam answers questions; buy or sell questions get a fixed answer; every answer checked", live: true }
]);

/** The Agent page's data for one channel from its latest drafts (newest first). */
export function agentChecks(drafts = [], { channel = "threads" } = {}) {
  const checks = (drafts || []).filter((d) => d?.channel === channel && typeof d.text === "string").map((d) => {
    const text = textFor(channel, d.text);
    return { id: d.id, kind: d.kind, status: d.status, created_at: d.created_at ?? null, text, lint: lintPost(channel, text), human: humanScore(text) };
  });
  const by = (v) => checks.filter((c) => c.lint.verdict === v).length;
  return { channel, topic_tag: rulesOf(channel)?.topic_tag ?? null, skills: AGENT_SKILLS, checks, summary: { checked: checks.length, ready: by("READY"), review: by("REVIEW"), fix: by("FIX"), human_pass: checks.filter((c) => c.human.verdict === "PASS").length } };
}
