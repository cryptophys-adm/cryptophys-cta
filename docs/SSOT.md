# cryptophys-cta: single source of truth

## 1. Topology: one Worker

| Worker | Source | Deployed by | Role |
|---|---|---|---|
| `cryptophys-cta` | `src/`, `public/`, `wrangler.jsonc` | `.github/workflows/deploy.yml` on `main` until the platform's native deploy (Forge + Deployment Orchestrator, consensus `deploy_commit`; `organism.json` `deploy`, ADR-0018) takes over | `cta.cryptophys.work`: the public CTA page and the content studio; the content engine (drafts, guardian, queue, publishers). |

Bindings:
- `PROJECTION` → `xauusd-ai-trading-assistant` entrypoint `PublicProjection` (read-only RPC): `recaps({days})`
  (decisions older than 24 hours, no level, plan or account) and `analysis()` (the Key Level Agent's zones as demand
  and supply, H1/H4/D1 chart patterns with their lines and projection, the structure; never a decision or plan).
- `CONTENT_DESK` → Durable Object `ContentDesk` (SQLite): the drafts, their events, the refreshed tokens, the
  published archive.
- `ASSETS` → `public/` (the public pages `/`, `/archive`, `/about`, `/disclaimer`, the sign-in page `/signin` served with a 403 for `/studio` without a valid Access JWT, and the studio page; no build step). A light developer-console look (owner
  2026-11-16): a white top bar, the studio's left navigation (Dashboard, Content queue, Performance, Channels, switched
  by the URL hash), white cards on a light grey page, one blue for actions; Cryptophys's own mark and name only. No
  inline script or style, no web font (CSP `'self'`); a test holds both.
- `BROWSER` → Browser Run: the Instagram cards (`src/card.mjs`, `src/render.mjs`). A card is 1080 × 1350:
  TradingView's own Advanced Chart widget (`OANDA:XAUUSD`, the draft's timeframe) with **our overlay drawn over it**
  (owner 2026-11-15: "Langsung gambar beserta pola dan key level serta proyeksi horizon di chart"; "Overlay on
  TradingView"), above the Cryptophys panel (the draft's own guardian-checked text) and a footer with "Chart by
  TradingView" and the disclaimer.
  - The overlay: the zones nearest the price (supply above, demand below; on the chart the zone only, no metric names:
    owner 2026-11-15 "di chart cukup zone tidak perlu membawa metrics"), a pattern's upper and lower lines drawn as
    fitted from its start candle (owner 2026-11-15: "gambar juga garis pattern di chart"; the analysis gives each line's
    start and end time and price, and the browser finds those candles on TradingView's chart by time; without them the
    levels are drawn flat), and for
    a confirmed pattern a dashed arrow from the breakout line at the last bar into a shaded future area, ending at the
    measured projection (no time is claimed: the analysis has a price, not a horizon); for a forming pattern, the
    two confirmation arrows. Only the draft's own numbers (`overlay`, stored with the draft).
  - How it is placed: TradingView's embed has no drawing API, so the browser reads the chart's own price-to-pixel
    mapping inside TradingView's frame (`measureInChart`), sets the view (the last 40–96 candles by timeframe, a future
    area on the right, a price range over those candles and every level), and the SVG layer is drawn from that
    mapping in the card page. Nothing is drawn inside TradingView and no bar leaves the browser. This reads
    TradingView's internal chart objects (not a public API): if they change, `geometryProblem` refuses the card, the
    draft stays `needs_image` with the reason, and nothing wrong is published.
  - Rendered right after each drafting run (about 7–8 seconds a card, at most 3 a run, 3 tries per draft), kept in
    the Desk (`media`, base64); the draft then waits for a person. `@cloudflare/puppeteer` is the one runtime
    dependency (`nodejs_compat`).
  - The video (YouTube Shorts, TikTok; `src/video.mjs`): the same card, then a 9:16 1080 × 1920 recording of
    `VIDEO_SECONDS` (14 s): the brand, the card slowly closing in with the draft's own lines appearing one by one,
    and an end card with "Chart by TradingView", the disclaimer and cta.cryptophys.work. Drawn on a canvas and
    recorded by the browser's MediaRecorder (WebM VP9/VP8, about 30 fps, about 4 MB); the recorder writes no duration,
    so `src/webm.mjs` adds it to the Segment Info. About 22 seconds of browser time a video. A video is larger than
    a Desk row may be, so it is kept in `media_chunks` (1 MB of base64 each).

