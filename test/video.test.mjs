// The YouTube Shorts / TikTok video (src/video.mjs, src/webm.mjs, src/render.mjs renderVideo) and its publishers
// (src/publishers.mjs publishYouTube, publishTikTok), with fakes for the browser and the platforms.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { setWebmDuration, webmDuration } from "../src/webm.mjs";
import { videoScript, videoHtml, VIDEO_SECONDS } from "../src/video.mjs";
import { renderVideo, MIN_CARD_BYTES, MIN_VIDEO_BYTES, toBase64 } from "../src/render.mjs";
import { publishYouTube, publishTikTok, publishTo, GOOGLE_TOKEN_URL, YOUTUBE_UPLOAD_URL, TIKTOK_BASE, TIKTOK_SINGLE_CHUNK_MAX } from "../src/publishers.mjs";
import { addDrafts, getDraft, attachImage, mediaOf, decideDraft, storeToken, storedToken, draftsNeedingImage, MEDIA_CHUNK } from "../src/desk.mjs";
import { analysisDrafts, ANALYSIS_DISCLAIMER } from "../src/analysis-drafts.mjs";
import { dailyDrafts } from "../src/drafts.mjs";
import { BRANDS } from "../src/brands.mjs";
import { accountOf } from "../src/app.mjs";

const brand = BRANDS["xauusd-ai-cta"];
const sqlite = () => {
  const db = new DatabaseSync(":memory:");
  return { exec(q, ...b) { const s = db.prepare(q); const out = /^\s*SELECT/i.test(q) ? s.all(...b) : (s.run(...b), []); return { toArray: () => out.map((r) => ({ ...r })) }; } };
};

/** A WebM as a browser's MediaRecorder writes it: EBML header, a Segment of unknown size, Info, Tracks, a Cluster. */
function recorderWebm(payload = 300_000) {
  const el = (id, data) => { const size = data.length; return [...id, 0x80 | size, ...data]; };
  const ebml = [0x1a, 0x45, 0xdf, 0xa3, 0x80 | 4, 0x42, 0x82, 0x81, 0x77]; // EBML { DocType (short) }
  const info = el([0x15, 0x49, 0xa9, 0x66], [...el([0x2a, 0xd7, 0xb1], [0x0f, 0x42, 0x40]), ...el([0x4d, 0x80], [0x43, 0x68, 0x72])]); // TimecodeScale 1e6, MuxingApp
  const tracks = el([0x16, 0x54, 0xae, 0x6b], [0xd7, 0x81, 0x01]);
  const head = [...ebml, 0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, ...info, ...tracks];
  const out = new Uint8Array(head.length + 12 + payload);
  out.set(head);
  out.set([0x1f, 0x43, 0xb6, 0x75, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff], head.length); // Cluster, unknown size
  return out;
}

test("the WebM duration is written into the Segment Info the way a recorder leaves it, and read back", () => {
  const raw = recorderWebm();
  assert.equal(webmDuration(raw), null, "a recorder writes none");
  const fixed = setWebmDuration(raw, 14_000);
  assert.equal(webmDuration(fixed), 14_000);
  assert.equal(fixed.length, raw.length + 11);
  assert.deepEqual([...fixed.subarray(fixed.length - 300_000)], [...raw.subarray(raw.length - 300_000)], "the media is unchanged");
  assert.equal(webmDuration(setWebmDuration(fixed, 9_000)), 9_000, "an existing Duration is replaced in place");
  assert.throws(() => setWebmDuration(new Uint8Array([1, 2, 3, 4]), 1000), /not a WebM/);
  assert.throws(() => setWebmDuration(raw, 0), /duration/);
});

