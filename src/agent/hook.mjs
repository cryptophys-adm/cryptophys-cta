// The CTA agent's cta-hook skill (owner 2026-11-25: "lengkapi semua tidak boleh ada sebagian, tiru semuanya"; "gunakan
// nama cta lebih general"): adapted from instagram-agent-skill's hookscore.py and hooks.json (MIT License, Copyright (c)
// 2026 Jake Schincariol: src/agent/LICENSE-instagram-agent-skill). Pure, no network.
//
// `hookScore(line)` scores a post's opening line on the five properties strong hooks share (LENGTH, SPECIFICITY,
// STAKES, FRONTLOAD, ADDRESS, 0 to 100 each, higher is better), less 15 for each dealbreaker; the overall is the mean
// times 0.6 plus the weakest times 0.4, as hookscore.py. STRONG at 70 or more with no check under 55 and no
// dealbreaker, OK at 50, else WEAK. `hookFormula(line)` names the formula of hooks.json it follows, walked in
// `classify_order`, or null. Advisory: the source measured it separating real hooks from bad ones (AUC 0.83), not good
// from better (0.56), so it informs a person and cta-write; it blocks nothing.
import { HOOKS } from "./hooks-data.mjs";
import { jsRegex } from "./humanizer.mjs";

const clamp = (n) => Math.max(0, Math.min(100, n));
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const WORD_RE = /[A-Za-z0-9$%'’-]+/g;
const NUMBER_RE = /\$\s?\d[\d,]*(?:\.\d+)?|\b\d[\d,]*(?:\.\d+)?\s?(?:%|k\b|x\b|hrs?\b|hours?\b|mins?\b|minutes?\b|days?\b|weeks?\b|months?\b|years?\b)?/gi;
const NUMBER_AT = new RegExp(`^(?:${NUMBER_RE.source})`, "i");
const PROPER_RE = /(?<!^)\b[A-Z][a-z]{2,}\b/g;
const PROPER_AT = /^[A-Z][a-z]{2,}\b/;
const HASHTAG_RE = /(?:^|\s)#\w+/;
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}☀-➿]/u;
const SPOKEN_NUMBERS = new Set(["zero", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "fifteen", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety", "hundred", "thousand", "million", "billion", "dozen", "half", "twice", "triple"]);
const MONEY_WORDS = new Set(["dollars", "dollar", "bucks", "grand", "percent", "cents", "millionaire", "billionaire", "revenue", "profit", "salary", "rent"]);
const STAKES = new Set(["stop", "never", "wrong", "mistake", "mistakes", "lost", "lose", "losing", "cost", "costs", "broke", "broken", "failed", "failure", "fail", "nobody", "no", "not", "don't", "dont", "doesn't", "didn't", "can't", "won't", "quit", "quitting", "fired", "deleted", "delete", "killed", "kills", "kill", "replaced", "replaces", "cut", "beat", "free", "paid", "charged", "hired", "saved", "first", "banned", "illegal", "worst", "hate", "hated", "wasted", "waste", "scam", "lie", "lied", "lying", "truth", "secret", "hidden", "stole", "stolen", "before", "until", "instead", "but", "except", "unless", "problem", "risk", "danger", "warning", "regret", "wish", "should", "shouldn't", "still", "already", "only", "without", "versus", "vs", "actually"]);
const WEAK_OPENERS = ["so", "ok", "okay", "hey", "hi", "hello", "guys", "yo", "alright", "welcome", "today", "basically", "honestly", "look", "listen", "um", "just", "let", "lets", "let's", "i wanted", "i want", "one of", "have you", "did you", "do you", "are you", "in this", "in today", "the thing", "a lot", "there is", "there are", "this is", "it is", "as a", "when it", "if you've", "you know"];
const IMPERATIVES = new Set(["stop", "steal", "copy", "delete", "try", "watch", "read", "save", "use", "build", "make", "write", "send", "take", "start", "quit", "never", "always", "don't", "dont", "do", "put", "run", "check"]);
const DEALBREAKERS = [
  [/^\s*(?:stop scrolling|don'?t scroll)/i, "Opens with \"stop scrolling\". Asking for attention proves you have not earned it."],
  [/\b(?:in (?:this|today'?s) (?:video|reel)|i'?m going to show you|i'?ll show you how)\b/i, "Video preamble. Delete it and open on the payoff."],
  [/^\s*(?:hey |hi |what'?s up |welcome )/i, "Greeting. Nobody came to the feed to be greeted."],
  [HASHTAG_RE, "Hashtag in the hook. Hashtags belong at the bottom of the caption, if anywhere."],
  [EMOJI_RE, "Emoji in the hook. On-screen text at hook size has room for words or for an emoji, not both."]
];
export const HOOK_CHECKS = Object.freeze(["LENGTH", "SPECIFICITY", "STAKES", "FRONTLOAD", "ADDRESS"]);

const words = (text) => String(text).replace(/(?<=\d),(?=\d)/g, "").match(WORD_RE) ?? [];
const lowWords = (text) => words(text).map((w) => w.toLowerCase().replace(/^['’]+|['’]+$/g, ""));

function checkLength(text) {
  const n = words(text).length, chars = String(text).trim().length;
  let score = n >= 5 && n <= 12 ? 100 : n < 5 ? clamp(100 - (5 - n) * 20) : clamp(100 - (n - 12) * 11);
  if (chars > 60) score -= 12;
  return [clamp(score), `${n} words, ${chars} chars, ~${(n / 2.75).toFixed(1)}s spoken (want 5-12 words)`];
}
function checkSpecificity(text) {
  const nums = (String(text).match(NUMBER_RE) ?? []).map((x) => x.trim()).filter(Boolean);
  const propers = [...new Set(String(text).match(PROPER_RE) ?? [])];
  const spoken = lowWords(text).filter((w) => SPOKEN_NUMBERS.has(w) || MONEY_WORDS.has(w));
  const hits = nums.length + propers.length + spoken.length;
  const found = [...nums.slice(0, 2), ...propers.sort().slice(0, 2), ...spoken.slice(0, 2)].join(", ");
  return [hits === 0 ? 15 : clamp(45 + hits * 30), `${hits} concrete marker(s)${found ? `: ${found}` : " - no number, no name, nothing checkable"}`];
}
function checkStakes(text) {
  const markers = [...new Set(lowWords(text).filter((w) => STAKES.has(w)))].sort();
  if (/\$\s?\d/.test(text)) markers.push("a price");
  const n = markers.length;
  return [n === 0 ? 20 : n === 1 ? 70 : 100, `${n} tension marker(s)${markers.length ? `: ${markers.slice(0, 4).join(", ")}` : " - nothing is at stake in this line"}`];
}
function checkFrontload(text) {
  const w = words(text);
  if (!w.length) return [0, "empty"];
  const low = w.map((x) => x.toLowerCase().replace(/^['’]+|['’]+$/g, ""));
  const opener = low.slice(0, 2).join(" ");
  const weak = WEAK_OPENERS.find((x) => opener.startsWith(x) || low[0] === x) ?? null;
  const payload = low.findIndex((t, i) => STAKES.has(t) || SPOKEN_NUMBERS.has(t) || MONEY_WORDS.has(t) || NUMBER_AT.test(w[i]) || (i > 0 && PROPER_AT.test(w[i])));
  const [base, where] = payload < 0 ? [30, "no payload word anywhere in the line"]
    : payload <= 3 ? [100, `payload at word ${payload + 1}`]
    : payload <= 6 ? [70, `payload at word ${payload + 1}, could move forward`] : [40, `payload at word ${payload + 1}, too late`];
  return [clamp(base - (weak ? 30 : 0)), where + (weak ? `; weak opener "${weak}"` : "")];
}
function checkAddress(text) {
  const low = String(text).toLowerCase(), w = lowWords(text);
  if (/\b(you|your|you're|youre|yourself)\b/.test(low)) return [100, "speaks to the viewer"];
  if (w.length && IMPERATIVES.has(w[0])) return [90, `imperative opener ("${w[0]}")`];
  if (/\b(i|my|me|we|our)\b/.test(low)) return [70, "first person, no viewer named"];
  return [35, "third person, nobody in the room"];
}

const FORMULAS = HOOKS.classify_order.map((id) => HOOKS.hooks.find((h) => h.id === id)).filter(Boolean)
  .map((h) => ({ id: h.id, name: h.name, re: jsRegex(h.match, "i") }));
/** The hooks.json formula a line follows (most specific first), or null. */
export function hookFormula(line) {
  const t = String(line ?? "");
  const f = FORMULAS.find((x) => { x.re.lastIndex = 0; return x.re.test(t); });
  return f ? { id: f.id, name: f.name } : null;
}

/** hookscore.py's run(): { checks: { NAME: { score, detail } }, score, verdict: STRONG|OK|WEAK, flags, weakest, formula }. */
export function hookScore(line) {
  const text = String(line ?? "");
  const r = { LENGTH: checkLength(text), SPECIFICITY: checkSpecificity(text), STAKES: checkStakes(text), FRONTLOAD: checkFrontload(text), ADDRESS: checkAddress(text) };
  const flags = DEALBREAKERS.filter(([re]) => re.test(text)).map(([, msg]) => msg);
  const scores = HOOK_CHECKS.map((c) => r[c][0]);
  const overall = clamp(mean(scores) * 0.6 + Math.min(...scores) * 0.4 - flags.length * 15);
  const verdict = overall >= 70 && Math.min(...scores) >= 55 && !flags.length ? "STRONG" : overall >= 50 ? "OK" : "WEAK";
  const weakest = HOOK_CHECKS.reduce((a, c) => (r[c][0] < r[a][0] ? c : a), HOOK_CHECKS[0]);
  const round = (n) => Math.round(n * 10) / 10;
  return { checks: Object.fromEntries(HOOK_CHECKS.map((c) => [c, { score: round(r[c][0]), detail: r[c][1] }])), score: round(overall), verdict, flags, weakest, formula: hookFormula(text) };
}
/** The line a feed shows first, without the "Education - " label every post opens with. */
export const openingLine = (text) => (String(text ?? "").split("\n").find((l) => l.trim()) ?? "").replace(/^Education\s*[·-]\s*/i, "").trim();
