# Rules for agents working in cryptophys-cta

cryptophys-cta is the Cryptophys content studio and public CTA page at `cta.cryptophys.work` (owner 2026-11-14:
"aplikasi cta.cryptophys.work sesuai standar profesional expert digital marketing & content creator yang terhubung
kernel, sebagai services/engine terpisah dari xauusd-ai-trading-assistant"). Topology and data flow: `docs/SSOT.md`.

1. **Deploy only through the platform's native deploy (owner 2026-11-15: "gunakan native deployment pakai forge").**
   A PR merged into `main` is picked up by the Forge (cryptophys-cloud-platform) and deployed by the Deployment
   Orchestrator by consensus; `organism.json` `deploy` declares what it deploys, and `test/app.test.mjs` keeps that
   block equal to `wrangler.jsonc`. This repository has no deploy workflow and holds no Cloudflare token (`test.yml`
   runs the tests and a dry run only, with no secret). Never `wrangler deploy`, `wrangler delete` or
   `wrangler secret put` by hand. Account tokens reach the Worker only as Worker secrets the owner sets through the
   platform; the native deploy keeps them. Never paste a secret into a chat, an issue or a file.
2. **Nothing is published without the owner.** `CONTENT_PUBLISH` stays "off" until the owner turns it on in a PR
   (after the lawyer's check of POJK 6/2026). Every draft waits in the studio for a person's approval; an approval
   runs the guardian again. A service token can read the studio, never decide.
3. **Content policy (owner 2026-11-14):**
   - education and analysis only, with the capacity ("edukasi") and the disclaimer in every post;
   - analytics and key levels are allowed; buy and sell zones as information only;
   - never buy/sell advice: no entry, stop loss, take profit, BUY/SELL/LONG/SHORT as a signal, lot or rating
     (the guardian's `signal_words` and `instruction` rules);
   - the system's decisions only as a recap after 24 hours; the analysis (zones, patterns, structure) in real time;
   - no promised return, no account data, never Nexus or Omega, never a secret;
   - chart images are TradingView charts with TradingView's attribution visible; never a chart drawn from Yahoo
     data, the TradingView account's bars or the broker's MT5 bars (licensing);
   - news is never republished, only our own summary with the source named.
4. **No model writes public text.** Drafts come from fixed templates over the xauusd `PublicProjection` (read-only
   RPC). Adding a model-written step needs the owner's approval and a guardian check after it.
5. **Kernel.** This is an external organ (tier 1, no council seat, `signals.observe` and `reports.publish` only),
   declared in `organism.json` and read by the platform Forge over `EXT_ORGANISM_CTA`. Platform-side changes (the
   origin entry, the bindings, Access paths) go through the platform's own repository and its consensus.
6. **Studio security.** `/studio` and `/api/studio/*` verify the Cloudflare Access JWT in the Worker (fail
   closed). Writes need a person, the same origin and JSON. Pages use no inline script or style (CSP `'self'`).
7. **Tests and CI.** Never skip, disable or weaken a test to get green; no empty commits; re-run a job at most once.
8. **Commits and PRs.** No model identifiers in commits or PRs. Squash-merge with the expected head SHA.
9. **Changelog.** Every merged change gets a line in `docs/CHANGELOG.md`.