test("the video's words are the draft's own (title, lines, the end card with TradingView and the disclaimer); the page is safe", () => {
  const draft = { kind: "pattern", text: `Education · Pattern breakout · XAUUSD H4\nDescending Channel · direction down\n\nBreakout line 3871.60\nThe pattern fails if an H4 candle closes back above 3905.20.\n\nChart by TradingView.\n${ANALYSIS_DISCLAIMER}\n#XAUUSD #gold #shorts` };
  const s = videoScript(draft, brand, { disclaimers: [ANALYSIS_DISCLAIMER] });
  assert.equal(s.title, "Pattern breakout · XAUUSD H4");
  assert.deepEqual(s.lines, ["Descending Channel · direction down", "Breakout line 3871.60", "The pattern fails if an H4 candle closes back above 3905.20."]);
  assert.deepEqual(s.end, ["Chart by TradingView", brand.card_disclaimer, "cta.cryptophys.work"]);
  assert.match(s.end[1], /not financial advice/);
  const html = videoHtml("data:image/jpeg;base64,AAAA", { ...s, title: "</script><script>alert(1)</script>" });
  // The cover (2026-11-18: a fade-in from black gave a dark thumbnail): the card and the title are drawn from frame 0.
  assert.match(html, /var a = 1, z = /);
  assert.doesNotMatch(html, /ease\(\(t - 0\.6\)/);
  assert.doesNotMatch(html, /<\/script><script>alert/);
  assert.match(html, /MediaRecorder/);
  assert.match(html, new RegExp(`"seconds":${VIDEO_SECONDS}`));
});

test("video drafts: YouTube and TikTok get the overlay and TradingView's credit, wait for their video, and store it in chunks", () => {
  const now = Date.parse("2026-11-17T06:09:30Z");
  const analysis = { at: "2026-11-17T06:09:00Z", price: 3884.7, zones: [{ role: "supply", low: 3898, high: 3902.4 }], patterns: [{ chart: "H4", pattern: "descending_channel", name: "Descending Channel", status: "confirmed", direction: "down", upper: 3905.2, lower: 3871.6, projection: 3820.4 }], structure: {} };
  const drafts = analysisDrafts(analysis, { now, channels: ["youtube", "tiktok"] });
  assert.deepEqual(drafts.map((d) => [d.channel, d.status, Boolean(d.overlay)]), [["youtube", "needs_video", true], ["tiktok", "needs_video", true]]);
  for (const d of drafts) assert.match(d.text, /Chart by TradingView\./);
  const recap = dailyDrafts([{ bar_close: "2026-11-15T10:00:00.000Z", stance: "WAIT", bias: "NEUTRAL" }], { now: Date.parse("2026-11-16T22:17:00Z"), channels: ["tiktok"] }).drafts[0];
  assert.equal(recap.status, "needs_video");
  assert.match(recap.text, /Chart by TradingView\./);
  const sql = sqlite();
  addDrafts(sql, drafts, { now });
  assert.equal(draftsNeedingImage(sql, { limit: 5 }).length, 2, "video drafts wait with the cards");
  const id = drafts[0].id, mediaId = "ef".repeat(16);
  const data = "A".repeat(MEDIA_CHUNK * 2 + 123);
  assert.equal(attachImage(sql, { id, mediaId, data, bytes: 2_000_000, contentType: "video/webm", imageUrl: `https://cta.cryptophys.work/media/${mediaId}.jpg` }, { now }).error, "bad video");
  const r = attachImage(sql, { id, mediaId, data, bytes: 2_000_000, contentType: "video/webm", imageUrl: `https://cta.cryptophys.work/media/${mediaId}.webm` }, { now });
  assert.equal(r.status, "pending", JSON.stringify(r.guardian));
  const m = mediaOf(sql, mediaId);
  assert.equal(m.content_type, "video/webm");
  assert.equal(m.data.length, data.length, "the chunks join back whole");
  assert.equal(decideDraft(sql, { id, decision: "approve", actor: "owner@example.com" }, { now }).status, "approved");
  assert.equal(getDraft(sql, id).image_url, `https://cta.cryptophys.work/media/${mediaId}.webm`);
});

test("the video render: the card, then the recording, its duration written; a failed recording stores nothing", async () => {
  const card = new Uint8Array(MIN_CARD_BYTES + 1); card[0] = 0xff; card[1] = 0xd8;
  const fake = (state, data) => ({ async newPage() { return {
    async setViewport() {}, async setContent(html) { fake.html = html; }, async waitForFunction() {},
    async evaluate() { return { state, data }; }
  }; }, async close() { fake.closed = true; } });
  const raw = recorderWebm(MIN_VIDEO_BYTES + 10);
  const ok = await renderVideo({ kind: "pattern", text: "Education · Pattern\nline" }, brand, { launch: async () => fake("ok:video/webm;codecs=vp9", toBase64(raw)), card, seconds: 14 });
  assert.equal(ok.mime, "video/webm");
  assert.equal(webmDuration(ok.bytes), 14_000);
  assert.match(fake.html, /data:image\/jpeg;base64,/, "the card goes in as a data URL (no network)");
  assert.ok(fake.closed);
  await assert.rejects(renderVideo({ kind: "pattern", text: "x" }, brand, { launch: async () => fake("error:no recorder", null), card }), /not recorded \(error:no recorder\)/);
  await assert.rejects(renderVideo({ kind: "pattern", text: "x" }, brand, { launch: async () => fake("ok:video/webm", toBase64(recorderWebm(10))), card }), /too small/);
});

/** A fake platform: records each request; `routes` answers by method and URL. */
function platform(routes) {
  const calls = [];
  const fetcher = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method, headers: init.headers ?? {}, body: init.body });
    const r = routes(String(url), init);
    return new Response(r.body == null ? null : JSON.stringify(r.body), { status: r.status ?? 200, headers: r.headers ?? {} });
  };
  return { calls, fetcher };
}
const VIDEO = { bytes: new Uint8Array(1234), mime: "video/webm" };

