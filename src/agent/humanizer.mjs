// The humanizer of the CTA agent's Checks skill (owner 2026-11-25: "setuju semua, mulai dari Checks"; the studio's
// Agent page). A JavaScript port of instagram-agent-skill's skills/ig-human (detect.py, and humanize.py's invisible
// pass), MIT License, Copyright (c) 2026 Jake Schincariol: src/agent/LICENSE-instagram-agent-skill. Pure, no network.
//
// Posts still come from the xauusd templates (owner 2026-11-25: "post sementara tetap dari xauusd"), so the humanizer
// never rewrites a post's words: it removes only characters a keyboard does not type (invisible format characters,
// which change nothing a reader sees) and scores the text on five checks, higher is more human, as detect.py does.
import { SLOP } from "./slop.mjs";

const clamp = (n) => Math.max(0, Math.min(100, n));
/** `value` on 0..100, where `human` gives 100 and `machine` gives 0 (detect.py's scale). */
const scale = (value, human, machine) => (human === machine ? 50 : clamp(((value - machine) / (human - machine)) * 100));
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const pstdev = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };

/** A Python pattern of the lexicon as a JavaScript RegExp: inline flags to flags, \UXXXXXXXX to \u{...}. */
export function jsRegex(python, extra = "g") {
  let src = String(python), flags = new Set([...extra, "u"]);
  const lead = /^\(\?([a-z]+)\)/.exec(src);
  if (lead) { src = src.slice(lead[0].length); for (const f of lead[1]) if ("ims".includes(f)) flags.add(f); }
  src = src.replace(/\\U([0-9A-Fa-f]{8})/g, (_, h) => `\\u{${h.replace(/^0+/, "") || "0"}}`);
  return new RegExp(src, [...flags].join(""));
}
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const STRUCTURES = SLOP.structures.map((s) => ({ id: s.id, re: jsRegex(s.regex) }));
const TERMS = [...SLOP.words, ...SLOP.phrases].map((e) => ({ find: e.find, re: new RegExp(`\\b${escapeRe(e.find).replace(/\\? /g, "\\s+")}\\b`, "giu") }));

/** The invisible code points the lexicon names (delete, or a plain space), and any other format (Cf) character. */
const INVISIBLE = SLOP.invisible.flatMap((e) => {
  const [a, b] = e.cp.split("-").map((x) => parseInt(x.replace(/^U\+/, ""), 16));
  const out = [];
  for (let cp = a; cp <= (b ?? a); cp++) out.push([cp, e.action]);
  return out;
});
const ACTION = new Map(INVISIBLE);
const FORMAT = /\p{Cf}/u;

/**
 * The text without the characters a keyboard does not type: each named invisible character deleted or made a plain
 * space, and any other format character deleted. `removed` counts them. The words are untouched.
 */
export function cleanInvisible(text) {
  let removed = 0, out = "";
  for (const ch of String(text ?? "")) {
    const cp = ch.codePointAt(0), act = ACTION.get(cp);
    if (act === "space") { out += " "; removed++; }
    else if (act === "delete" || FORMAT.test(ch)) removed++;
    else out += ch;
  }
  return { text: out, removed };
}

