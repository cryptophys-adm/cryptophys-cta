// The content guardian (ported from xauusd-ai-trading-assistant src/content-guardian.mjs, content roadmap P1;
// docs in that repository's docs/RFC_CONTENT_AGENT.md §0.1, §1 and §2.2; owner 2026-11-14:
// "lanjutkan semua"). Deterministic checks of a public draft (a post or a caption) before it may go out; a
// failed check never publishes. It sits beside the decision-card guard (src/decision-cards.mjs cardLeaks) and
// the room compliance checks (src/compliance.mjs); Aether may run the same rules on what it audits. Nothing
// publishes yet: there is no content agent, and the first posts will wait for the owner's click anyway.
//
// The rules (POJK 6/2026 asks a publisher to state its capacity; until a lawyer confirms what forex and gold
// content may say, the content is education and analysis, a recap after a delay, never an instruction):
//   capacity        the draft says it is education ("edukasi" / "education");
//   disclaimer      it says it is not advice or an invitation ("bukan ajakan", "not financial advice", ...);
//   promised_return no promised or guaranteed return, no "risk-free", no "x% per month";
//   instruction     no live instruction (buy or sell now, entry at, set the stop or target, ...);
//   signal_words    no trading-signal vocabulary at all (owner 2026-11-14: "Tidak boleh ada advices buy/sell,
//                   kecuali info buy/sell zone"): entry, SL, TP, stop loss, take profit, cut loss, and BUY, SELL,
//                   LONG or SHORT written as a signal; a demand or supply zone ("area beli", "area jual") is information;
//   price_level     no price level (a gold price), unless the owner allows levels as commentary later;
//   account_data    no account, balance, equity, margin, lot or position;
//   internal        never Nexus or Omega (the private dashboards);
//   secret          nothing that looks like a key, token or private key;
//   attribution     a draft with a chart image names TradingView;
//   projection_not_sane  a "Measured projection" that is not sane (`saneProjection`: 0 or below, not a number, more
//                   than PROJECTION_MAX_SHARE from the price when read, or on the wrong side of the breakout line);
//   zero_level      a published level printed as 0.00 or below (breakout line, the "fails if … closes back" level, a
//                   pattern line, a zone edge, the price when read). Owner 2026-11-27: "hapus posting di archived dengan
//                   nilai measurement 0.0 dan pastikan guardian mengecek dan reject ini sebelum approval posting.";
//   too_recent      every decision it covers is older than the public delay (0 allowed since 2026-11-25, owner
//                   "Posts juga realtime": then only a future or unreadable time fails; unset or invalid: 24).
/** A number that reads like a gold price (3 to 5 digits, or 1–2 digits, a comma and 3 digits). */
export const PRICE_LIKE = /\$?\b(?:\d{1,2},\d{3}|\d{3,5})(?:\.\d+)?\b/;

export const CONTENT_GUARDIAN_VERSION = "cryptophys.content-guardian.v1";
const MONTHS = "jan|januari|january|feb|februari|february|mar|maret|march|apr|april|mei|may|jun|juni|june|jul|juli|july|agu|agustus|aug|august|sep|sept|september|okt|oktober|oct|october|nov|november|des|desember|dec|december";
export const CONTENT_CHECKS = Object.freeze(["capacity", "disclaimer", "promised_return", "instruction", "signal_words", "price_level", "account_data", "internal", "secret", "attribution", "projection_not_sane", "zero_level", "too_recent"]);