test("YouTube: refreshes the token, opens a resumable session, uploads the bytes; the dry run carries no secret", async () => {
  const p = platform((url, init) => url === GOOGLE_TOKEN_URL ? { body: { access_token: "ya29.x" } }
    : url === YOUTUBE_UPLOAD_URL ? { headers: { location: "https://upload.example/session1" } }
    : url === "https://upload.example/session1" ? { body: { id: "vid123", status: { privacyStatus: "private" } } } : { status: 404 });
  const account = { client_id: "cid", client_secret: "csecret", refresh_token: "1//rt" };
  const text = "Education · Pattern breakout · XAUUSD H4\nline\n\nChart by TradingView.\nNot financial advice.\n#XAUUSD #shorts";
  const r = await publishYouTube({ account, text, video: VIDEO, fetcher: p.fetcher });
  assert.deepEqual(r, { remote_id: "vid123", privacy: "private" });
  assert.equal(p.calls[0].body.get("grant_type"), "refresh_token");
  const meta = JSON.parse(p.calls[1].body);
  assert.equal(meta.snippet.title, "Pattern breakout · XAUUSD H4");
  assert.equal(meta.status.privacyStatus, "public");
  assert.equal(p.calls[1].headers["x-upload-content-length"], "1234");
  assert.equal(p.calls[2].method, "PUT");
  assert.equal(p.calls[2].body, VIDEO.bytes);
  assert.equal(p.calls[2].headers.authorization, "Bearer ya29.x");
  const dry = JSON.stringify(await publishYouTube({ account, text, video: VIDEO, dryRun: true }));
  assert.doesNotMatch(dry, /csecret|1\/\/rt|ya29/);
  await assert.rejects(publishYouTube({ account: {}, text, video: VIDEO }), /youtube account not configured/);
});

