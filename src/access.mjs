// Cloudflare Access JWT verification (ported from xauusd-ai-trading-assistant workers/xauusd-omega/src/omega.mjs):
// the studio and its API are behind Access, and this Worker verifies the JWT itself (fail closed): signature
// against the team's keys, audience when ACCESS_AUD is set, issuer, expiry. A person has an email; a service
// token has a common name.

export const CLOCK_SKEW_SECONDS = 60;
const JWKS_TTL_MS = 10 * 60 * 1000;
const TEAM_DOMAIN = /^[a-z0-9-]+\.cloudflareaccess\.com$/;

let jwksCache = null;
export function resetKeyCacheForTests() { jwksCache = null; }

function b64urlBytes(input) {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(input.length / 4) * 4, "=");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function b64urlJson(input) {
  try { return JSON.parse(new TextDecoder().decode(b64urlBytes(input))); } catch { return null; }
}

async function signingKeys(domain, forceRefresh, fetchImpl) {
  if (!forceRefresh && jwksCache && jwksCache.domain === domain && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS) return jwksCache.keys;
  const res = await fetchImpl(`https://${domain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`access certs HTTP ${res.status}`);
  const body = await res.json();
  const keys = (body.keys ?? []).filter((k) => k.kty === "RSA");
  jwksCache = { domain, keys, fetchedAt: Date.now() };
  return keys;
}

/** Verifies a Cloudflare Access JWT. Never throws. */
export async function verifyAccessJwt(token, env, { now = Math.floor(Date.now() / 1000), fetchImpl = fetch } = {}) {
  const domain = env.ACCESS_TEAM_DOMAIN;
  if (!domain || !TEAM_DOMAIN.test(domain)) return { ok: false, reason: "access_not_configured" };
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed_token" };
  const header = b64urlJson(parts[0]), claims = b64urlJson(parts[1]);
  if (!header || !claims) return { ok: false, reason: "malformed_token" };
  if (header.alg !== "RS256" || typeof header.kid !== "string") return { ok: false, reason: "unsupported_algorithm" };
  let keys;
  try {
    keys = await signingKeys(domain, false, fetchImpl);
    if (!keys.some((k) => k.kid === header.kid)) keys = await signingKeys(domain, true, fetchImpl);
  } catch { return { ok: false, reason: "signing_keys_unavailable" }; }
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) return { ok: false, reason: "unknown_signing_key" };
  try {
    const key = await crypto.subtle.importKey("jwk", { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    if (!valid) return { ok: false, reason: "invalid_signature" };
  } catch { return { ok: false, reason: "invalid_signature" }; }
  if (env.ACCESS_AUD) {
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!aud.includes(env.ACCESS_AUD)) return { ok: false, reason: "wrong_audience" };
  }
  if (claims.iss !== `https://${domain}`) return { ok: false, reason: "wrong_issuer" };
  if (typeof claims.exp !== "number" || claims.exp + CLOCK_SKEW_SECONDS < now) return { ok: false, reason: "expired" };
  if (typeof claims.nbf === "number" && claims.nbf - CLOCK_SKEW_SECONDS > now) return { ok: false, reason: "not_yet_valid" };
  if (typeof claims.email === "string" && claims.email) return { ok: true, identity: { subject: claims.email.toLowerCase(), type: "user" } };
  if (typeof claims.common_name === "string" && claims.common_name) return { ok: true, identity: { subject: claims.common_name, type: "service_token" } };
  return { ok: false, reason: "no_identity" };
}

