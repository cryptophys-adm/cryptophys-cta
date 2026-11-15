# cryptophys-cta

The Cryptophys content studio and public CTA page at **cta.cryptophys.work**.

- **Public page** (`/`): the brand's profile (XAUUSD AI · Cryptophys), its channels, the disclaimer and the archive
  of published posts.
- **Studio** (`/studio`, behind Cloudflare Access): the content queue for Threads, Instagram, X, Telegram, YouTube
  and TikTok, with each draft's guardian result, approval or rejection, a dry run of the publishing request, and
  each channel's status.
- **Engine**: drafts from the xauusd AI Worker's public projection (daily recap after 24 hours; real-time key-level
  map and chart-pattern posts), in fixed Indonesian templates, checked by the content guardian. Nothing is published
  while `CONTENT_PUBLISH` is "off".

Rules: `AGENTS.md`. Topology: `docs/SSOT.md`. Changes: `docs/CHANGELOG.md`.

```bash
node --test test/*.test.mjs
```
