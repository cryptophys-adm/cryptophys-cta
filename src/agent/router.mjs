// The CTA agent's model router (owner 2026-11-25: "agent cta pakai router", the model Beam on platform.reflection.ai;
// "setuju semua"). One OpenAI-compatible Chat Completions endpoint, so the model is a setting, not code:
// MODEL_BASE_URL (default Reflection's https://api.reflection.ai/openai/v1) and MODEL_ID (default
// Beam-1.0-501B-A23B), with the key in the Worker secret REFLECTION_API_KEY that the owner sets through the platform.
//
// What it guards (the design note "CTA agent, phase 1: Threads"):
//   - the studio's switch (studio setting `agent_model`, { enabled }): off until an approver turns it on, then no call
//     whenever it is off;
//   - a daily cap in dollars (MODEL_DAILY_USD, default 1) over the WIB day, from each call's tokens at the listed
//     prices (MODEL_PRICE_IN, MODEL_PRICE_OUT per million tokens; the defaults are the highest third-party listings);
//   - Reflection's own answers: a 429 or 403 stops the call (Reflection's prepaid credit is the second cap);
//   - data retention: Reflection states it on every answer (`reflection-data-retention`); "contributor" (the request
//     may train its models) turns the model off in the studio and the answer is thrown away;
//   - reasoning effort "low" by default (Beam always reasons; its reasoning tokens bill as output);
//   - free only (owner 2026-11-25: "tetap siapkan callback jika beam tidak bisa dijangkau atau menjadi berbayar atau
//     lebih dari batasan"; Reflection's free Beta: 10M input and 1M output tokens a day, 60 a minute, shared by the
//     organisation): MODEL_FREE_ONLY "on" by default; a 402, a billing or credit error, or an answer that reports a cost
//     above 0 turns the model off in the studio with the reason and logs `cta_model_off` once; CTA's own daily token
//     caps (MODEL_DAILY_TOKENS_IN, MODEL_DAILY_TOKENS_OUT; CTA's share until the organisation's split is set) and a
//     per-minute guard (MODEL_RPM, default 20; CTA's share of the free Beta, orchestrator 2026-11-25: 1M input, 200k output, 20 a minute, about ten times CTA's estimated use) skip the call. Every skip leaves the caller's fallback: the template, or
//     no reply.
// Every call is logged (tokens, cost, status, retention), never its prompt or answer. Text it writes is shown only in
// the studio until the owner's Replies PR says otherwise; it never states a price or a level it was not given.
/** The router's Worker secret, set by the owner through the platform (organism.json `deploy.secrets_kept`). */
export const AGENT_SECRETS = Object.freeze(["REFLECTION_API_KEY"]);
export const MODEL_DEFAULTS = Object.freeze({ base: "https://api.reflection.ai/openai/v1", model: "Beam-1.0-501B-A23B", daily_usd: 1, price_in: 0.4, price_out: 1.2,
  free_only: true, tokens_in_day: 1_000_000, tokens_out_day: 200_000, rpm: 20 });
/** The skips that end a run quietly: the caller falls back (the template, or no reply) and tries again later. */
export const MODEL_STOPS = Object.freeze(["off", "no_key", "budget", "retention", "tokens", "rpm", "paid", "rate"]);
const BILLING = /billing|credit|payment|insufficient[_ ]?(funds|balance)|prepaid|paid[_ ]?plan|upgrade|subscription/i;
/** A 429's wait when it names no daily limit and gives no Retry-After. */
export const RATE_BACKOFF_MS = 60_000;
/** The studio setting that holds a 429's wait: { until, reason }. The model stays on. */
export const RATE_KEY = "agent_model_rate";
const DAILY = /\b(day|daily|per[ _-]?day|24[ _-]?h(ours?)?)\b/i;
/**
 * Pure: until when the router waits after a 429 (orchestrator 2026-11-26: a 429 is always a rate stop, never paid,
 * whatever its text says). A daily limit waits until 00:00 UTC; otherwise Retry-After (seconds or an HTTP date),
 * else RATE_BACKOFF_MS.
 */
