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
  - The overlay: the zones nearest the price (supply above, demand below), a pattern's upper and lower lines, and for
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
