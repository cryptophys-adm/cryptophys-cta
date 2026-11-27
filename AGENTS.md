# Rules for agents working in cryptophys-cta

cryptophys-cta is the Cryptophys content studio and public CTA page at `cta.cryptophys.work` (owner 2026-11-14:
"aplikasi cta.cryptophys.work sesuai standar profesional expert digital marketing & content creator yang terhubung
kernel, sebagai services/engine terpisah dari xauusd-ai-trading-assistant"). Topology and data flow: `docs/SSOT.md`.

1. **Deploy only through `main`: the bridge workflow now, the platform's native deploy later.** Owner 2026-11-15:
   "gunakan native deployment pakai forge"; owner 2026-11-16: "setuju, buatkan PR workflow deploy CTA" (the platform
   session's faster path: the Forge cannot bind or check a Worker that does not exist yet, and native deploy of an
   external organ, ADR-0018, is not built; held: owner 2026-11-25, dynamic-worker budget, "cancel cta sekarang jangn
   pakai forge dulu karena isu budget dynamic worker"). Until it is, `.github/workflows/deploy.yml` deploys a PR merged into `main`
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
   settings may approve those kinds automatically (`auto_approve`, Threads by default; never a custom post) as soon as a
   draft is ready and checked (owner 2026-11-25: "Jendela 0 menit + opsi 3"; it was 15 minutes), unless a person edited
   it; the approval is a person's in every other way (the guardian again, an aged analysis draft expires) and is logged
   as "auto-approve" (`src/agent/auto-approve.mjs`). The scheduled run drafts confirmed chart patterns only ("Only confirmed").
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
   - the system's decisions as a recap without a delay (owner 2026-11-25: "harus realtime", "kamu saja yang kerjakan karena xauusd sedang overload", "Semua sekarang", "Posts juga realtime"; before, only after 24 hours): a decision may be posted as a recap at once (the guardian's `PUBLIC_DELAY_HOURS` "0"; "24" restores the hold), but its price, entry, SL and TP are never posted; the analysis (zones, patterns, structure) in real time. The owner accepted the risk (2026-11-25, about 12:37 UTC, to the orchestrator's question whether posts that close to live can read as a signal service, POJK): "Posts realtime too, risk accepted";
   - no promised return, no account data, never Nexus or Omega, never a secret;
   - chart images are drawn by Cryptophys from the draft's own published numbers only (zones, pattern lines, measured
     projection, price when read), to scale and marked as a schematic; never a price series (candles or a line)
     without a data licence. The home page's live quote stays TradingView's Single Quote widget, in its own frame,
     with its credit (owner 2026-11-27);
   - news is never republished, only our own summary with the source named.
4. **Model-written public text only behind the CTA's guards** (amended 2026-11-25, owner: "amandemen aturan 4 agar
   bisa mengadopsi semua"; before, "No model writes public text"). Fixed templates over the xauusd `PublicProjection`
   (read-only RPC) stay the default. Every skill of the CTA agent (`src/agent/`, the `cta-*` skills) may use the model
   behind `src/agent/router.mjs` (off until the owner turns CTA's Beam row on in the platform's Command, owner 2026-11-27:
   "usulan saya"; the studio's switch only stops it; within its daily cap) to write public text, posts,
   replies, comments and messages included, and each text it writes:
   - is written only from the facts the step hands it (the `PublicProjection`, or the comment it answers, which is
     untrusted), and names no number those facts do not hold;
   - is no advice, signal, forecast, promise or direction call, and carries the disclaimer;
   - passes the guardian, the channel's linter with no FAIL, and the humanizer, then the guardian again;
   - or is not sent: a post falls back to its fixed template, a reply, comment or message is not sent.
   Replies, comments and messages stay within their caps; a message goes only to a person who wrote to us first. A new
   kind of model-written text still needs the owner's word and these guards, and public pages change only with the
   owner's word (rule 3). The humanizer's rewrite at publish (`src/agent/humanizer.mjs`, owner 2026-11-25: "Everything,
   templates too") is a fixed script, not a model: the guardian checks its text again, and the approved text goes out
   if it fails. Approved so far: the replies (rule 2's exception), the weekly audit summary (studio only), and
   cta-write (`src/agent/write.mjs`, owner 2026-11-25: model posts "Yes, with the same guards"): it rewords only the
   body of a fresh template post of the four auto-approve kinds, from that body's own facts (the same numbers, none
   added or dropped, in the same order and each under the same role word and chart, with the same negations and outcome words; no advice, forecast or certainty word the template does not use), keeps the template's first
   line and closing block, and is off until an approver turns it on (studio setting `agent_write`, the kill switch)
   and the About page's sentence about the model carries the owner's words (`about_lede_ok`).
5. **Kernel.** This is an external organ (tier 1, no council seat, `signals.observe` and `reports.publish` only; and one
   agent, `cta-model-router`, with exactly `model_router.status` and `model_router.report_paid`, the platform's `CTA_CEILING`),
   declared in `organism.json` and read by the platform Forge over `EXT_ORGANISM_CTA`. Platform-side changes (the
   origin entry, the bindings, Access paths) go through the platform's own repository and its consensus.
6. **Studio security.** `/studio` and `/api/studio/*` verify the Cloudflare Access JWT in the Worker (fail
   closed). Writes need a person, the same origin and JSON. Pages use no inline script or style (CSP `'self'`).
7. **Tests and CI.** Never skip, disable or weaken a test to get green; no empty commits; re-run a job at most once.
8. **Commits and PRs.** No model identifiers in commits or PRs. Squash-merge with the expected head SHA.
9. **Changelog.** Every merged change gets a line in `docs/CHANGELOG.md`.