test("TikTok: refreshes (and stores the rotated refresh token), asks the creator's privacy options, posts one chunk", async () => {
  const p = platform((url) => url === `${TIKTOK_BASE}/oauth/token/` ? { body: { access_token: "act.1", expires_in: 7200, refresh_token: "rft.new" } }
    : url.endsWith("/creator_info/query/") ? { body: { data: { privacy_level_options: ["MUTUAL_FOLLOW_FRIENDS", "SELF_ONLY"] }, error: { code: "ok" } } }
    : url.endsWith("/video/init/") ? { body: { data: { publish_id: "v_pub_1", upload_url: "https://open-upload.example/video/?u=1" }, error: { code: "ok" } } }
    : url.startsWith("https://open-upload.example/") ? { status: 201 } : { status: 404 });
  const saved = [];
  const r = await publishTikTok({ account: { client_key: "ck", client_secret: "cs", refresh_token: "rft.old" }, text: "Education · caption", video: VIDEO, fetcher: p.fetcher, onToken: async (t) => saved.push(t) });
  assert.deepEqual(r, { remote_id: "v_pub_1", privacy: "SELF_ONLY" }, "an unaudited client posts SELF_ONLY");
  const audited = await publishTikTok({ account: { client_key: "ck", client_secret: "cs", refresh_token: "rft.old" }, text: "x", video: VIDEO, fetcher: p.fetcher, audited: true });
  assert.equal(audited.privacy, "MUTUAL_FOLLOW_FRIENDS", "once audited: the most public option the creator allows");
  assert.deepEqual(saved, [{ access_token: "act.1", expires_in: 7200, refresh_token: "rft.new" }]);
  const init = JSON.parse(p.calls[2].body);
  assert.deepEqual(init.source_info, { source: "FILE_UPLOAD", video_size: 1234, chunk_size: 1234, total_chunk_count: 1 });
  assert.equal(init.post_info.brand_content_toggle, false);
  assert.equal(init.post_info.video_cover_timestamp_ms, 1000, "the cover: 1 s in, the card and the title, never the first dark frame");
  assert.equal(p.calls[3].headers["content-range"], "bytes 0-1233/1234");
  const dry = JSON.stringify(await publishTikTok({ account: { client_key: "ck", client_secret: "cs", refresh_token: "rft.old" }, text: "x", video: VIDEO, dryRun: true }));
  assert.doesNotMatch(dry, /rft\.old|"cs"/);
  await assert.rejects(publishTikTok({ account: { client_key: "ck", client_secret: "cs", refresh_token: "r" }, text: "x", video: { bytes: { length: TIKTOK_SINGLE_CHUNK_MAX + 1 }, mime: "video/webm" } }), /over 64 MB/);
  const denied = platform((url) => url.endsWith("/oauth/token/") ? { body: { access_token: "a" } } : { status: 403, body: { error: { code: "unaudited_client_can_only_post_to_private_accounts", message: "x" } } });
  await assert.rejects(publishTikTok({ account: { client_key: "ck", client_secret: "cs", refresh_token: "r" }, text: "x", video: VIDEO, fetcher: denied.fetcher }), /unaudited_client/);
});

test("the desk keeps TikTok's rotated refresh token, and the account prefers it over the secret that seeded it", async () => {
  const sql = sqlite();
  storeToken(sql, "tiktok", { access_token: "act.1", expires_in: 7200, refresh_token: "rft.2" }, { now: 1 });
  storeToken(sql, "tiktok", { access_token: "act.2", expires_in: 7200 }, { now: 2 });
  assert.equal(storedToken(sql, "tiktok").refresh_token, "rft.2", "a refresh without a new refresh token keeps the old one");
  const env = { TIKTOK_CLIENT_KEY: "ck", TIKTOK_CLIENT_SECRET: "cs", TIKTOK_REFRESH_TOKEN: "rft.seed" };
  assert.equal((await accountOf(env, "tiktok", { stored: storedToken(sql, "tiktok") })).refresh_token, "rft.2");
  assert.equal((await accountOf(env, "tiktok")).refresh_token, "rft.seed");
  assert.equal(await accountOf({}, "youtube"), null);
  // publishTo hands the video channels their media.
  const loaded = [];
  await publishTo("youtube", { account: { client_id: "c", client_secret: "s", refresh_token: "r" }, draft: { text: "x" }, dryRun: true, media: async () => { loaded.push(1); return VIDEO; } });
  assert.equal(loaded.length, 1);
});
