// The humanizer of the CTA agent's Checks skill (owner 2026-11-25: "setuju semua, mulai dari Checks"; the studio's
// Agent page). Skill cta-human: adapted from instagram-agent-skill's detector and humanizer (detect.py, humanize.py),
// MIT License, Copyright (c) 2026 Jake Schincariol: src/agent/LICENSE-instagram-agent-skill. Pure, no network.
//
// In full since 2026-11-25 (owner: "lengkapi semua tidak boleh ada sebagian, tiru semuanya"; the humanizer's rewrite on
// "Everything, templates too"): `humanize` is humanize.py's four passes on every post before it goes out (URLs
// protected; invisible characters; typography: em dash to comma, en dash to hyphen, curly quotes, ellipsis, middle dot
// and bullet to hyphen, arrow; the 154-term lexicon; capitals restored) and its structural flags; `humanScore` is
// detect.py's five checks, higher is more human.
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

// ---- humanize.py, in full ----
const URL_RE = /https?:\/\/\S+|www\.\S+|\S+@\S+\.\S+/g;
const SENT_RE = /[^.!?\n]+[.!?]*/g;
const matchCase = (src, repl) => {
  if (!repl) return repl;
  if (src.length > 1 && src === src.toUpperCase() && /[A-Z]/.test(src)) return repl.toUpperCase();
  if (/^[A-Z]/.test(src)) return repl[0].toUpperCase() + repl.slice(1);
  return repl;
};
const LEXICON = [...SLOP.phrases, ...SLOP.words].sort((a, b) => b.find.length - a.find.length)
  .map((e) => ({ ...e, re: new RegExp(`\\b${escapeRe(e.find).replace(/\\? /g, "\\s+")}\\b`, "giu") }));

function passTypographic(text) {
  const hits = [];
  for (const e of SLOP.typographic) {
    const n = text.split(e.from).length - 1;
    if (!n) continue;
    hits.push({ name: `${e.from} ${e.name}`, count: n, to: e.to.trim() || "(space)" });
    if (e.from === "—") text = text.replace(/\s*—\s*/g, ", ");
    else if (e.from === "–") text = text.replace(/\s*–\s*(?=\d)/g, "-").replace(/\s+–\s+/g, ", ").split("–").join("-");
    else text = text.split(e.from).join(e.to);
  }
  text = text.replace(/,\s*([,.;:!?])/g, "$1").replace(/,\s*\n/g, "\n");
  return { text, hits };
}
function passLexical(text) {
  const hits = [];
  for (const e of LEXICON) {
    const found = text.match(e.re);
    if (!found) continue;
    hits.push({ find: e.find, replace: e.replace || "(deleted)", count: found.length, family: e.family });
    text = text.replace(e.re, (m) => matchCase(m, e.replace));
  }
  text = text.replace(/[ \t]{2,}/g, " ")
    .replace(/^[ \t]*(?:[,.;:]+[ \t]*)+/gm, "")
    .replace(/^[ \t](?=\S)/gm, "")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/,\s*([,.;:!?])/g, "$1")
    .split("...").join("\u0000ELL\u0000")
    .replace(/\.\s*\.+/g, ".")
    .replace(/([!?])\s*\./g, "$1")
    .split("\u0000ELL\u0000").join("...")
    .replace(/^[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/,\s*(also|so|still|basically|in the end)\s*,\s*/g, (_, w) => `. ${w[0].toUpperCase()}${w.slice(1)}, `);
  return { text, hits };
}
/** Restores sentence capitals a deletion lowered, for a writer who capitalises (humanize.py's restore_capitals). */
function restoreCapitals(original, text) {
  const starts = [...String(original).matchAll(/(?:^|[.!?]\s+|\n)\s*([A-Za-z])/g)].map((m) => m[1]);
  if (!starts.length || starts.filter((c) => c === c.toUpperCase()).length * 2 < starts.length) return text;
  return text.replace(/(^|[.!?] |[.!?]\n|\n)(\s*)([a-z])/g, (_, a, b, c) => `${a}${b}${c.toUpperCase()}`);
}
/** humanize.py's structural flags: the shapes a script cannot rewrite, and uniform sentence length. */
export function scanStructures(text) {
  const flags = [];
  for (const s of SLOP.structures) { const n = (String(text).match(jsRegex(s.regex)) || []).length; if (n) flags.push({ id: s.id, name: s.name, count: n, fix: s.fix }); }
  const lens = (String(text).match(SENT_RE) || []).map((x) => x.trim().split(/\s+/).length).filter((n) => n > 2);
  if (lens.length >= 4) {
    const m = mean(lens), cv = m ? pstdev(lens) / m : 0;
    if (cv < 0.35) flags.push({ id: "uniform-length", name: `Uniform sentence length (variation ${cv.toFixed(2)})`, count: lens.length, fix: "Break one sentence in half. Let another run long. Machines write even." });
  }
  return flags;
}
/**
 * humanize.py in full: URLs kept as they are; invisible characters, typography and the lexicon rewritten; capitals
 * restored. Returns { text, report: { invisible, typographic, lexical, structures } }. Hashtag words are left alone.
 */
export function humanize(text) {
  const raw = String(text ?? "");
  const urls = [];
  let t = raw.replace(URL_RE, (u) => { urls.push(u); return `\u0001URL${urls.length - 1}\u0001`; });
  const tags = [];
  t = t.replace(/#[A-Za-z0-9_]+/g, (h) => { tags.push(h); return `\u0001TAG${tags.length - 1}\u0001`; });
  const inv = cleanInvisible(t);
  t = inv.text;
  const typo = passTypographic(t); t = typo.text;
  const lex = passLexical(t); t = lex.text;
  t = restoreCapitals(raw, t);
  t = t.replace(/\u0001TAG(\d+)\u0001/g, (_, i) => tags[Number(i)]).replace(/\u0001URL(\d+)\u0001/g, (_, i) => urls[Number(i)]);
  const out = t.replace(/\s+$/, "").replace(/^\s+/, "");
  return { text: out, report: { invisible: inv.removed, typographic: typo.hits, lexical: lex.hits, structures: scanStructures(out) } };
}

/**
 * The text a draft goes out with (owner 2026-11-25, "Everything, templates too"): the humanized text when it still passes
 * the guardian (`check(draft)` returns { pass }), else the text that was approved, unchanged. Pure.
 * Returns { text, changed, kept, report }: `kept` is true when the humanized text failed the guardian.
 */
export function publishText(draft, check) {
  const original = String(draft?.text ?? "");
  const h = humanize(original);
  if (h.text === original) return { text: original, changed: false, kept: false, report: h.report };
  const g = check ? check({ ...draft, text: h.text }) : { pass: true };
  if (!g?.pass) return { text: original, changed: false, kept: true, report: h.report, failures: g?.failures ?? [] };
  return { text: h.text, changed: true, kept: false, report: h.report };
}