export function rateUntil(said, retryAfter, now = Date.now()) {
  if (DAILY.test(String(said ?? ""))) return Math.floor(now / DAY) * DAY + DAY;
  const ra = String(retryAfter ?? "").trim();
  if (/^\d+$/.test(ra)) return now + Math.min(Number(ra), 86_400) * 1000;
  const at = Date.parse(ra);
  if (ra && Number.isFinite(at) && at > now) return Math.min(at, now + DAY);
  return now + RATE_BACKOFF_MS;
}
const WIB = 7 * 3_600_000;
const DAY = 86_400_000;
const pos = (v, d) => (Number.isFinite(Number(v)) && Number(v) >= 0 && String(v).trim() !== "" ? Number(v) : d);

/** The router's settings from the Worker's vars and secret (the key itself never leaves this function's caller). */
export function modelConfig(env = {}) {
  const base = String(env.MODEL_BASE_URL || MODEL_DEFAULTS.base).replace(/\/+$/, "");
  return {
    base: /^https:\/\//.test(base) ? base : MODEL_DEFAULTS.base,
    model: String(env.MODEL_ID || MODEL_DEFAULTS.model).slice(0, 120),
    daily_usd: pos(env.MODEL_DAILY_USD, MODEL_DEFAULTS.daily_usd),
    price_in: pos(env.MODEL_PRICE_IN, MODEL_DEFAULTS.price_in),
    price_out: pos(env.MODEL_PRICE_OUT, MODEL_DEFAULTS.price_out),
    free_only: String(env.MODEL_FREE_ONLY ?? "on").trim().toLowerCase() !== "off",
    tokens_in_day: pos(env.MODEL_DAILY_TOKENS_IN, MODEL_DEFAULTS.tokens_in_day),
    tokens_out_day: pos(env.MODEL_DAILY_TOKENS_OUT, MODEL_DEFAULTS.tokens_out_day),
    rpm: pos(env.MODEL_RPM, MODEL_DEFAULTS.rpm),
    has_key: Boolean(String(env.REFLECTION_API_KEY ?? "").trim())
  };
}
/** The start of the WIB day holding `t`, as an ISO time. */
export const wibDayStartIso = (t) => new Date(Math.floor((t + WIB) / DAY) * DAY - WIB).toISOString();
/** A call's cost in dollars from its tokens. */
export const costOf = (cfg, tokensIn, tokensOut) => Math.round(((tokensIn * cfg.price_in + tokensOut * cfg.price_out) / 1e6) * 1e6) / 1e6;

/**
 * One chat completion through the router. `store` holds the switch and the log: { setting(key), saveSetting(input),
 * record(call), spendSince(iso) }. Returns { ok: true, text, usage, cost_usd, retention } or { ok: false, skipped | error }.
 */
