# cryptophys-cta

The Cryptophys content studio and public CTA page at **cta.cryptophys.work**.

- **Public page** (`/`): the brand's profile (XAUUSD AI · Cryptophys), its channels, the disclaimer and the archive
  of published posts.
- **Studio** (`/studio`, behind Cloudflare Access, in English): the content queue for Threads, Instagram, X, Telegram,
  YouTube and TikTok, with each draft's guardian result, its card or video, approval or rejection, a dry run of the
  publishing request, each channel's status, and the last 14 days' performance (each post's metrics).
- **Engine**: drafts from the xauusd AI Worker's public projection (daily recap of the last 24 hours, no public delay; real-time key-level
  map and chart-pattern posts), in fixed English templates, checked by the content guardian; cards and short videos
  made in Browser Run from TradingView's chart with our overlay. Nothing is published
  while `CONTENT_PUBLISH` is "off".

Rules: `AGENTS.md`. Topology: `docs/SSOT.md`. Changes: `docs/CHANGELOG.md`.

```bash
node --test test/*.test.mjs
```
