# cryptophys-cta: single source of truth

## 1. Topology: one Worker

| Worker | Source | Deployed by | Role |
|---|---|---|---|
| `cryptophys-cta` | `src/`, `public/`, `wrangler.jsonc` the platform's native deploy (Forge + Deployment Orchestrator, consensus `deploy_commit`; `organism.json` `deploy`) | `cta.cryptophys.work`: the public CTA page and the content studio; the content engine (drafts, guardian, queue, publishers). |

Bindings:
- `PROJECTION` → `xauusd-ai-trading-assistant` entrypoint `PublicProjection` (read-only RPC): `recaps({days})`
  (decisions older than 24 hours, no level, plan or account) and `analysis()` (the Key Level Agent's zones as demand
  and supply, H1/H4/D1 chart patterns with their lines and projection, the structure; never a decision or plan).
- `CONTENT_DESK` → Durable Object `ContentDesk` (SQLite): the drafts, their events, the refreshed tokens, the
  published archive.
- `ASSETS` → `public/` (the CTA page and the studio page; no build step).
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
| `GET /studio` | Access JWT | the studio page |
| `GET /api/studio/whoami`, `status`, `drafts`, `draft`, `preview` | Access JWT (person or service token) | read the queue; `preview` is a dry run with tokens redacted |
| `POST /api/studio/decide` | a person, same origin, JSON | approve or reject (a reason is required to reject); an approval publishes at once only while `CONTENT_PUBLISH` is "on" |
| `POST /api/studio/draft-now` | a person, same origin, JSON | runs the drafting now |
| `GET /api/studio/media?id=` | Access JWT | a card or video at any status (the studio's preview) |
| `POST /api/studio/render-now` | a person, same origin, JSON | renders the waiting cards and videos now |

The Worker verifies the Access JWT itself (team `cryptophys.cloudflareaccess.com`; audience `ACCESS_AUD`, a plain var in
`wrangler.jsonc`: the tag of the platform's Access application, not a secret). For the edge to ask for sign-in, the platform's `provision-access.yml` covers
`cta.cryptophys.work/studio*` and `cta.cryptophys.work/api/studio/*` as public paths of its Access application; the
rest of the host stays public.

## 3. Schedule (UTC)

| Cron | What |
|---|---|
| `9 * * * 1-5` | pattern posts (confirmed on H1/H4/D1, forming on H4/D1; once each; at most four a day per channel); at 06:09 the key-level map |
| `17 22 * * 2-6` | the recap of the trading day that ended 24 hours earlier; token refresh (only while publishing is on: Threads and Instagram long-lived tokens, TikTok's rotating refresh token) |

## 4. Channels

| Channel | Media | Publisher | Secrets |
|---|---|---|---|
| Threads (`xauusd-ai-cta`) | text | built | `THREADS_ACCESS_TOKEN`, `THREADS_USER_ID` |
| Instagram | image: the card (TradingView chart + our overlay + Cryptophys panel), rendered by Browser Run; the caption names TradingView | built | `INSTAGRAM_ACCESS_TOKEN`, `INSTAGRAM_USER_ID` |
| X | text, 280 characters (short recap) | built (billed per post by X) | `X_ACCESS_TOKEN` |
| Telegram channel | text | built (Bot API; the bot is a channel admin) | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` |
| YouTube Shorts | video (WebM, 9:16, 14 s) from the card; the description names TradingView | built: resumable upload, public asked; private until Google verifies the API project | `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, `YOUTUBE_REFRESH_TOKEN` |
| TikTok | the same video | built: Direct Post, FILE_UPLOAD in one chunk, the most public privacy the creator allows; private (SELF_ONLY) until TikTok audits the app | `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, `TIKTOK_REFRESH_TOKEN` (TikTok rotates it; the Desk keeps the newest) |

Meta's endpoint shapes follow the published guides (Meta's own pages were unreachable from the build session).
YouTube's resumable upload and TikTok's Direct Post and media transfer follow their guides, read on 2026-11-15; the
two token refreshes (Google's token endpoint, TikTok's `/v2/oauth/token/`) follow the standard flows. One dry run and
one real post on a test account per channel confirm them before `CONTENT_PUBLISH` is turned on. Daily quotas are read
from Meta's limit endpoints at run time.

## 5. Kernel and platform

External organ, `organism.json` (`cta-organism.v1`): one portal organ `cryptophys-cta`, agents `cta-editor` and
`cta-guardian` (tier 1, `signals.observe` and `reports.publish`, no seat), no AI task. Platform-side, still to be done
in `cryptophys-cloud-platform` (its own PRs and consensus):
- an `EXTERNAL_ORIGINS` entry `{ origin: "cta", schema: "cta-organism.v1", binding: "EXT_ORGANISM_CTA", services: ["cryptophys-cta"] }`
  and the Forge binding `EXT_ORGANISM_CTA` → `cryptophys-cta` `OrganismDna`;
- the drift binding `EXT_CRYPTOPHYS_CTA` → `cryptophys-cta` `CtaHealth`;
- Access paths `cta.cryptophys.work/studio*` and `cta.cryptophys.work/api/studio/*` in `provision-access.yml`.
- the native deploy of an external organ (owner 2026-11-15: "gunakan native deployment pakai forge"): the Forge
  mirrors and checks this repository, and the Orchestrator does the first full script upload (the Durable Object
  migration `v1`, the custom domain, the assets), then code and config versions, keeping the Worker secrets.
  `organism.json` `deploy` is what it reads; the organ's own `deploy_unit` stays `null`, because the census refuses an
  external organ that claims a platform unit. Until that path is live, `cryptophys-cta` is not deployed.
Until the Forge registers the agents, the Worker does not bind the kernel (`AGENTS`).