const SENT = /[^.!?\n]+[.!?]*/g;
const WORD = /[A-Za-z']+/g;
const CONTRACTIONS = /\b\w+'(?:s|t|re|ve|ll|d|m)\b/gi;
const PRONOUNS = /\b(i|me|my|mine|we|us|our|you|your)\b/gi;
const NUMBERS = /\b\d[\d,.]*%?\b|\$\d/g;
const PROPER = /(?<![.!?]\s)(?<!^)\b[A-Z][a-z]{2,}\b/gm;
const count = (s, re) => (String(s).match(re) || []).length;
const words = (t) => String(t).match(WORD) || [];
const sentences = (t) => (String(t).match(SENT) || []).map((s) => s.trim()).filter((s) => s.split(/\s+/).length > 2);

function burstiness(text) {
  const lens = sentences(text).map((s) => s.split(/\s+/).length);
  if (lens.length < 4) return { score: 50, detail: "too short to judge" };
  const m = mean(lens), cv = m ? pstdev(lens) / m : 0;
  return { score: scale(cv, 0.7, 0.22), detail: `variation ${cv.toFixed(2)} across ${lens.length} sentences (want 0.55+)` };
}
function specificity(text) {
  const w = words(text);
  if (w.length < 25) return { score: 50, detail: "too short to judge" };
  const hits = count(text, NUMBERS) + new Set(String(text).match(PROPER) || []).size;
  const density = (hits * 100) / w.length;
  return { score: scale(density, 6, 0.5), detail: `${hits} concrete markers, ${density.toFixed(1)} per 100 words (want 4+)` };
}
function slop(text) {
  const w = words(text);
  if (!w.length) return { score: 50, detail: "empty" };
  let hits = 0; const found = [];
  for (const t of TERMS) { const n = count(text, t.re); if (n) { hits += n; found.push(t.find); } }
  const density = (hits * 100) / w.length;
  const list = found.sort().slice(0, 4).join(", ") + (found.length > 4 ? ", ..." : "");
  return { score: scale(density, 0, 4), detail: `${hits} stock terms, ${density.toFixed(1)} per 100 words${found.length ? ` (${list})` : ""}` };
}
function fingerprint(text) {
  const s = String(text);
  const invisible = [...s].filter((c) => FORMAT.test(c)).length;
  const em = count(s, /—/g), curly = count(s, /[‘’“”]/g), ellip = count(s, /…/g), nbsp = count(s, /[   ]/g);
  const per1k = ((invisible * 4 + em * 2 + curly + ellip + nbsp) * 1000) / Math.max(s.length, 1);
  return { score: scale(per1k, 0, 12), detail: `${invisible} invisible, ${em} em dash, ${curly} curly quote, ${ellip} ellipsis, ${nbsp} hard space` };
}
function voice(text) {
  const w = words(text);
  if (w.length < 25) return { score: 50, detail: "too short to judge", tells: [] };
  const per100 = 100 / w.length;
  const contractions = count(text, CONTRACTIONS) * per100, person = count(text, PRONOUNS) * per100;
  let tells = 0; const names = [];
  for (const s of STRUCTURES) { const n = count(text, s.re); if (n) { tells += n; names.push(s.id); } }
  const bullets = (String(text).match(/^\s*[-*•]\s+(.+)$/gm) || []).map((b) => b.replace(/^\s*[-*•]\s+/, "").split(/\s+/).length);
  let score = scale(contractions, 3, 0) * 0.35 + scale(person, 8, 1) * 0.35 + clamp(100 - tells * 22) * 0.3;
  if (bullets.length >= 3 && pstdev(bullets) < 1.6) { score -= 12; names.push("uniform-bullets"); }
  return { score: clamp(score), detail: `${contractions.toFixed(1)} contractions, ${person.toFixed(1)} personal pronouns per 100 words, ${tells} structural tell(s)${names.length ? ` [${names.slice(0, 4).join(", ")}]` : ""}`, tells: names };
}

export const HUMAN_CHECKS = Object.freeze(["burstiness", "specificity", "slop", "fingerprint", "voice"]);

/**
 * detect.py's panel: five scores (0 to 100, higher is more human), the overall (the mean at 60 %, the weakest at 40 %)
 * and the verdict (PASS at 70 or more with no check under 55, REVIEW at 50 or more, else FLAGGED).
 */
export function humanScore(text) {
  const checks = { burstiness: burstiness(text), specificity: specificity(text), slop: slop(text), fingerprint: fingerprint(text), voice: voice(text) };
  const scores = HUMAN_CHECKS.map((k) => checks[k].score);
  const overall = mean(scores) * 0.6 + Math.min(...scores) * 0.4;
  const verdict = overall >= 70 && Math.min(...scores) >= 55 ? "PASS" : overall >= 50 ? "REVIEW" : "FLAGGED";
  const round = (n) => Math.round(n * 10) / 10;
  return { checks: Object.fromEntries(HUMAN_CHECKS.map((k) => [k, { score: round(checks[k].score), detail: checks[k].detail }])), score: round(overall), verdict };
}
