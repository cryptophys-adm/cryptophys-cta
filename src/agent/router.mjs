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
//   - reasoning effort "low" by default (Beam always reasons; its reasoning tokens bill as output).
// Every call is logged (tokens, cost, status, retention), never its prompt or answer. Text it writes is shown only in
// the studio until the owner's Replies PR says otherwise; it never states a price or a level it was not given.
/** The router's Worker secret, set by the owner through the platform (organism.json `deploy.secrets_kept`). */
export const AGENT_SECRETS = Object.freeze(["REFLECTION_API_KEY"]);
export const MODEL_DEFAULTS = Object.freeze({ base: "https://api.reflection.ai/openai/v1", model: "Beam-1.0-501B-A23B", daily_usd: 1, price_in: 0.4, price_out: 1.2 });
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
  const log = (c) => store.record({ purpose, model: cfg.model, ...c }).catch(() => false);
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
    cap_usd: cfg.daily_usd, today: await store.spendSince(wibDayStartIso(now)), recent: await store.recent(10)
  };
}
