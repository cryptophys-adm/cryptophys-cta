# Rules for agents working in cryptophys-cta

cryptophys-cta is the Cryptophys content studio and public CTA page at `cta.cryptophys.work` (owner 2026-11-14:
"aplikasi cta.cryptophys.work sesuai standar profesional expert digital marketing & content creator yang terhubung
kernel, sebagai services/engine terpisah dari xauusd-ai-trading-assistant"). Topology and data flow: `docs/SSOT.md`.

1. **Deploy only through `main`: the bridge workflow now, the platform's native deploy later.** Owner 2026-11-15:
   "gunakan native deployment pakai forge"; owner 2026-11-16: "setuju, buatkan PR workflow deploy CTA" (the platform
   session's faster path: the Forge cannot bind or check a Worker that does not exist yet, and native deploy of an
   external organ, ADR-0018, is not built). Until it is, `.github/workflows/deploy.yml` deploys a PR merged into `main`
   (or a run by hand), using the repository secret `CLOUDFLARE_API_TOKEN` the owner adds; without it the deploy job is
   skipped with a warning. Once the Forge deploys this organ, `deploy.yml` is removed in the same change that hands it
   over. `organism.json` `deploy` declares what the Forge will deploy, and `test/app.test.mjs` keeps that block equal
   to `wrangler.jsonc`; the workflow runs that block's health and smoke checks. The workflow sets no Worker secret,
   deletes nothing and refuses to deploy unless `CONTENT_PUBLISH` is "off", or "on" with a named `PUBLISH_CHANNELS` list. Never `wrangler deploy`,
   `wrangler delete` or `wrangler secret put` by hand. Account tokens reach the Worker only as Worker secrets the
   owner sets through the platform; a deploy keeps them. Never paste a secret into a chat, an issue or a file.
2. **Nothing is published without the owner.** `CONTENT_PUBLISH` stays "off" until the owner turns it on in a PR
   (after the lawyer's check of POJK 6/2026). Owner 2026-11-17 (check done): on, for the channels in
   `PUBLISH_CHANNELS` only, starting with `telegram`, then `threads` (owner "ya lanjutkan", after Telegram's first post), then `instagram` (owner "lanjutkan penerbitan instagram", after Threads' first post); another channel is added in its own owner PR after the one
   before it works. `PUBLISH_CHANNELS` unset or empty publishes nothing. Every draft waits in the studio for a person's approval; an approval
   runs the guardian again. A service token can read the studio, never decide.
   **Replies are the one exception** (owner 2026-11-25: "semua autonomous jadi reply tanpa approval"; caps "10 an hour,
   40 a day"; "By themselves after 3 days"): the CTA agent answers replies under our own posts without a person's
   approval (`src/agent/replies.mjs`), on the channels in `REPLY_CHANNELS` (Threads first) that publish, after a 72-hour
   dry run that sends nothing. A question about buying, selling or where the price goes gets the fixed answer only; a
   question about the room's reading gets the latest War Room reading in a fixed template, never model text (owner
   2026-11-25: "Yes, from a fixed template"); every
   answer passes the guardian's rules, the reply checks and carries "Not financial advice."; at most 1 answer per person
   per thread, 10 an hour and 40 a day; never a DM, never another account's thread. The studio's switch and the var
   `AGENT_REPLIES` stop it.
   **Posts approved by a rule** (owner 2026-11-25: "Yes, posted by itself"; kinds "Chart pattern (confirmed), Key-level
   map, Daily recap, War Room"; the public wording "Use the mockup's sentences"; the lawyer "No, go ahead"): a channel's
   settings may approve those kinds automatically (`auto_approve`, Threads by default; never a custom post), 15 minutes
   after a draft is ready, unless a person edited it; the approval is a person's in every other way (the guardian again,
   an aged analysis draft expires), it is logged as "auto-approve", and in the window a person can approve, edit or
   reject it (`src/agent/auto-approve.mjs`). The scheduled run drafts confirmed chart patterns only ("Only confirmed").
   An analysis draft (the key-level map, a pattern post) expires 2 hours after it was made from the analysis (owner
   2026-11-17: "kadaluwarsa otomatis"): it is never approved, sent again, copied or published after that; a fresh one is
   made from Create with the latest analysis. A recap is about the past and does not expire.
3. **Content policy (owner 2026-11-14):**
   - all public content in English (owner 2026-11-15: "Semua content in english"): posts, captions, cards, the
     public page; the studio UI is English too (owner 2026-11-17: "all in english, hanya percakapan owner dengan
     sesi claude yang bahasa indonesia"; confirmed in the session: published posts English). Text the owner types
     may be any language; only the owner's chats with Claude sessions are Indonesian;
   - education and analysis only, with the capacity ("Education") and the disclaimer in every post;
   - analytics and key levels are allowed; buy and sell zones as information only;
   - never buy/sell advice: no entry, stop loss, take profit, BUY/SELL/LONG/SHORT as a signal, lot or rating
     (the guardian's `signal_words` and `instruction` rules);
   - the system's decisions only as a recap after 24 hours; the analysis (zones, patterns, structure) in real time;
   - no promised return, no account data, never Nexus or Omega, never a secret;
   - chart images are TradingView charts with TradingView's attribution visible; never a chart drawn from Yahoo
     data, the TradingView account's bars or the broker's MT5 bars (licensing). Our zones, pattern lines and
     measured projection are drawn as an overlay over TradingView's chart, from its own price mapping (owner
     2026-11-15: "Overlay on TradingView"); the overlay carries only the draft's own numbers;
   - news is never republished, only our own summary with the source named.
4. **No model writes public text.** Drafts come from fixed templates over the xauusd `PublicProjection` (read-only
   RPC). Adding a model-written step needs the owner's approval and a guardian check after it. Approved so far: the
   agent's replies (owner 2026-11-25, rule 2's exception), written by the model behind `src/agent/router.mjs` and kept
   from any number, price, level, direction, forecast or advice by `checkReply` and the guardian, or not sent; and the
   weekly audit summary, which is studio-only text. The humanizer's rewrite at publish (`src/agent/humanizer.mjs`,
   owner 2026-11-25: "Everything, templates too") is a fixed script, not a model: the guardian checks its text again,
   and the approved text goes out if it fails.
5. **Kernel.** This is an external organ (tier 1, no council seat, `signals.observe` and `reports.publish` only),
   declared in `organism.json` and read by the platform Forge over `EXT_ORGANISM_CTA`. Platform-side changes (the
   origin entry, the bindings, Access paths) go through the platform's own repository and its consensus.
6. **Studio security.** `/studio` and `/api/studio/*` verify the Cloudflare Access JWT in the Worker (fail
   closed). Writes need a person, the same origin and JSON. Pages use no inline script or style (CSP `'self'`).
7. **Tests and CI.** Never skip, disable or weaken a test to get green; no empty commits; re-run a job at most once.
8. **Commits and PRs.** No model identifiers in commits or PRs. Squash-merge with the expected head SHA.
9. **Changelog.** Every merged change gets a line in `docs/CHANGELOG.md`.