Entrypoints: `OrganismDna.dna()` (the platform census), `CtaHealth.health()` (drift checks).

## 2. Routes

| Route | Who | What |
|---|---|---|
| `GET /health` | anyone | `{ ok, service, publish }` |
| `GET /`, `GET /api/public/profile`, `GET /api/public/archive` | anyone | the brand, its links, the disclaimer, published posts |
| `GET /media/<id>.jpg`, `GET /media/<id>.webm` | anyone, only once the draft is approved or published | the Instagram card (Instagram fetches it at publishing), the video; 404 before, and a video is never served as `.jpg` |
| `GET /studio` | Access JWT | the studio page; without a valid JWT the sign-in page (`/signin`, 403) |
| `GET /`, `/archive`, `/about`, `/disclaimer` | none | the public pages (static; the archive and profile from `/api/public/*`) |
| `GET /api/studio/whoami`, `status`, `drafts`, `draft`, `preview` | Access JWT (person or service token) | read the queue; `preview` is a dry run with tokens redacted |
| `POST /api/studio/decide` | a person, same origin, JSON | approve or reject (a reason is required to reject); an approval publishes at once only while `CONTENT_PUBLISH` is "on" |
| `POST /api/studio/draft-now` | a person, same origin, JSON | runs the drafting now |
| `GET /api/studio/media?id=` | Access JWT | a card or video at any status (the studio's preview) |
| `POST /api/studio/render-now` | a person, same origin, JSON | renders the waiting cards and videos now |
| `GET /api/studio/performance` | Access JWT | the last 14 days: posts and summed views, likes, comments, shares per channel, the best post, each post's latest metrics |
| `POST /api/studio/insights-now` | a person, same origin, JSON | reads the recent posts' metrics now |
| `GET /api/studio/schedule` | Access JWT | each channel's next slots (WIB), approved drafts waiting, the next one, and the latest slot runs |
| `GET /api/studio/library?status=&channel=&kind=&q=&from=&to=&offset=` | Access JWT | Library: every draft, filtered (words in the text or id; `from`/`to` are WIB days), 30 a page, with the total |
| `POST /api/studio/edit` | a person, same origin, JSON | `{ id, text }`: only a pending, blocked, needs_image or needs_video draft; the guardian again (refused text is not stored); a card or video channel's media is made again; event `edited` |
| `POST /api/studio/duplicate` | a person, same origin, JSON | `{ id }`: a copy of any draft as `manual:<day>:<id>:<channel>`, checked again, waiting for approval; events `composed` and `duplicated` (with the source) |
| `GET /api/studio/calendar?month=YYYY-MM` | Access JWT | drafts made and posts published per WIB day and channel |
| `GET /api/studio/media-library?offset=` | Access JWT | every card and video (no bytes): channel, type, status, size |
| `GET /api/studio/templates?kind=&channels=&ref=` | Access JWT | Create: a blank post (`custom`) or the engine's template (`key_levels`, `pattern`, `daily_recap`) filled with the current projection, per channel, with the channel's hashtags |
| `POST /api/studio/check` | a person, same origin, JSON | Create: the guardian's check of one channel's text as typed (length, the guardian's rules, a custom post's own words) |
| `POST /api/studio/compose` | a person, same origin, JSON | Create: `{ kind, ref, posts: [{ channel, text }] }`; saved only when every channel passes; drafts `manual:<day>:<id>:<channel>` wait for approval (event `composed`, the person as actor); a template's card numbers come from the server's analysis, never the browser |
| `GET /api/studio/settings` | Access JWT | each channel's settings (stored over the defaults), the formats each channel can take, who changed them last; never a token |
| `POST /api/studio/settings` | a person, same origin, JSON | `{ channel, settings }`: validated by `src/settings.mjs`, stored in the Desk (`channel_settings`), an event per change |

The Worker verifies the Access JWT itself (team `cryptophys.cloudflareaccess.com`; audience `ACCESS_AUD`, a plain var in
`wrangler.jsonc`: the tag of the platform's Access application, not a secret). For the edge to ask for sign-in, the platform's `provision-access.yml` covers
`cta.cryptophys.work/studio*` and `cta.cryptophys.work/api/studio/*` as public paths of its Access application; the
rest of the host stays public.

## 3. Schedule (UTC)

| Cron | What |
|---|---|
| `*/5 * * * *` | the per-channel scheduler: each channel's due posting slot publishes its oldest approved draft (only while `CONTENT_PUBLISH` is "on"; no Desk call otherwise) |
| `9 * * * 1-5` | pattern posts (confirmed on H1/H4/D1, forming on H4/D1; once each; at most four a day per channel); at 06:09 the key-level map |
| `17 22 * * 2-6` | the recap of the trading day that ended 24 hours earlier; token refresh (only while publishing is on: Threads and Instagram long-lived tokens, TikTok's rotating refresh token); then the metrics of the last 14 days' posts (`src/insights.mjs`; only while publishing is on) |

## 4. Channels

| Channel | Media | Publisher | Secrets |
|---|---|---|---|
| Threads (`xauusd-ai-cta`) | text | built | `THREADS_ACCESS_TOKEN`, `THREADS_USER_ID` |
| Instagram | image: the card (TradingView chart + our overlay + Cryptophys panel), rendered by Browser Run; the caption names TradingView | built | `INSTAGRAM_ACCESS_TOKEN`, `INSTAGRAM_USER_ID` |
| X | text, 280 characters (short recap) | built (billed per post by X) | `X_ACCESS_TOKEN` |
| Telegram channel | text | built (Bot API; the bot is a channel admin) | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` |
| YouTube Shorts | video (WebM, 9:16, 14 s) from the card; the description names TradingView | built: resumable upload, public asked; private until Google verifies the API project | `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REFRESH_TOKEN` |
| TikTok | the same video | built: Direct Post, FILE_UPLOAD in one chunk, the most public privacy the creator allows; private (SELF_ONLY) until TikTok audits the app | `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_REFRESH_TOKEN` (TikTok rotates it; the Desk keeps the newest) |

Content management (owner 2026-11-16: "content management"; the studio's Library, Calendar and Media pages). The
library lists every draft and post with filters and paging; a person edits a draft's text before approval (the
guardian again, as for a composed post; a refused text is not stored; an Instagram, YouTube or TikTok draft loses its
card or video, which carried the old text, and gets a new one), or copies any draft, a published one included, as a
new draft that waits for approval. Approved, published and rejected drafts are never rewritten. Nothing is deleted.

Channel settings (owner 2026-11-16: "setting konfigurasi channel ... content creation terjadwal untuk masing-masing
channel beserta format contentnya apakah video/image/text only"; `src/settings.mjs`, the Desk's `channel_settings`,
the studio's Channels page). Per channel, set by a person:

| Setting | Values | Effect now |
|---|---|---|
| `enabled` | on / off | off: the channel gets no drafts (`CONTENT_CHANNELS` still bounds the channels) |
| `format` | text, image, video: only what the channel's publisher posts today (Threads, X, Telegram text; Instagram image; YouTube, TikTok video); the rest is shown as planned and refused | recorded; a new format needs its publisher first |
| `kinds` | key-level map, chart pattern, daily recap | a kind not listed is not drafted for the channel |
| `max_per_day` | 1–24 (default 6: one key-level map, four patterns, one recap) | drafts over it in the WIB day (00:00 Asia/Jakarta) are not made |
| `schedule` | up to 12 slots, each days of the week and a time in WIB | the scheduler (`src/scheduler.mjs`, every 5 minutes) publishes the channel's oldest approved draft at each slot, one per slot; a slot missed by over 30 minutes is skipped; no slots: a draft is published at its approval |
| `hashtags` | up to 8 `#words`; never the internal names | replaces the channel's default hashtag line; the guardian checks the draft again, and a failing line keeps the default |

The defaults are what the engine did before settings existed; a stored row that no longer validates falls back to
them. A draft the guardian held is queued as it is.

Create (owner 2026-11-16: content creation in the studio; person-written posts allowed with the guardian and
approval; `src/compose.mjs`, the studio's Create page). A person picks a start (a custom post, or the key-level map,
chart pattern or daily recap template filled with the current projection) and the channels, edits each channel's
text, sees a preview and the guardian's result as they type, and sends it to the queue. The guardian checks as for
the engine's drafts: price levels only in the analysis kinds, TradingView's credit where the post is the chart card or
its video, the recap's delay rule with the recap window's decisions; a custom post needs at least 20 characters of its
own besides the template lines. A post is saved only when every channel passes; the drafts then wait for approval like
any other (cards and videos are made for them by the same run). Settings' kinds and daily maximum bound the engine,
not a person's post.

Meta's endpoint shapes follow the published guides (Meta's own pages were unreachable from the build session).
YouTube's resumable upload and TikTok's Direct Post and media transfer follow their guides, read on 2026-11-15; the
two token refreshes (Google's token endpoint, TikTok's `/v2/oauth/token/`) follow the standard flows. One dry run and
one real post on a test account per channel confirm them before `CONTENT_PUBLISH` is turned on. Daily quotas are read
from Meta's limit endpoints at run time.

Metrics (`src/insights.mjs`, `post_metrics` in the Desk): Threads (views, likes, replies, reposts, quotes, shares),
Instagram (views, reach, likes, comments, saved, shares), YouTube (views, likes, comments), read for the channels in
`CONTENT_INSIGHTS` (default `threads,instagram,youtube`; X only when listed, because X bills each read). Telegram (the
Bot API has no post views) and TikTok (it needs the video id and `video.list`) are not read. The studio is in English
(owner 2026-11-15: "lanjutkan semua", after the choice was offered).

## 5. Kernel and platform

External organ, `organism.json` (`cta-organism.v1`): one portal organ `cryptophys-cta`, agents `cta-editor` and
`cta-guardian` (tier 1, `signals.observe` and `reports.publish`, no seat), no AI task. Platform-side, still to be done
in `cryptophys-cloud-platform` (its own PRs and consensus):
- an `EXTERNAL_ORIGINS` entry `{ origin: "cta", schema: "cta-organism.v1", binding: "EXT_ORGANISM_CTA", services: ["cryptophys-cta"] }`
  (done: platform CR cta-external-origin, merge 280e220) and the Forge binding `EXT_ORGANISM_CTA` → `cryptophys-cta` `OrganismDna`;
- the drift binding `EXT_CRYPTOPHYS_CTA` → `cryptophys-cta` `CtaHealth`;
- Access paths `cta.cryptophys.work/studio*` and `cta.cryptophys.work/api/studio/*` in the platform's native Access
  definition (`native-access.ts`, gate 9; `provision-access.yml` is retired at cut-over), applied on the owner's click.
- the native deploy of an external organ (owner 2026-11-15: "gunakan native deployment pakai forge"): the Forge
  mirrors and checks this repository, and the Orchestrator does the first full script upload (the Durable Object
  migration `v1`, the custom domain, the assets), then code and config versions, keeping the Worker secrets.
  `organism.json` `deploy` is what it reads; the organ's own `deploy_unit` stays `null`, because the census refuses an
  external organ that claims a platform unit. Not built yet (platform 2026-11-16: no ETA; it follows the cut-over
  follow-ups, and needs the owner's choice of ADR-0018 scope, the source repository the Forge mirrors, and a proven
  custom domain for a new hostname).
- Until then, the bridge (owner 2026-11-16: "setuju, buatkan PR workflow deploy CTA"): `.github/workflows/deploy.yml`
  deploys from `main` with the repository secret `CLOUDFLARE_API_TOKEN` (skipped with a warning without it), runs the
  tests, refuses unless `CONTENT_PUBLISH` is "off", sets no Worker secret, and runs `organism.json` `deploy`'s health
  and smoke checks against `cta.cryptophys.work`. Once the Worker exists, the platform adds the `EXT_ORGANISM_CTA` and
  `EXT_CRYPTOPHYS_CTA` bindings and the Access paths (the owner approves the Access change). The workflow is removed
  in the change that hands the deploy to the Forge.
Until the Forge registers the agents, the Worker does not bind the kernel (`AGENTS`).
