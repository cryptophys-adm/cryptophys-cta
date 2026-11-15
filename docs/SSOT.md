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

Entrypoints: `OrganismDna.dna()` (the platform census), `CtaHealth.health()` (drift checks).

## 2. Routes

| Route | Who | What |
|---|---|---|
| `GET /health` | anyone | `{ ok, service, publish }` |
| `GET /`, `GET /api/public/profile`, `GET /api/public/archive` | anyone | the brand, its links, the disclaimer, published posts |
| `GET /studio` | Access JWT | the studio page |
| `GET /api/studio/whoami`, `status`, `drafts`, `draft`, `preview` | Access JWT (person or service token) | read the queue; `preview` is a dry run with tokens redacted |
| `POST /api/studio/decide` | a person, same origin, JSON | approve or reject (a reason is required to reject); an approval publishes at once only while `CONTENT_PUBLISH` is "on" |
| `POST /api/studio/draft-now` | a person, same origin, JSON | runs the drafting now |

The Worker verifies the Access JWT itself (team `cryptophys.cloudflareaccess.com`; audience `ACCESS_AUD`, a plain var in
`wrangler.jsonc`: the tag of the platform's Access application, not a secret). For the edge to ask for sign-in, the platform's `provision-access.yml` covers
`cta.cryptophys.work/studio*` and `cta.cryptophys.work/api/studio/*` as public paths of its Access application; the
rest of the host stays public.

## 3. Schedule (UTC)

| Cron | What |
|---|---|
| `9 * * * 1-5` | pattern posts (confirmed on H1/H4/D1, forming on H4/D1; once each; at most four a day per channel); at 06:09 the key-level map |
| `17 22 * * 2-6` | the recap of the trading day that ended 24 hours earlier; token refresh (only while publishing is on) |

## 4. Channels

| Channel | Media | Publisher | Secrets |
|---|---|---|---|
| Threads (`xauusd-ai-cta`) | text | built | `THREADS_ACCESS_TOKEN`, `THREADS_USER_ID` |
| Instagram | image (TradingView chart + Cryptophys panel; not built yet: drafts wait as `needs_image`) | built | `INSTAGRAM_ACCESS_TOKEN`, `INSTAGRAM_USER_ID` |
| X | text, 280 characters (short recap) | built (billed per post by X) | `X_ACCESS_TOKEN` |
| Telegram channel | text | built (Bot API; the bot is a channel admin) | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` |
| YouTube Shorts | video (later phase: `needs_video`) | planned | — |
| TikTok | video (later phase; an unaudited app posts privately) | planned | — |

Meta's endpoint shapes follow the published guides (Meta's own pages were unreachable from the build session):
one dry run and one real post on a test account confirm them before `CONTENT_PUBLISH` is turned on. Daily quotas
are read from Meta's limit endpoints at run time.

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
