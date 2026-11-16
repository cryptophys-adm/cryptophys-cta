// cryptophys-cta: the content engine and CTA app at cta.cryptophys.work (owner 2026-11-14: "Buatkan aplikasi
// cta.cryptophys.work sesuai standar profesional expert digital marketing & content creator yang terhubung kernel,
// sebagai services/engine terpisah dari xauusd-ai-trading-assistant"; 2026-11-15: "pindah content queue ke cta,
// nexus hanya khusus war room").
//
// Two faces on one host:
//   - the public CTA page ("/", "/api/public/*"): the brand's profile, links to its channels, the disclaimer and
//     the archive of what was published. No draft, no queue, no account data;
//   - the studio ("/studio", "/api/studio/*"): the content queue, a person's approval or rejection, a dry run,
//     the channels' status. Behind Cloudflare Access, and this Worker verifies the Access JWT itself (fail
//     closed): without a valid JWT the studio answers 403.
// The engine: drafts from the xauusd AI Worker's PublicProjection only (recaps after 24 hours, real-time analysis
// with key levels and patterns, never a decision, plan or account), in fixed Indonesian templates, each checked
// by the guardian; every draft waits for a person; publishing only while CONTENT_PUBLISH is "on".
// Kernel: the OrganismDna and CtaHealth entrypoints serve the platform's census and drift checks.
import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";
import puppeteer from "@cloudflare/puppeteer";
import { addDrafts, listDrafts, getDraft, draftEvents, decideDraft, recordPublish, deskCounts, storedToken, storeToken, draftIdsWithPrefix, kindCountsSince, publishedPosts, draftsNeedingImage, attachImage, mediaOf, noteDraft, publishedSince, saveMetrics, storedSettings, saveChannelSettings, channelCountsSince } from "./desk.mjs";
import { handle, desk, publishOn, draftDay, draftAnalysis, refreshTokens, renderImages, collectInsights, ANALYSIS_CRON } from "./app.mjs";
import ORGANISM from "../organism.json" with { type: "json" };

/** The queue: one Durable Object (SQLite storage), named "desk". */
export class ContentDesk extends DurableObject {
  get sql() { return this.ctx.storage.sql; }
  async add(drafts, now, actor) { return addDrafts(this.sql, drafts, { now, ...(actor ? { actor } : {}) }); }
  async list(input) { return listDrafts(this.sql, input ?? {}); }
  async get(id) { const d = getDraft(this.sql, id); return d ? { ...d, events: draftEvents(this.sql, id) } : null; }
  async decide(input, now) { return decideDraft(this.sql, input, { now }); }
  async published(input, now) { return recordPublish(this.sql, input, { now }); }
  async counts() { return deskCounts(this.sql); }
  async token(channel) { return storedToken(this.sql, channel); }
  async saveToken(channel, token, now) { storeToken(this.sql, channel, token, { now }); return true; }
  async idsWithPrefix(prefix) { return draftIdsWithPrefix(this.sql, prefix); }
  async kindCounts(kind, sinceIso) { return kindCountsSince(this.sql, kind, sinceIso); }
  async archive(limit) { return publishedPosts(this.sql, { limit }); }
  async needingImage(limit, retry) { return draftsNeedingImage(this.sql, { limit, retry }); }
  async attachImage(input, now) { return attachImage(this.sql, input, { now }); }
  async media(id) { return mediaOf(this.sql, id); }
  async note(input, now) { return noteDraft(this.sql, input, { now }); }
  async publishedSince(sinceIso, limit) { return publishedSince(this.sql, sinceIso, { limit }); }
  async saveMetrics(input, now) { return saveMetrics(this.sql, input, { now }); }
  async settings() { return storedSettings(this.sql); }
  async saveSettings(input, now) { return saveChannelSettings(this.sql, input, { now }); }
  async channelCounts(sinceIso) { return channelCountsSince(this.sql, sinceIso); }
}
/** The platform's census: this organ's DNA (agents, AI tasks), read through the Forge (EXT_ORGANISM_CTA). */
export class OrganismDna extends WorkerEntrypoint {
  async dna() { return JSON.parse(JSON.stringify(ORGANISM)); }
}
/** The platform's drift check (EXT_CRYPTOPHYS_CTA). */
export class CtaHealth extends WorkerEntrypoint {
  async health() {
    try { return { ok: true, service: "cryptophys-cta", publish: publishOn(this.env) ? "on" : "off", counts: await desk(this.env).counts() }; }
    catch (e) { return { ok: false, service: "cryptophys-cta", error: String(e?.message ?? e).slice(0, 200) }; }
  }
}

/** Browser Run (BROWSER): one browser per render run, for the Instagram cards (src/render.mjs). */
const launcher = (env) => (env.BROWSER ? () => puppeteer.launch(env.BROWSER) : null);

export default {
  fetch(request, env) { return handle(request, env, { launch: launcher(env) }); },
  async scheduled(event, env) {
    const fail = (e) => ({ status: "error", message: String(e?.message ?? e).slice(0, 200) });
    if (event?.cron === ANALYSIS_CRON) {
      const drafted = await draftAnalysis(env, { now: event.scheduledTime || Date.now() }).catch(fail);
      if (drafted?.added?.length || drafted?.status === "error") console.log("cta_analysis_drafts", JSON.stringify(drafted));
      await cards(env, fail);
      return;
    }
    console.log("cta_recap_drafts", JSON.stringify(await draftDay(env).catch(fail)));
    await cards(env, fail);
    const tokens = await refreshTokens(env).catch(fail);
    if (tokens?.status !== "publishing_off") console.log("cta_tokens", JSON.stringify(tokens));
    // Once a day: the metrics of the last two weeks' posts (only while publishing is on: before, there are none).
    if (publishOn(env)) console.log("cta_insights", JSON.stringify(await collectInsights(env).catch(fail)));
  }
};

/** The cards of the drafts waiting for one, right after drafting (the chart is read close to the analysis). */
async function cards(env, fail) {
  const r = await renderImages(env, { launch: launcher(env) }).catch(fail);
  if (r?.waiting || r?.status === "error") console.log("cta_cards", JSON.stringify(r));
}