const RULES = Object.freeze({
  capacity: /\b(edukasi|education(al)?)\b/i,
  disclaimer: /(bukan\s+(ajakan|rekomendasi|saran)|not\s+(financial|investment)\s+advice|disclaimer|tidak\s+(dimaksudkan|ditujukan)\s+sebagai\s+(ajakan|saran))/i,
  promised_return: /((pasti|dijamin|jaminan|guarantee[ds]?)\s*(profit|untung|cuan|return|hasil)|(profit|untung|cuan|return|hasil)\s+(pasti|dijamin|guaranteed)|profit\s+konsisten|consistent\s+profits?|risk[- ]?free|tanpa\s+risiko|anti\s+rugi|\b\d+(?:[.,]\d+)?\s*%\s*(per|a|tiap|setiap|sehari|sebulan|seminggu)\s*(hari|minggu|bulan|day|week|month)?)/i,
  instruction: /(\b(buy|sell|beli|jual|entry|masuk|open|long|short)\s+(now|sekarang|di\s+(harga|level)|at\s+\d|@\s*\d)|\b(pasang|set|taruh|place)\s+(sl|tp|stop|target|order|limit)|\bstop[- ]?loss\s*(di|at|@|:)\s*\d|\btake[- ]?profit\s*(di|at|@|:)\s*\d|\btarget\s*(di|at|@|:)\s*\d|\bsegera\s+(beli|jual|entry|masuk))/i,
  account_data: /\b(balance|saldo|equity|ekuitas|margin|lot|lots|lotsize|posisi\s+terbuka|open\s+positions?|akun\s+(saya|kami|trading)|my\s+account|our\s+account|floating)\b/i,
  internal: /\b(nexus|omega)\b/i,
  secret: /(sk-[A-Za-z0-9]{16,}|\bBearer\s+[A-Za-z0-9._~+/-]{16,}|-----BEGIN [A-Z ]*PRIVATE KEY|\b[A-Fa-f0-9]{40,}\b|\b[A-Za-z0-9_-]{48,}\b)/
});

/** A measured projection further than this share of the reference price (the price when read, else the breakout line) is not shown. */
export const PROJECTION_MAX_SHARE = 0.5;
/**
 * Pure: the pattern's measured projection when it is sane, else null (2026-11-27: a gap went out on Threads with
 * "Measured projection: 0.00"). Sane: a finite number above 0, within PROJECTION_MAX_SHARE of the price when read (or
 * of the breakout line), and on the breakout's side: above the upper line for direction up, below the lower for down.
 * The drafter leaves a projection that is not sane out of the text and the card; the guardian refuses a text that
 * still prints one (`projection_not_sane`).
 */
export function saneProjection(p, price = null) {
  const x = Number(p?.projection);
  if (p?.projection == null || !Number.isFinite(x) || x <= 0) return null;
  const line = Number(p?.direction === "down" ? p?.lower : p?.upper);
  const ref = Number.isFinite(Number(price)) && Number(price) > 0 ? Number(price) : line;
  if (!Number.isFinite(ref) || ref <= 0 || Math.abs(x - ref) / ref > PROJECTION_MAX_SHARE) return null;
  if (p?.direction === "up" && Number.isFinite(Number(p?.upper)) && !(x > Number(p.upper))) return null;
  if (p?.direction === "down" && Number.isFinite(Number(p?.lower)) && !(x < Number(p.lower))) return null;
  return x;
}

