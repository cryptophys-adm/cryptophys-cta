// Marketing tools of the studio (owner 2026-11-16: "kerjakan tambahan pro marketing juga"). Pure: the rules.
//
//   Tracked links   a short link per channel, https://cta.cryptophys.work/go/<slug>/<channel>, that counts the click
//                   (per link, channel and WIB day; no IP, no cookie, nothing about the person) and redirects to the
//                   target with UTM tags (utm_source=<channel>, utm_medium=social, utm_campaign=<campaign>). Only our
//                   own hosts and the brand's profile hosts are targets: the short link is never an open redirect.
//   Hashtag sets    named lines of hashtags (the same rule as a channel's hashtags) a person puts into a post.
//   Content mix     the target share of each kind of post per week (content pillars), against what was approved or
//                   published in the current WIB week.
import { CHANNELS } from "./channels.mjs";
import { brandOf, profileLinks, DEFAULT_BRAND } from "./brands.mjs";
import { KINDS } from "./settings.mjs";

/** A slug is 8 letters: no digits, so a link never reads as a price to the guardian. */
export const SLUG = /^[a-z]{8}$/;
export function randomSlug(random = (n) => crypto.getRandomValues(new Uint8Array(n))) {
  return [...random(8)].map((b) => String.fromCharCode(97 + (b % 26))).join("");
}
const CAMPAIGN = /^[a-z0-9][a-z0-9_-]{0,39}$/;
export const DEFAULT_LINK_HOSTS = Object.freeze(["cta.cryptophys.work"]);

/** The hosts a tracked link may point to: LINK_HOSTS (default our own site) and the brand's profile hosts. */
export function linkHosts(env) {
  const own = String(env?.LINK_HOSTS ?? DEFAULT_LINK_HOSTS.join(",")).split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
  const profiles = profileLinks(brandOf(DEFAULT_BRAND)).map((l) => new URL(l.url).hostname);
  return [...new Set([...own, ...profiles])];
}

/** Validates a new link: { target, campaign, label }. Returns { ok, link } or { ok: false, error }. */
export function normalizeLink(input, { hosts }) {
  if (!input || typeof input !== "object") return { ok: false, error: "link must be an object" };
  let url;
  try { url = new URL(String(input.target ?? "")); } catch { return { ok: false, error: "target must be a full https URL" }; }
  if (url.protocol !== "https:") return { ok: false, error: "target must be https" };
  if (url.username || url.password) return { ok: false, error: "target must not carry credentials" };
  if (!hosts.includes(url.hostname.toLowerCase())) return { ok: false, error: `target host must be one of ${hosts.join(", ")}` };
  for (const k of [...url.searchParams.keys()]) if (k.startsWith("utm_")) url.searchParams.delete(k);
  const campaign = String(input.campaign ?? "").trim().toLowerCase();
  if (!CAMPAIGN.test(campaign)) return { ok: false, error: "campaign: 1 to 40 of a-z, 0-9, - and _" };
  const label = String(input.label ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 80);
  return { ok: true, link: { target: url.toString(), campaign, label: label || campaign } };
}

/** The short link a post carries on one channel. */
export const shortUrl = (origin, slug, channel) => `${origin}/go/${slug}/${channel}`;

/** Where a click goes: the target with the UTM tags of the channel and campaign. */
export function redirectTarget(link, channel) {
  const url = new URL(link.target);
  url.searchParams.set("utm_source", channel);
  url.searchParams.set("utm_medium", "social");
  url.searchParams.set("utm_campaign", link.campaign);
  return url.toString();
}
/** The public short-link path: /go/<slug>/<channel>. */
export const GO_PATH = new RegExp(`^/go/([a-z]{8})/(${CHANNELS.join("|")})$`);

// ---- hashtag sets ----
const TAG = /^#[A-Za-z0-9_]{1,40}$/;
const SET_NAME = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,39}$/;
export const MAX_SETS = 30;
export function normalizeHashtagSet(input) {
  const name = String(input?.name ?? "").trim();
  if (!SET_NAME.test(name)) return { ok: false, error: "name: 1 to 40 letters, digits, spaces, - and _" };
  const tags = String(input?.tags ?? "").trim().split(/\s+/).filter(Boolean);
  if (!tags.length || tags.length > 8 || tags.some((t) => !TAG.test(t))) return { ok: false, error: "tags: 1 to 8 words that start with # (letters, digits, _)" };
  if (tags.some((t) => /nexus|omega/i.test(t))) return { ok: false, error: "tags: internal names are never public" };
  return { ok: true, set: { name, tags: [...new Set(tags)].join(" ") } };
}

/** A text with its hashtag line (the last line, when it holds only hashtags) replaced, or the line added. */
export function withHashtagLine(text, tags) {
  const lines = String(text ?? "").replace(/\s+$/, "").split("\n");
  if (lines.length && /^(#\w+\s*)+$/.test(lines.at(-1).trim())) lines[lines.length - 1] = tags;
  else lines.push(tags);
  return lines.join("\n");
}

// ---- content mix (pillars) ----
export const MIX_KINDS = Object.freeze([...KINDS, "custom"]);
export const DEFAULT_MIX = Object.freeze({ key_levels: 25, pattern: 40, daily_recap: 25, custom: 10 });
/** Validates the weekly targets: whole percents per kind that add up to 100. */
export function normalizeMix(input) {
  if (!input || typeof input !== "object") return { ok: false, error: "targets must be an object" };
  const out = {};
  for (const k of MIX_KINDS) {
    const n = Number(input[k] ?? 0);
    if (!Number.isInteger(n) || n < 0 || n > 100) return { ok: false, error: `${k} must be a whole percent 0 to 100` };
    out[k] = n;
  }
  const sum = Object.values(out).reduce((a, b) => a + b, 0);
  if (sum !== 100) return { ok: false, error: `the targets add up to ${sum}%, not 100%` };
  return { ok: true, mix: out };
}
/** The WIB week (Monday 00:00 WIB) that holds `now`, as ISO times [from, to). */
export function wibWeek(now = Date.now()) {
  const off = 7 * 3_600_000;
  const wib = new Date(now + off);
  const dow = (wib.getUTCDay() + 6) % 7;
  const monday = Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth(), wib.getUTCDate() - dow) - off;
  return { from: new Date(monday).toISOString(), to: new Date(monday + 7 * 86_400_000).toISOString() };
}
/** Target vs actual per kind: counts are the week's approved and published posts (every channel). */
export function mixReport(targets, counts) {
  const total = MIX_KINDS.reduce((n, k) => n + (Number(counts?.[k]) || 0), 0);
  return {
    total,
    kinds: MIX_KINDS.map((k) => {
      const n = Number(counts?.[k]) || 0;
      const actual = total ? Math.round((n / total) * 100) : 0;
      return { kind: k, target: targets[k] ?? 0, actual, posts: n, gap: actual - (targets[k] ?? 0) };
    })
  };
}