export async function askModel(env, store, { purpose, messages, maxTokens = 2000, effort = "low", fetcher = (...a) => fetch(...a), now = Date.now(), timeoutMs = 30_000 }) {
  const cfg = modelConfig(env);
  if (!cfg.has_key) return { ok: false, skipped: "no_key" };
  const sw = await store.setting("agent_model").catch(() => null);
  // Off until an approver turns it on in the studio (orchestrator review, 2026-11-25: the router off by default).
  if (sw?.value?.enabled !== true) return { ok: false, skipped: "off", reason: sw?.value?.reason ?? "not turned on yet" };
  const spent = await store.spendSince(wibDayStartIso(now));
  if (spent.cost_usd >= cfg.daily_usd) return { ok: false, skipped: "budget", spent_usd: spent.cost_usd, cap_usd: cfg.daily_usd };
  if (spent.tokens_in >= cfg.tokens_in_day || spent.tokens_out >= cfg.tokens_out_day) return { ok: false, skipped: "tokens", tokens_in: spent.tokens_in, tokens_out: spent.tokens_out };
  const minute = await store.spendSince(new Date(now - 60_000).toISOString());
  if (minute.calls >= cfg.rpm) return { ok: false, skipped: "rpm", calls_last_minute: minute.calls };
  const wait = await store.setting(RATE_KEY).catch(() => null);
  const waitUntil = Date.parse(wait?.value?.until);
  if (Number.isFinite(waitUntil) && now < waitUntil) return { ok: false, skipped: "rate", until: wait.value.until };
  const log = (c) => store.record({ purpose, model: cfg.model, ...c }).catch(() => false);
  // Free only: the model goes off with the reason (the studio shows it) and one log line; callers fall back.
  const turnOff = async (reason) => {
    await store.saveSetting({ key: "agent_model", value: { enabled: false, reason }, actor: "cta-agent" }).catch(() => null);
    console.log("cta_model_off", JSON.stringify({ purpose, reason }));
  };
  let res;
  try {
    res = await fetcher(`${cfg.base}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${env.REFLECTION_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ model: cfg.model, messages, max_completion_tokens: maxTokens, reasoning_effort: effort }),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (e) {
    await log({ status: "network_error", detail: String(e?.name ?? "error") });
    return { ok: false, error: "the model did not answer" };
  }
  const retention = String(res.headers.get("reflection-data-retention") ?? "").toLowerCase() || null;
  const body = await res.json().catch(() => null);
  const usage = { tokens_in: Number(body?.usage?.prompt_tokens) || 0, tokens_out: Number(body?.usage?.completion_tokens) || 0 };
  const cost_usd = costOf(cfg, usage.tokens_in, usage.tokens_out);
  if (retention === "contributor") {
    await log({ status: "refused_retention", retention, ...usage, cost_usd });
    await store.saveSetting({ key: "agent_model", value: { enabled: false, reason: "Reflection answered under contributor terms (it may train on our data): the model is off until an approver turns it on" }, actor: "cta-agent" }).catch(() => null);
    return { ok: false, skipped: "retention" };
  }
  const billed = Number(body?.usage?.cost ?? body?.usage?.total_cost ?? body?.cost ?? 0);
  const said = `${body?.error?.code ?? ""} ${body?.error?.type ?? ""} ${body?.error?.message ?? ""}`;
  // A 429 is a rate stop, never paid, whatever its text says (Reflection's daily free-quota 429 reads "... upgrade your
  // plan for higher limits"): the router waits for the reset and the model stays on; posts keep their templates.
  if (res.status === 429) {
    const until = new Date(rateUntil(said, res.headers.get("retry-after"), now)).toISOString();
    await log({ status: "http_429", retention, ...usage, cost_usd, detail: "rate" });
    await store.saveSetting({ key: RATE_KEY, value: { until, reason: String(body?.error?.code ?? body?.error?.type ?? "rate_limited").slice(0, 60) }, actor: "cta-agent" }).catch(() => null);
    console.log("cta_model_rate", JSON.stringify({ purpose, until }));
    return { ok: false, skipped: "rate", until };
  }
  // Paid: a 402, a cost above 0 on a 2xx, or billing words on another 4xx (never on a 5xx).
  const billingRefusal = res.status >= 400 && res.status < 500 && BILLING.test(said);
  if (cfg.free_only && (res.status === 402 || billingRefusal || (res.ok && Number.isFinite(billed) && billed > 0))) {
    await log({ status: res.status === 402 ? "http_402" : billed > 0 ? "billed" : `http_${res.status}`, retention, ...usage, cost_usd, detail: "paid" });
    await turnOff(`Reflection asked for payment or reported a cost (${res.status === 402 ? "402" : billed > 0 ? `cost ${billed}` : String(body?.error?.code ?? res.status).slice(0, 40)}): the model is off until an approver turns it on; posts keep their templates`);
    return { ok: false, skipped: "paid" };
  }
  if (!res.ok) {
    const code = String(body?.error?.code ?? res.status).slice(0, 60);
    await log({ status: `http_${res.status}`, retention, ...usage, cost_usd, detail: code });
    return { ok: false, error: `the model refused: ${code}`, status: res.status };
  }
  const text = String(body?.choices?.[0]?.message?.content ?? "").trim();
  await log({ status: text ? "ok" : "empty", retention, ...usage, cost_usd });
  return text ? { ok: true, text, usage, cost_usd, retention } : { ok: false, error: "the model returned no text" };
}

/** The router's state for the studio: the switch, today's spend against the cap, the latest calls. */
export async function modelStatus(env, store, { now = Date.now() } = {}) {
  const cfg = modelConfig(env);
  const sw = await store.setting("agent_model").catch(() => null);
  return {
    model: cfg.model, host: new URL(cfg.base).host, has_key: cfg.has_key, enabled: sw?.value?.enabled === true, reason: sw?.value?.reason ?? (sw ? null : "not turned on yet"),
    switched_by: sw?.updated_by ?? null, switched_at: sw?.updated_at ?? null,
    cap_usd: cfg.daily_usd, free_only: cfg.free_only, caps: { tokens_in: cfg.tokens_in_day, tokens_out: cfg.tokens_out_day, rpm: cfg.rpm },
    today: await store.spendSince(wibDayStartIso(now)), recent: await store.recent(10)
  };
}