/** A printed number, as the drafts print levels (3632.40, 3,632.40, -5.00), or a word a broken number prints as. */
const NUM = String.raw`(-?\d[\d,]*(?:\.\d+)?|-?\.\d+|NaN|-?Infinity|undefined|null)`;
const numOf = (s) => (/^-?[\d,]*\.?\d+$/.test(String(s)) ? Number(String(s).replace(/,/g, "")) : NaN);
const LEVELS = [
  ["breakout line", new RegExp(String.raw`breakout\s+line:?\s+${NUM}`, "gi")],
  ["the fail level", new RegExp(String.raw`closes?\s+back\s+(?:above|below)\s+${NUM}`, "gi")],
  ["price when read", new RegExp(String.raw`price\s+when\s+read:?\s+${NUM}`, "gi")],
  ["a pattern line", new RegExp(String.raw`(?:upper|lower)\s+line:?\s+${NUM}`, "gi")],
  // a zone's edges, "3706.50-3710.64" as published (the humanizer prints the dash as "-") or "3706.50–3710.64"
  ["a zone edge", new RegExp(String.raw`(?<![\w.])${NUM}\s*[–—-]\s*${NUM}`, "gi")],
  // any other 0.00 or negative level (never a percentage)
  ["a level", /(?<![\w.,-])(-\d[\d,]*\.\d{2}|0\.00)(?![\d%])/g]
];
/** Pure: the guardian's level checks of a public text (`projection_not_sane`, `zero_level`), as failures. */
export function levelFailures(text) {
  const t = String(text ?? ""), out = [];
  const seen = new Set();
  for (const [what, re] of LEVELS) {
    for (const m of t.matchAll(re)) {
      for (const raw of m.slice(1).filter((x) => x !== undefined)) {
        const v = numOf(raw);
        if (Number.isFinite(v) && v > 0) continue;
        const detail = `${what} ${raw}`;
        if (!seen.has(detail)) { seen.add(detail); out.push({ check: "zero_level", detail }); }
      }
    }
  }
  const proj = /measured\s+projection:?\s+(\S+?)(?=[\s(]|\.?$|\.\s)/im.exec(t);
  if (proj) {
    const x = numOf(proj[1].replace(/\.$/, ""));
    const dir = /\bdirection\s+(up|down)\b/i.exec(t)?.[1]?.toLowerCase() ?? null;
    const lineM = /breakout\s+line:?\s+(-?[\d,]*\.?\d+)/i.exec(t);
    const line = lineM ? numOf(lineM[1]) : NaN;
    const priceM = /price\s+when\s+read:?\s+(-?[\d,]*\.?\d+)/i.exec(t);
    const price = priceM ? numOf(priceM[1]) : null;
    const p = { projection: Number.isFinite(x) ? x : NaN, direction: dir, upper: dir === "up" ? line : NaN, lower: dir === "down" ? line : NaN };
    // Without a price when read or a breakout line in the text there is nothing to measure against: then only a
    // projection of 0 or below, or one that is not a number, is refused.
    const known = Number.isFinite(line) || (Number.isFinite(price) && price > 0);
    const sane = known ? saneProjection(p, Number.isFinite(price) ? price : null) != null : Number.isFinite(x) && x > 0;
    if (!sane) out.push({ check: "projection_not_sane", detail: `measured projection ${proj[1].replace(/\.$/, "")}` });
  }
  return out;
}

/**
 * Checks one draft. `chart` is true when it carries a chart image; `decisionTimes` are the bar closes of the
 * decisions it covers; `delayHours` is the public delay; `allowLevels` lets price levels through as commentary
 * (off until the owner decides). Returns { pass, failures: [{ check, detail }] }. Pure; never throws.
 */
export function checkContentDraft({ text = "", chart = false, decisionTimes = [], delayHours = 24, allowLevels = false, now = Date.now() } = {}) {
  const t = String(text ?? "");
  const failures = [];
  const fail = (check, detail) => failures.push({ check, detail });
  if (!t.trim()) fail("capacity", "empty draft");
  else {
    if (!RULES.capacity.test(t)) fail("capacity", "say it is education (edukasi)");
    if (!RULES.disclaimer.test(t)) fail("disclaimer", "say it is not advice or an invitation to trade");
  }
  const found = (k) => t.match(RULES[k])?.[0];
  if (found("promised_return")) fail("promised_return", found("promised_return"));
  if (found("instruction")) fail("instruction", found("instruction"));
  const signal = t.match(/\b(entry|entries|sl|tp\d?|stop[- ]?loss|take[- ]?profit|cut[- ]?loss)\b/i)?.[0] ?? t.match(/\b(BUY|SELL|LONG|SHORT)\b/)?.[0];
  if (signal) fail("signal_words", signal);
  // Dates are not levels: an ISO date, a time, and a year after a month name are left out of the price check.
  const undated = t.replace(/\b\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?\b/g, " ").replace(/\b\d{1,2}[:.]\d{2}\b/g, " ")
    .replace(new RegExp(`\\b(${MONTHS})\\.?\\s+(\\d{1,2},?\\s+)?(19|20)\\d{2}\\b`, "gi"), " ");
  if (!allowLevels && undated.match(PRICE_LIKE)) fail("price_level", undated.match(PRICE_LIKE)[0]);
  if (found("account_data")) fail("account_data", found("account_data"));
  if (found("internal")) fail("internal", found("internal"));
  if (found("secret")) fail("secret", "a key- or token-like string");
  if (chart && !/tradingview/i.test(t)) fail("attribution", "a chart image needs TradingView's attribution");
  for (const f of levelFailures(t)) fail(f.check, f.detail);
  const hours = delayHours === null || delayHours === undefined || String(delayHours).trim() === "" ? NaN : Number(delayHours);
  const delay = Number.isFinite(hours) && hours >= 0 ? hours : 24;
  const cutoff = now - delay * 3_600_000;
  const recent = (Array.isArray(decisionTimes) ? decisionTimes : []).filter((x) => { const ms = Date.parse(x); return !Number.isFinite(ms) || ms > cutoff; });
  if (recent.length) fail("too_recent", `${recent.length} decision(s) newer than the ${delay}-hour delay`);
  return { version: CONTENT_GUARDIAN_VERSION, pass: failures.length === 0, failures };
}
