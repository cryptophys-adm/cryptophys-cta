// CTA Studio (behind Cloudflare Access): a dashboard, the content queue, a person's approval or rejection, a dry
// run, performance and channels. Everything goes through /api/studio/* on the same origin; a rejection needs a reason.
// Views are switched by the URL hash (#dashboard, #queue, #create, #performance, #channels). Create writes a post
// (blank or from a template), checked by the guardian per channel as it is typed, and sends it to the queue.
// Library (filters, edit before approval, duplicate), Calendar (per WIB day) and Media (cards and videos). The Channels page edits each
// channel's settings (format, content, drafts per day, schedule in WIB, hashtags); never a token.
(function () {
  const $ = (id) => document.getElementById(id);
  const make = (tag, cls, value) => { const n = document.createElement(tag); if (cls) n.className = cls; if (value != null) n.textContent = value; return n; };
  // UTC clock times in 12-hour form (owner 2026-11-17: "jam UTC seharusnya pakai AM/PM").
  const clock12 = (iso) => { const h = Number(iso.slice(11, 13)); return `${h % 12 || 12}:${iso.slice(14, 16)} ${h < 12 ? "AM" : "PM"}`; };
  const when = (iso) => (iso ? `${iso.slice(0, 10)} ${clock12(iso)} UTC` : "—");
  const LABEL = { pending: "Waiting for you", needs_image: "Needs image", needs_video: "Needs video", blocked: "Held by guardian", approved: "Approved", rejected: "Rejected", published: "Published", failed: "Failed to publish", expired: "Expired (old analysis)" };
  const TONE = { pending: "blue", needs_image: "", needs_video: "", blocked: "red", approved: "amber", rejected: "", published: "green", failed: "red", expired: "" };
  const KIND = { daily_recap: "Daily recap", key_levels: "Key-level map", pattern: "Chart pattern", warroom: "War Room", custom: "Custom post" };
  const FILTERS = ["pending", "needs_image", "needs_video", "blocked", "approved", "published", "rejected", "failed", "expired", ""];
  const VIEWS = ["dashboard", "queue", "create", "library", "calendar", "media", "marketing", "performance", "agent", "channels"];
  const EDITABLE = ["pending", "blocked", "needs_image", "needs_video"];
  let chFilter = "",
    filter = "pending", status = null, canDecide = false, canWrite = false, role = null, perf = null, sched = null;

  async function call(path, method = "GET", body) {
    const res = await fetch(path, { method, credentials: "same-origin", headers: { accept: "application/json", ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.ok === false) throw new Error(data?.error || data?.reason || `HTTP ${res.status}`);
    return data;
  }
  const showErr = (e) => { $("err").textContent = e ? String(e.message || e) : ""; };
  /** Why an approved post did not go out (publishDraft's held codes), in words; null when it went out. */
  const HELD = { publishing_off: "publishing is off", channel_not_publishing: "this channel does not publish yet", waiting_for_slot: "it waits for the channel's next posting slot",
    publisher_not_built: "this channel's publisher is not built yet", account_not_configured: "the channel's account is not connected", not_approved: "the draft is not approved",
    expired: "the analysis is older than 2 hours (the price has moved); make a fresh one from Create" };
  const publishNote = (p) => (!p ? null : p.status === "expired" ? `Expired, not sent: ${HELD.expired}.` : p.status === "published" ? "Published." : p.status === "failed" ? `Publishing failed: ${p.error ?? "see the draft"}` : p.held ? `Approved, not sent: ${HELD[p.held] ?? p.held}${p.next?.wib ? ` (${p.next.wib} WIB)` : ""}.` : null);
  const badge = (tone, value) => make("span", `badge${tone ? ` ${tone}` : ""}`, value);
  const posts = (n) => `${n} post${n === 1 ? "" : "s"}`;
  const fmt = (n) => (n == null ? "–" : n >= 10000 ? `${(n / 1000).toFixed(1)}k` : String(n));
  const initial = (s) => String(s || "?").trim().charAt(0) || "?";

  // ---- views ----
  function show() {
    const v = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "dashboard";
    for (const id of VIEWS) $(`view-${id}`).hidden = id !== v;
    for (const a of $("nav").querySelectorAll("a[data-view]")) a.classList.toggle("on", a.dataset.view === v);
    if (v === "queue") load();
    if (v === "performance") { loadPerformance(); loadGrowth(); }
    if (v === "channels") loadChannels();
    if (v === "create") loadCreate();
    if (v === "library") loadLibrary(true);
    if (v === "calendar") loadCalendar();
    if (v === "media") loadMedia(true);
    if (v === "marketing") loadMarketing();
    if (v === "agent") loadAgent();
  }

  function tile(label, value, meta, link) {
    const t = make("div", "card tile");
    t.appendChild(make("div", "label", label));
    t.appendChild(make("div", "value", value));
    if (meta) t.appendChild(make("div", "meta", meta));
    if (link) { const a = make("a", null, link.text); a.href = link.href; t.appendChild(a); }
    return t;
  }

  /** The channels that publish (PUBLISH_CHANNELS while CONTENT_PUBLISH is "on"). */
  const pubTo = (c) => status?.publish === "on" && (status?.publish_channels ?? []).includes(c);
  const pubList = () => ((status?.publish_channels ?? []).join(", ") || "no channel yet");
  function renderDashboard() {
    const c = status?.counts ?? {};
    const channels = Object.values(status?.channels ?? {});
    const on = status?.publish === "on";
    const notice = $("notice"); notice.textContent = "";
    if (!on) {
      notice.appendChild(svgInfo());
      const d = make("div");
      d.appendChild(make("b", null, "Publishing is off"));
      d.appendChild(make("span", null, "Approved drafts wait; nothing is posted until the owner turns publishing on."));
      notice.appendChild(d);
    } else {
      notice.appendChild(svgInfo());
      const d = make("div");
      d.appendChild(make("b", null, `Publishing on for: ${pubList()}`));
      d.appendChild(make("span", null, "Approved drafts for other channels wait until the owner adds that channel."));
      notice.appendChild(d);
    }
    const tiles = $("tiles"); tiles.textContent = "";
    tiles.appendChild(tile("Waiting for approval", String(c.pending ?? 0), "drafts", { text: "Open the queue", href: "#queue" }));
    tiles.appendChild(tile("Held by guardian", String(c.blocked ?? 0), "drafts that failed a check"));
    tiles.appendChild(tile("Published", String(c.published ?? 0), "all time"));
    tiles.appendChild(tile("Channels connected", `${channels.filter((x) => x.configured).length}/${channels.length}`, "accounts with a token", { text: "See channels", href: "#channels" }));
    $("navpending").textContent = c.pending ? String(c.pending) : "";
  }

  function svgInfo() {
    const ns = "http://www.w3.org/2000/svg";
    const s = document.createElementNS(ns, "svg"); s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("aria-hidden", "true");
    const p = document.createElementNS(ns, "path"); p.setAttribute("fill", "currentColor"); p.setAttribute("d", "M1 21h22L12 2zm12-3h-2v-2h2zm0-4h-2v-4h2z");
    s.appendChild(p); return s;
  }

  function renderStatus() {
    const on = status?.publish === "on";
    const p = $("publish"); p.textContent = on ? `Publishing on: ${pubList()}` : "Publishing off"; p.className = `badge ${on ? "green" : "amber"}`;
    renderDashboard();
  }


  // ---- up next: the scheduler (GET /api/studio/schedule) ----
  const wibLabel = (key) => { const d = new Date(`${key.slice(0, 10)}T00:00:00Z`); return `${d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })} ${key.slice(11)} WIB`; };
  const OUTCOME = { published: "Published", failed: "Failed", empty: "No approved post", claimed: "Running" };
  function renderUpNext() {
    const box = $("upnext"); box.textContent = "";
    const rows = Object.entries(sched?.channels ?? {});
    if (!rows.length) { box.appendChild(make("div", "empty", "No channel is enabled.")); return; }
    const table = make("table", "data");
    const head = make("tr");
    for (const [h, num] of [["Channel"], ["Next slots"], ["Approved, waiting", 1], ["Next post"]]) head.appendChild(make("th", num ? "num" : null, h));
    table.appendChild(make("thead")).appendChild(head);
    const body = table.appendChild(make("tbody"));
    for (const [c, x] of rows) {
      const tr = make("tr");
      tr.appendChild(make("td", null, status?.channels?.[c]?.name ?? c));
      tr.appendChild(make("td", null, x.scheduled ? (x.next.length ? x.next.map((n) => wibLabel(n.wib)).join(" · ") : x.enabled ? "—" : "drafts off") : "At approval (no slots)"));
      tr.appendChild(make("td", "num", String(x.waiting)));
      tr.appendChild(make("td", "meta", x.next_draft ? x.next_draft.text.split("\n")[0] : x.scheduled ? "nothing approved yet" : "—"));
      body.appendChild(tr);
    }
    box.appendChild(table);
    if (sched.publish !== "on") box.appendChild(make("div", "meta pad", "Publishing is off: the slots pass without posting until the owner turns publishing on."));
    if (sched.recent?.length) {
      box.appendChild(make("div", "meta pad", "Latest slots: " + sched.recent.slice(0, 6).map((r) => `${status?.channels?.[r.channel]?.name ?? r.channel} ${wibLabel(r.key.split("@")[1])}: ${OUTCOME[r.outcome] ?? r.outcome}`).join(" · ")));
    }
  }


  // ---- channel accounts: Connect by OAuth, Disconnect, Check (GET /api/studio/connections; POST connect/*) ----
  const shortDate = (iso) => (iso ? iso.slice(0, 10) : "");
  function accountSection(c, conns) {
    const f = field("Account", null);
    const x = conns?.channels?.[c];
    if (!x) { f.appendChild(make("div", "hint", "Connection status not available.")); return f; }
    const line = make("div", "acct");
    if (x.connected && x.via === "oauth") line.appendChild(make("span", "ok", `Connected${x.account_name ? ` as ${x.account_name}` : ""} by OAuth`));
    else if (x.connected && x.via === "studio") line.appendChild(make("span", "ok", `${x.method === "bot" ? "Bot set" : "Token pasted"} in the studio${x.manual?.hint ? ` (${x.manual.hint})` : ""}`));
    else if (x.connected) line.appendChild(make("span", "ok", x.method === "bot" ? "Bot set by the platform" : "Connected by the platform's secrets"));
    else line.appendChild(make("span", "no", "Not connected"));
    f.appendChild(line);
    const meta = [];
    if (x.connected_by) meta.push(`by ${x.connected_by} · ${when(x.connected_at)}`);
    if (x.manual?.updated_by && x.via === "studio") meta.push(`by ${x.manual.updated_by} · ${when(x.manual.updated_at)}`);
    if (x.expires_at) meta.push(`token renews before ${shortDate(x.expires_at)}`);
    if (x.scopes) meta.push(`scopes: ${x.scopes}`);
    if (x.method === "oauth" && x.app_source) meta.push(x.app_source === "studio" ? `app entered in the studio${x.app_hint ? ` (${x.app_hint})` : ""}` : "app set by the platform");
    if (meta.length) f.appendChild(make("div", "hint", meta.join(" · ")));
    const keyMissing = `Encryption key not set — store disabled. The platform sets the Worker secret ${conns.key_secret} once (32 random bytes, base64); then Save and Connect work here.`;
    if (!conns.token_key_set) f.appendChild(make("div", "hint warnline", keyMissing));
    const out = make("div", "hint"); const err = make("div", "err");
    const acts = make("div", "toolbar");
    const forms = make("div", "acctforms");
    // Not an approver: say who is signed in and why, rather than showing nothing to press.
    if (!conns.can_connect) {
      f.append(acts, out, err);
      f.appendChild(make("div", "hint warnline", `Signed in as ${conns.who ?? "?"} (${conns.role ?? "no role"}): only an approver (STUDIO_APPROVERS) connects accounts.`));
      return f;
    }
    // The buttons stay clickable while the key is missing (owner 2026-11-17): each opens its form, which says what is
    // missing; only Save (and the provider sign-in) wait, because nothing is ever stored unencrypted.
    const locked = !conns.token_key_set;
    const after = async (msg) => { out.textContent = msg; await refresh(); await loadChannels(); };
    // One small form at a time: secrets go POST-only to this Worker, are stored encrypted and never shown again.
    const openForm = (title, inputs, onSave, note) => {
      forms.textContent = "";
      const box = make("div", "acctform");
      box.appendChild(make("div", "hint", title));
      if (locked) box.appendChild(make("div", "hint warnline", keyMissing));
      if (note) box.appendChild(note);
      const els = inputs.map((i) => {
        const wrap = make("label", "fld");
        wrap.appendChild(make("span", null, i.label));
        const el = document.createElement("input");
        el.type = i.secret ? "password" : "text"; el.autocomplete = "off"; el.spellcheck = false; el.name = i.name; el.placeholder = i.placeholder || "";
        if (i.optional) el.dataset.optional = "1";
        wrap.appendChild(el); box.appendChild(wrap);
        return el;
      });
      const row = make("div", "toolbar");
      const save = make("button", "btn sm primary", "Save"); save.type = "button"; save.disabled = locked;
      const cancel = make("button", "btn sm outline", "Cancel"); cancel.type = "button";
      cancel.addEventListener("click", () => { forms.textContent = ""; });
      save.addEventListener("click", async () => {
        err.textContent = "";
        const body = Object.fromEntries(els.map((el) => [el.name, el.value.trim()]));
        if (els.some((el) => !el.dataset.optional && !el.value.trim())) { err.textContent = "Fill in every field."; return; }
        save.disabled = true;
        try { const msg = await onSave(body); els.forEach((el) => { el.value = ""; }); forms.textContent = ""; await after(msg); }
        catch (e) { err.textContent = e.message; save.disabled = false; }
      });
      row.append(save, cancel); box.appendChild(row);
      forms.appendChild(box);
      els[0]?.focus();
    };
    const btn = (text, cls, onClick) => { const b = make("button", `btn sm ${cls}`, text); b.type = "button"; b.addEventListener("click", onClick); acts.appendChild(b); return b; };

    if (x.method === "oauth") {
      // Connect: the provider's sign-in, then back here (the tokens go straight to this Worker).
      if (x.app_configured) {
        const go = btn(x.via === "oauth" ? "Reconnect" : "Connect", "primary", async () => {
          if (locked) { err.textContent = keyMissing; return; }
          go.disabled = true; err.textContent = "";
          try { const r = await call("/api/studio/connect/start", "POST", { channel: c }); window.location.assign(r.url); }
          catch (e) { err.textContent = e.message; go.disabled = false; }
        });
        go.title = `Sign in at ${x.provider}; the tokens go straight to this Worker`;
      }
      // Set up app: the OAuth app's id and secret, for the provider's sign-in (or the platform's secrets).
      if (x.app_source !== "platform") {
        btn(x.app_configured ? "Change app" : "Set up app", x.app_configured ? "outline" : "primary", () => {
          const note = make("div", "hint");
          note.appendChild(document.createTextNode(`In the ${x.provider} developer dashboard, create an app and register this redirect URI: `));
          const uri = make("code", null, conns.redirect_uri); note.appendChild(uri);
          const copy = make("button", "btn xs outline", "Copy"); copy.type = "button";
          copy.addEventListener("click", () => navigator.clipboard?.writeText(conns.redirect_uri).then(() => { copy.textContent = "Copied"; }).catch(() => {}));
          note.appendChild(copy);
          if (x.scopes_asked?.length) note.appendChild(make("div", null, `Permissions asked: ${x.scopes_asked.join(", ")}`));
          const [idLabel, secretLabel] = x.app_labels || ["App ID", "App secret"];
          openForm(`${x.provider} app`, [{ name: "app_id", label: idLabel }, { name: "app_secret", label: secretLabel, secret: true }],
            async (b) => { const r = await call("/api/studio/connect/app", "POST", { channel: c, ...b }); return `App saved (${r.hint}). Now press Connect.`; }, note);
        });
        if (x.app_source === "studio") btn("Remove app", "outline", async () => {
          if (!window.confirm(`Remove the ${x.provider} app entered in the studio?`)) return;
          try { await call("/api/studio/connect/app", "POST", { channel: c, clear: true }); await after("App removed."); } catch (e) { err.textContent = e.message; }
        });
      }
      // Paste token: a long-lived token from the provider's dashboard, checked with the provider before it is kept.
      if (x.paste_fields?.length) {
        btn("Paste token", "outline", () => {
          const inputs = [{ name: "access_token", label: "Access token", secret: true }];
          if (x.paste_fields.includes("user_id")) inputs.push({ name: "user_id", label: "Account id (optional: read from the token; for an Instagram EAA... token, the Instagram account id)", optional: true });
          openForm(`Paste a ${x.provider} access token (checked with ${x.provider}, then stored encrypted; never shown again)`, inputs,
            async (b) => { const r = await call("/api/studio/connect/token", "POST", { channel: c, ...b }); return `Token works${r.check?.name ? ` for ${r.check.name}` : ""} and is stored (${r.hint}).`; });
        });
      }
    } else {
      // Telegram: a bot token and the channel's chat id; the bot must be an administrator that can post.
      if (x.app_source !== "platform") {
        btn(x.connected ? "Change bot" : "Set bot", x.connected ? "outline" : "primary", () => {
          openForm("Telegram bot (create it with @BotFather, add it to the channel as an administrator that can post)", [
            { name: "bot_token", label: "Bot token", secret: true },
            { name: "chat_id", label: "Chat id: the chat's @username (letters, digits, _), or for a private chat its -100… number (Telegram Web shows it in the address bar)" }
          ], async (b) => { const r = await call("/api/studio/connect/token", "POST", { channel: c, ...b }); return `Bot ${r.check?.bot ?? ""} can post in ${r.check?.chat ?? "the chat"}; stored (${r.hint}).`; });
        });
      }
    }
    if (x.connected && (x.via === "oauth" || x.via === "studio")) {
      btn("Disconnect", "outline", async () => {
        if (!window.confirm(`Disconnect ${x.name}? Its stored tokens are deleted.`)) return;
        try { await call("/api/studio/connect/disconnect", "POST", { channel: c }); await after("Disconnected."); } catch (e) { err.textContent = e.message; }
      });
    }
    if (x.connected || (x.method === "bot" && x.app_configured)) {
      const chk = btn("Check", "outline", async () => {
        chk.disabled = true; err.textContent = ""; out.textContent = "";
        try {
          const r = await call("/api/studio/connect/check", "POST", { channel: c });
          if (r.ok === false) throw new Error(r.error || "check failed");
          const k = r.check || {};
          out.textContent = c === "telegram" ? `Bot ${k.bot ?? "?"} in ${k.chat ?? "?"}: ${k.can_post ? "can post" : `cannot post. ${k.advice ?? `(${k.status ?? "?"})`}`}` : `Works: ${k.name ?? k.id ?? "account found"}`;
        } catch (e) { err.textContent = e.message; }
        finally { chk.disabled = false; }
      });
    }
    f.append(acts, forms, out, err);
    return f;
  }
  /** After the provider's redirect: say whether the account was connected, then clean the address bar. */
  function oauthNotice() {
    const q = new URLSearchParams(location.search);
    if (!q.has("oauth")) return;
    const name = status?.channels?.[q.get("channel")]?.name ?? q.get("channel") ?? "";
    if (q.get("oauth") === "ok") { const n = $("chnotice"); n.textContent = ""; n.appendChild(make("b", null, `${name} connected. `)); n.appendChild(document.createTextNode("The tokens are stored encrypted; they are never shown.")); }
    else showErr(`${name ? `${name}: ` : ""}not connected (${q.get("reason") || "unknown reason"}).`);
    history.replaceState(null, "", `/studio${location.hash || "#channels"}`);
  }

  // ---- channels: each channel's settings (GET/POST /api/studio/settings) ----
  const FORMAT_NAMES = { text: "Text only", image: "Image", video: "Video" };
  const FORMAT_NOTE = { planned: "planned", na: "not available" };
  const DAY_NAMES = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };

  async function loadChannels() {
    try {
      const [cfg, conns] = await Promise.all([call("/api/studio/settings"), call("/api/studio/connections").catch(() => null)]);
      cfg.connections = conns;
      const n = $("chnotice"); n.textContent = "";
      const line = make("span");
      line.appendChild(make("b", null, "Times are in WIB (UTC+7). "));
      n.appendChild(line);
      line.appendChild(document.createTextNode(status?.publish === "on"
        ? `Publishing on for ${pubList()}; other channels wait. At each slot, the channel's oldest approved post goes out (one per slot). A channel without slots posts at approval.`
        : "Publishing is off: the slots pass without posting and approved posts wait. Once publishing is on, each slot posts the channel's oldest approved post."));
      const box = $("channels"); box.textContent = "";
      for (const c of Object.keys(cfg.settings || {})) box.appendChild(channelCard(c, cfg));
      showErr(null);
      oauthNotice();
    } catch (e) { showErr(e); }
  }

  function field(label, hint) {
    const f = make("div", "field");
    f.appendChild(make("div", "lbl", label));
    if (hint) f.appendChild(make("div", "hint", hint));
    return f;
  }

  function channelCard(c, cfg) {
    const info = status?.channels?.[c] ?? {};
    const edit = Boolean(cfg.can_edit);
    const s = JSON.parse(JSON.stringify(cfg.settings[c]));
    const card = make("article", "card chcard");
    const hd = make("div", "hd");
    hd.appendChild(make("span", "ic", initial(info.name || c)));
    const title = make("div", "grow");
    title.appendChild(make("h2", null, info.name || c));
    const row = make("div", "row");
    row.appendChild(badge(info.configured ? "green" : "amber", info.configured ? "Account connected" : "No account yet"));
    row.appendChild(badge(info.publisher === "built" ? "blue" : "", info.publisher === "built" ? "Publisher ready" : "Publisher later"));
    if (info.enabled === false) row.appendChild(badge("", "Off in the Worker's config"));
    if (info.quota) row.appendChild(badge("", `${info.quota.used}/${info.quota.total ?? "?"} posts today`));
    title.appendChild(row);
    hd.appendChild(title);
    card.appendChild(hd);

    const bd = make("div", "bd");
    bd.appendChild(accountSection(c, cfg.connections));
    const sync = () => card.classList.toggle("off", !s.enabled);
    // On or off
    const sw = make("label", "switch");
    const on = make("input"); on.type = "checkbox"; on.checked = s.enabled; on.disabled = !edit;
    on.addEventListener("change", () => { s.enabled = on.checked; sync(); });
    sw.append(on, make("span", null, "Make drafts for this channel"));
    bd.appendChild(sw);

    // Format
    const ff = field("Format", "What a post on this channel carries. A format our publisher does not post yet is shown as planned.");
    const seg = make("div", "seg"); seg.setAttribute("role", "radiogroup"); seg.setAttribute("aria-label", `${info.name || c} format`);
    for (const f of ["text", "image", "video"]) {
      const allowed = (cfg.formats?.[c] ?? []).includes(f);
      const planned = (cfg.planned?.[c] ?? []).includes(f);
      const b = make("button", f === s.format ? "on" : null, FORMAT_NAMES[f]);
      if (!allowed) b.appendChild(make("small", null, planned ? FORMAT_NOTE.planned : FORMAT_NOTE.na));
      b.type = "button"; b.setAttribute("role", "radio"); b.setAttribute("aria-checked", String(f === s.format));
      b.disabled = !edit || !allowed;
      b.addEventListener("click", () => { s.format = f; for (const x of seg.children) { const sel = x === b; x.classList.toggle("on", sel); x.setAttribute("aria-checked", String(sel)); } });
      seg.appendChild(b);
    }
    ff.appendChild(seg);
    bd.appendChild(ff);

    // Content kinds
    const kf = field("Content", "Which drafts this channel gets.");
    const checks = make("div", "checks");
    for (const k of cfg.kinds ?? []) {
      const l = make("label");
      const i = make("input"); i.type = "checkbox"; i.checked = s.kinds.includes(k); i.disabled = !edit;
      i.addEventListener("change", () => { s.kinds = (cfg.kinds ?? []).filter((x) => (x === k ? i.checked : s.kinds.includes(x))); });
      l.append(i, make("span", null, cfg.kind_names?.[k] ?? k));
      checks.appendChild(l);
    }
    kf.appendChild(checks);
    bd.appendChild(kf);

    // Auto-approve (owner 2026-11-25): the kinds this channel approves by itself, 15 minutes after a draft is ready.
    const af = field("Auto-approve", "A draft of a kind ticked here is approved by itself 15 minutes after it is ready, on a channel that publishes. Until then you can approve, edit or reject it; an edited draft waits for you. The guardian runs again. Never a custom post.");
    const autos = make("div", "checks");
    for (const k of cfg.auto_kinds ?? []) {
      const l = make("label");
      const i = make("input"); i.type = "checkbox"; i.checked = (s.auto_approve ?? []).includes(k); i.disabled = !edit;
      i.addEventListener("change", () => { s.auto_approve = (cfg.auto_kinds ?? []).filter((x) => (x === k ? i.checked : (s.auto_approve ?? []).includes(x))); });
      l.append(i, make("span", null, cfg.auto_kind_names?.[k] ?? k));
      autos.appendChild(l);
    }
    af.appendChild(autos);
    bd.appendChild(af);

    // Daily maximum
    const mf = field("Drafts per day", `At most this many drafts a day (WIB), every kind together; 1 to ${cfg.max_per_day ?? 24}.`);
    const max = make("input", "num"); max.type = "number"; max.min = "1"; max.max = String(cfg.max_per_day ?? 24); max.value = String(s.max_per_day); max.disabled = !edit;
    max.setAttribute("aria-label", "Drafts per day");
    max.addEventListener("input", () => { s.max_per_day = Number(max.value); });
    mf.appendChild(max);
    bd.appendChild(mf);

    // Schedule
    const sf = field("Posting schedule (WIB)", `Up to ${cfg.max_slots ?? 12} slots. Each slot: the days and the time an approved post goes out.`);
    const slots = make("div", "slots");
    const drawSlots = () => {
      slots.textContent = "";
      if (!s.schedule.length) slots.appendChild(make("div", "hint", "No slot yet: approved posts go out right after approval, once publishing is on."));
      s.schedule.forEach((slot, idx) => {
        const r = make("div", "slot");
        const days = make("div", "days");
        for (const d of cfg.days ?? []) {
          const b = make("button", slot.days.includes(d) ? "on" : null, DAY_NAMES[d] ?? d);
          b.type = "button"; b.disabled = !edit; b.setAttribute("aria-pressed", String(slot.days.includes(d)));
          b.addEventListener("click", () => {
            slot.days = slot.days.includes(d) ? slot.days.filter((x) => x !== d) : (cfg.days ?? []).filter((x) => x === d || slot.days.includes(x));
            b.classList.toggle("on", slot.days.includes(d)); b.setAttribute("aria-pressed", String(slot.days.includes(d)));
          });
          days.appendChild(b);
        }
        const t = make("input", "time"); t.type = "time"; t.value = slot.time; t.disabled = !edit; t.setAttribute("aria-label", "Time (WIB)");
        t.addEventListener("input", () => { slot.time = t.value; });
        r.append(days, t, make("span", "meta", "WIB"), make("span", "grow"));
        if (edit) {
          const rm = make("button", "btn sm outline", "Remove"); rm.type = "button";
          rm.addEventListener("click", () => { s.schedule.splice(idx, 1); drawSlots(); });
          r.appendChild(rm);
        }
        slots.appendChild(r);
      });
      if (edit && s.schedule.length < (cfg.max_slots ?? 12)) {
        const add = make("button", "btn sm outline", "Add slot"); add.type = "button";
        add.addEventListener("click", () => { s.schedule.push({ days: ["mon", "tue", "wed", "thu", "fri"], time: "19:00" }); drawSlots(); });
        slots.appendChild(add);
      }
    };
    drawSlots();
    sf.appendChild(slots);
    const sx = sched?.channels?.[c];
    if (sx?.scheduled) sf.appendChild(make("div", "hint", `Next: ${sx.next.length ? sx.next.map((n) => wibLabel(n.wib)).join(" · ") : "—"} · ${sx.waiting} approved waiting`));
    bd.appendChild(sf);

    // Hashtags
    const hf = field("Hashtags", "Up to 8, each starting with #. The guardian checks the draft again with them.");
    const tags = make("input", "text"); tags.type = "text"; tags.value = s.hashtags; tags.disabled = !edit; tags.maxLength = 200; tags.setAttribute("aria-label", "Hashtags");
    tags.addEventListener("input", () => { s.hashtags = tags.value; });
    hf.appendChild(tags);
    bd.appendChild(hf);
    card.appendChild(bd);

    const ft = make("div", "ft");
    const meta = cfg.meta?.[c];
    ft.appendChild(make("span", "grow", meta ? `Last changed by ${meta.updated_by} · ${when(meta.updated_at)}` : "Default settings"));
    const msg = make("span", "saved");
    const err = make("span", "err");
    ft.append(err, msg);
    if (edit) {
      const save = make("button", "btn primary", "Save"); save.type = "button";
      save.addEventListener("click", async () => {
        save.disabled = true; err.textContent = ""; msg.textContent = "";
        try {
          const r = await call("/api/studio/settings", "POST", { channel: c, settings: s });
          msg.textContent = "Saved";
          ft.firstChild.textContent = `Last changed by you · ${when(r.updated_at)}`;
        } catch (e) { err.textContent = e.message; }
        finally { save.disabled = false; }
      });
      ft.appendChild(save);
    }
    card.appendChild(ft);
    sync();
    return card;
  }

  // ---- content queue ----
  /** The queue by channel (owner 2026-11-17): one tab per channel, then the status tabs within it. */
  function renderChannelTabs(byChannel) {
    const tabs = $("chtabs"); tabs.textContent = "";
    const total = (c) => Object.values(byChannel?.[c] ?? {}).reduce((a, n) => a + n, 0);
    const waiting = (c) => (byChannel?.[c]?.pending ?? 0);
    const chans = Object.keys(status?.channels ?? {}).filter((c) => status.channels[c].enabled || total(c));
    for (const c of ["", ...chans]) {
      const b = make("button", `tab${c === chFilter ? " on" : ""}`, c ? (status.channels[c]?.name ?? c) : "All channels");
      b.type = "button"; b.setAttribute("role", "tab"); b.setAttribute("aria-selected", String(c === chFilter));
      if (c) { b.appendChild(make("span", "c", String(waiting(c)))); b.title = `${waiting(c)} waiting for you · ${total(c)} in all`; }
      b.addEventListener("click", () => { chFilter = c; load(); });
      tabs.appendChild(b);
    }
  }
  function renderTabs(counts) {
    const tabs = $("tabs"); tabs.textContent = "";
    for (const f of FILTERS) {
      const b = make("button", `tab${f === filter ? " on" : ""}`, f ? LABEL[f] : "All");
      b.type = "button"; b.setAttribute("role", "tab"); b.setAttribute("aria-selected", String(f === filter));
      if (f) b.appendChild(make("span", "c", String(counts?.[f] ?? 0)));
      b.addEventListener("click", () => { filter = f; load(); });
      tabs.appendChild(b);
    }
  }

  function metricsLine(m) {
    return [["views", "views"], ["likes", "likes"], ["comments", "comments"], ["shares", "shares"], ["saves", "saves"], ["reposts", "reposts"]]
      .filter(([k]) => m[k] != null).map(([k, label]) => `${fmt(m[k])} ${label}`).join(" · ") || "no metrics yet";
  }

  function draftCard(d) {
    const card = make("article", "draft");
    const head = make("div", "row");
    head.appendChild(badge(TONE[d.status] ?? "", LABEL[d.status] ?? d.status));
    head.appendChild(badge("purple", status?.channels?.[d.channel]?.name ?? d.channel));
    head.appendChild(make("span", "badge plain", KIND[d.kind] ?? d.kind));
    // Under the channel's auto-approve rule (src/agent/auto-approve.mjs): when it goes out by itself, unless a person acts first.
    if (d.status === "pending" && d.auto_at) head.appendChild(badge("blue", `Auto-approves ${clock12(d.auto_at)} UTC`));
    head.appendChild(make("span", "grow"));
    const limit = { threads: 500, instagram: 2200, x: 280, telegram: 4096, youtube: 5000, tiktok: 2200 }[d.channel];
    head.appendChild(make("span", "meta count", `${d.text.length}${limit ? `/${limit}` : ""} characters · ${when(d.created_at)}`));
    card.appendChild(head);
    card.appendChild(make("div", "text", d.text));
    // The Instagram card (TradingView's chart and the Cryptophys panel), as Instagram will get it.
    const media = /\/media\/([0-9a-f]{32})\.(jpg|webm)$/.exec(d.image_url || "");
    if (media && media[2] === "jpg") { const img = make("img", "cardimg"); img.alt = "Instagram card"; img.loading = "lazy"; img.src = `/api/studio/media?id=${media[1]}`; card.appendChild(img); }
    // The YouTube Shorts / TikTok video (9:16), as the platform will get it.
    if (media && media[2] === "webm") { const v = make("video", "cardvid"); v.controls = true; v.preload = "metadata"; v.muted = true; v.src = `/api/studio/media?id=${media[1]}`; card.appendChild(v); }
    const g = d.guardian || {};
    card.appendChild(make("div", `check ${g.pass ? "ok" : (g.failures || []).length ? "bad" : ""}`, g.pass ? "✓ Guardian: every check passed" : `Guardian: ${(g.failures || []).map((f) => `${f.check} (${f.detail})`).join(", ") || "not checked yet"}`));
    if (d.decided_by) card.appendChild(make("div", "meta", `Decided by ${d.decided_by}${d.decision_reason ? ` · ${d.decision_reason}` : ""}`));
    if (d.remote_id) card.appendChild(make("div", "meta", `Post ID: ${d.remote_id}`));
    // The post's own metrics, read once a day from the platform (Threads, Instagram, YouTube; X when enabled).
    if (d.metrics) card.appendChild(make("div", "meta metrics", metricsLine(d.metrics) + (d.metrics_at ? ` · read ${when(d.metrics_at)}` : "")));
    if (d.error) card.appendChild(make("div", "err", d.error));
    const err = make("div", "err");
    const dry = make("pre", "dry"); dry.hidden = true;
    const actions = make("div", "actions");
    if (d.status === "pending" && canDecide) {
      const reason = make("input", "reason"); reason.placeholder = "Reason (required to reject)"; reason.setAttribute("aria-label", "Reason");
      const no = make("button", "btn danger", "Reject"); no.type = "button";
      const slotted = sched?.channels?.[d.channel]?.scheduled;
      const ok = make("button", "btn primary", !pubTo(d.channel) ? (status?.publish !== "on" ? "Approve (publishing off)" : "Approve (this channel does not publish yet)") : slotted ? "Approve (posts at the next slot)" : "Approve & publish"); ok.type = "button";
      const decide = async (decision) => {
        if (decision === "reject" && !reason.value.trim()) { err.textContent = "a reason is required to reject"; return; }
        ok.disabled = no.disabled = true;
        try { const r = await call("/api/studio/decide", "POST", { id: d.id, decision, reason: reason.value.trim() }); await refresh(); const m = r?.status === "expired" ? `Expired, not approved: ${HELD.expired}.` : publishNote(r?.publish); if (m) showErr(m); }
        catch (e) { err.textContent = e.message; ok.disabled = no.disabled = false; }
      };
      ok.addEventListener("click", () => decide("approve"));
      no.addEventListener("click", () => decide("reject"));
      actions.append(reason, no, ok);
    }
    // Expired (owner 2026-11-17: "kadaluwarsa otomatis"): an analysis older than 2 hours never goes out; a fresh one is
    // made from Create with the latest analysis.
    if (d.status === "expired" && canWrite) {
      const fresh = make("button", "btn primary", "Make a fresh one"); fresh.type = "button";
      fresh.title = "Open Create with the same kind, filled from the latest analysis";
      fresh.addEventListener("click", () => { cs.kind = d.kind; cs.ref = null; cs.started = false; location.hash = "#create"; show(); });
      actions.append(fresh);
    }
    // Publish now: an approved post that waits (approved while publishing was off, or between slots), or a failed one
    // tried again. An approver, on a channel that publishes.
    if ((d.status === "approved" || d.status === "failed") && canDecide && pubTo(d.channel)) {
      const now = make("button", "btn primary", d.status === "failed" ? "Try again now" : "Publish now"); now.type = "button";
      now.addEventListener("click", async () => {
        if (!window.confirm(`Send this post to ${status?.channels?.[d.channel]?.name ?? d.channel} now?`)) return;
        now.disabled = true; err.textContent = "";
        try {
          const r = await call("/api/studio/publish-now", "POST", { id: d.id });
          if (r.ok === false && r.error) throw new Error(r.error);
          await refresh(); showErr(publishNote(r));
        } catch (e) { err.textContent = e.message; now.disabled = false; }
      });
      actions.append(now);
    }
    const note = make("div", "note");
    if (canWrite && EDITABLE.includes(d.status)) {
      const edit = make("button", "btn outline", "Edit"); edit.type = "button";
      edit.addEventListener("click", () => {
        const textEl = card.querySelector(".text");
        if (!textEl || card.querySelector(".editbox")) return;
        const box = make("div", "editbox");
        const ta = make("textarea", "editor"); ta.value = d.text; ta.setAttribute("aria-label", "Draft text");
        const row = make("div", "actions");
        const cancel = make("button", "btn outline", "Cancel"); cancel.type = "button";
        const save = make("button", "btn primary", "Save (guardian checks again)"); save.type = "button";
        cancel.addEventListener("click", () => { box.replaceWith(textEl); });
        save.addEventListener("click", async () => {
          save.disabled = true; err.textContent = "";
          try {
            const res = await fetch("/api/studio/edit", { method: "POST", credentials: "same-origin", headers: { accept: "application/json", "content-type": "application/json" }, body: JSON.stringify({ id: d.id, text: ta.value }) });
            const r = await res.json().catch(() => ({}));
            if (!res.ok || !r.ok) throw new Error(r.guardian ? `${r.error}: ${r.guardian.failures.map((f) => `${f.check} (${f.detail})`).join(", ")}` : r.error || `HTTP ${res.status}`);
            await reloadCurrent();
          } catch (e) { err.textContent = e.message; save.disabled = false; }
        });
        row.append(cancel, save);
        box.append(ta, row);
        textEl.replaceWith(box);
      });
      actions.appendChild(edit);
    }
    if (canWrite) {
      const dup = make("button", "btn outline", "Duplicate"); dup.type = "button"; dup.title = "Copy this post as a new draft (checked again, waits for approval)";
      dup.addEventListener("click", async () => {
        dup.disabled = true; err.textContent = "";
        try { const r = await call("/api/studio/duplicate", "POST", { id: d.id }); note.textContent = `Copied as a new draft: ${r.id} (${LABEL[r.status] ?? r.status}).`; await refresh(); }
        catch (e) { err.textContent = e.message; }
        finally { dup.disabled = false; }
      });
      actions.appendChild(dup);
    }
    const preview = make("button", "btn outline", "Dry run"); preview.type = "button";
    preview.addEventListener("click", async () => {
      try { dry.textContent = JSON.stringify(await call(`/api/studio/preview?id=${encodeURIComponent(d.id)}`), null, 2); dry.hidden = false; }
      catch (e) { err.textContent = e.message; }
    });
    actions.appendChild(preview);
    card.append(actions, note, err, dry);
    return card;
  }

  async function load() {
    try {
      const qs = new URLSearchParams();
      if (filter) qs.set("status", filter);
      if (chFilter) qs.set("channel", chFilter);
      const q = await call(`/api/studio/drafts${qs.toString() ? `?${qs}` : ""}`);
      canDecide = Boolean(q.can_decide);
      renderChannelTabs(q.by_channel);
      renderTabs(chFilter ? (q.by_channel?.[chFilter] ?? {}) : q.counts);
      const box = $("queue"); box.textContent = "";
      const drafts = q.drafts || [];
      const where = chFilter ? ` for ${status?.channels?.[chFilter]?.name ?? chFilter}` : "";
      if (!drafts.length) { box.appendChild(make("div", "empty", filter ? `No drafts${where} are “${LABEL[filter].toLowerCase()}”.` : `No drafts${where} yet.`)); return; }
      let day = "";
      for (const d of drafts) {
        const dd = String(d.created_at).slice(0, 10);
        if (dd !== day) { day = dd; box.appendChild(make("div", "daygroup", day)); }
        box.appendChild(draftCard(d));
      }
      showErr(null);
    } catch (e) { showErr(e); }
  }





  // ---- growth: best times, A/B tests, evergreen (GET /api/studio/growth) ----
  const DAY_LONG = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" };
  async function addSlot(channel, day, time) {
    const cfg = await call("/api/studio/settings");
    const s = cfg.settings[channel];
    if (s.schedule.some((x) => x.time === time && x.days.includes(day))) return "already in the schedule";
    await call("/api/studio/settings", "POST", { channel, settings: { ...s, schedule: [...s.schedule, { days: [day], time }] } });
    return "added to the schedule";
  }
  async function loadGrowth() {
    try {
      const g = await call("/api/studio/growth");
      const bt = $("besttimes"); bt.textContent = "";
      const chans = Object.entries(g.best_times ?? {});
      if (!chans.some(([, x]) => x.best.length)) bt.appendChild(make("div", "empty", `Not enough measured posts yet (${g.measured} measured; an hour needs two). Metrics are read once publishing is on.`));
      else {
        const table = make("table", "data");
        const head = make("tr");
        for (const h of ["Channel", "When (WIB)", "Posts", "Avg views", "Avg engagement", ""]) head.appendChild(make("th", null, h));
        table.appendChild(make("thead")).appendChild(head);
        const body = table.appendChild(make("tbody"));
        for (const [c, x] of chans) for (const b of x.best) {
          const tr = make("tr");
          tr.appendChild(make("td", null, status?.channels?.[c]?.name ?? c));
          tr.appendChild(make("td", null, `${DAY_LONG[b.day]} ${b.time}`));
          tr.appendChild(make("td", null, String(b.posts)));
          tr.appendChild(make("td", null, fmt(b.views)));
          tr.appendChild(make("td", null, String(b.engagement)));
          const td = make("td");
          if (canDecide) {
            const add = make("button", "btn sm outline", "Add to schedule"); add.type = "button";
            add.addEventListener("click", async () => { add.disabled = true; try { add.textContent = await addSlot(c, b.day, b.time); } catch (e) { add.textContent = e.message; } });
            td.appendChild(add);
          }
          tr.appendChild(td);
          body.appendChild(tr);
        }
        bt.appendChild(table);
      }
      const ab = $("abtests"); ab.textContent = "";
      if (!g.ab.length) ab.appendChild(make("div", "empty", "No A/B test yet. On the Create page, add a variant B to a channel."));
      for (const t of g.ab) {
        const card = make("article", "draft");
        const row = make("div", "row");
        row.appendChild(badge("purple", status?.channels?.[t.channel]?.name ?? t.channel));
        row.appendChild(badge(t.state === "measured" ? "green" : "", t.state === "measured" ? (t.winner === "tie" ? "Tie" : `Winner: ${t.winner}`) : "Waiting for both to be published and measured"));
        row.appendChild(make("span", "grow"));
        row.appendChild(make("span", "meta", when(t.created_at)));
        card.appendChild(row);
        for (const [v, x, txt] of [["A", t.a, t.text_a], ["B", t.b, t.text_b]]) {
          card.appendChild(make("div", "meta", `${v}: ${LABEL[x?.status] ?? x?.status ?? "?"}${x?.views ? ` · ${fmt(x.views)} views` : ""}${x?.engagement ? ` · ${x.engagement} engagement` : ""}${x?.rate != null ? ` · ${x.rate}% per view` : ""}`));
          card.appendChild(make("div", "text", txt ?? ""));
        }
        ab.appendChild(card);
      }
      const ev = $("evergreen"); ev.textContent = "";
      if (!g.evergreen.length) ev.appendChild(make("div", "empty", "No suggestion yet: custom posts qualify 30 days after publishing, once measured."));
      for (const p of g.evergreen) {
        const card = make("article", "draft");
        const row = make("div", "row");
        row.appendChild(badge("purple", status?.channels?.[p.channel]?.name ?? p.channel));
        row.appendChild(make("span", "meta", `${fmt(p.views)} views · ${p.engagement} engagement · published ${when(p.published_at)}`));
        card.appendChild(row);
        card.appendChild(make("div", "text", p.text));
        if (canWrite) {
          const dup = make("button", "btn outline", "Duplicate to the queue"); dup.type = "button";
          dup.addEventListener("click", async () => { dup.disabled = true; try { const r = await call("/api/studio/duplicate", "POST", { id: p.id }); dup.textContent = `Copied: ${LABEL[r.status] ?? r.status}`; } catch (e) { dup.textContent = e.message; } });
          const a = make("div", "actions"); a.appendChild(dup); card.appendChild(a);
        }
        ev.appendChild(card);
      }
    } catch (e) { showErr(e); }
  }

  // ---- marketing: tracked links, hashtag sets, content mix ----
  const KIND_ALL = { ...KIND };
  let mk = { links: [], sets: [], wired: false };
  function renderMix(m) {
    const box = $("mixnow"); box.textContent = "";
    box.appendChild(make("div", "meta", `${m.total} approved or published post${m.total === 1 ? "" : "s"} this week (from ${when(m.week.from)}). Bar: actual; line: target.`));
    for (const k of m.kinds) {
      const row = make("div", "mixrow");
      row.appendChild(make("span", null, KIND_ALL[k.kind] ?? k.kind));
      const bar = make("div", "mixbar");
      const act = make("span", "act"); act.style.width = `${Math.min(100, k.actual)}%`;
      const tgt = make("span", "tgt"); tgt.style.left = `${Math.min(100, k.target)}%`;
      bar.append(act, tgt);
      row.appendChild(bar);
      row.appendChild(make("span", `meta${Math.abs(k.gap) >= 15 && m.total ? " warn" : ""}`, `${k.actual}% / ${k.target}%`));
      box.appendChild(row);
    }
    renderMixEdit(m);
  }
  function renderMixEdit(m) {
    const box = $("mixedit"); if (!box) return;
    box.textContent = "";
    for (const k of m.kinds) {
      box.appendChild(make("label", null, KIND_ALL[k.kind] ?? k.kind));
      const i = make("input", "num"); i.type = "number"; i.min = "0"; i.max = "100"; i.value = String(k.target); i.dataset.kind = k.kind; i.disabled = !canDecide;
      i.setAttribute("aria-label", `${KIND_ALL[k.kind] ?? k.kind} target (%)`);
      box.appendChild(i);
    }
    $("mixmeta").textContent = m.updated_by ? `Last changed by ${m.updated_by} · ${when(m.updated_at)}` : "Default targets";
  }
  async function loadMarketing() {
    if (!mk.wired) {
      mk.wired = true;
      $("laddbtn").addEventListener("click", async () => {
        $("lerr").textContent = "";
        try { await call("/api/studio/links", "POST", { target: $("ltarget").value.trim(), campaign: $("lcampaign").value.trim(), label: $("llabel").value.trim() }); $("ltarget").value = ""; $("llabel").value = ""; await loadMarketing(); }
        catch (e) { $("lerr").textContent = e.message; }
      });
      $("haddbtn").addEventListener("click", async () => {
        $("herr").textContent = "";
        try { await call("/api/studio/hashtag-sets", "POST", { name: $("hname").value.trim(), tags: $("htags").value.trim() }); $("hname").value = ""; $("htags").value = ""; await loadMarketing(); }
        catch (e) { $("herr").textContent = e.message; }
      });
      $("mixsave").addEventListener("click", async () => {
        $("mixerr").textContent = ""; $("mixsaved").textContent = "";
        const targets = {}; for (const i of $("mixedit").querySelectorAll("input")) targets[i.dataset.kind] = Number(i.value);
        try { await call("/api/studio/mix", "POST", { targets }); $("mixsaved").textContent = "Saved"; renderMix(await call("/api/studio/mix")); }
        catch (e) { $("mixerr").textContent = e.message; }
      });
      for (const id of ["laddbtn", "haddbtn"]) $(id).disabled = !canWrite;
      $("mixsave").disabled = !canDecide;
    }
    try {
      const [l, h, m] = await Promise.all([call("/api/studio/links"), call("/api/studio/hashtag-sets"), call("/api/studio/mix")]);
      mk.links = l.links; mk.sets = h.sets;
      $("lhosts").textContent = l.hosts.join(", ");
      const box = $("linklist"); box.textContent = "";
      if (!l.links.length) box.appendChild(make("div", "empty", "No tracked link yet."));
      for (const x of l.links) {
        const row = make("div", "linkrow");
        const top = make("div", "top");
        top.appendChild(make("b", null, x.label));
        top.appendChild(badge("blue", x.campaign));
        top.appendChild(make("span", "grow"));
        top.appendChild(make("span", "meta", `${x.total} click${x.total === 1 ? "" : "s"}${Object.keys(x.clicks).length ? " · " + Object.entries(x.clicks).map(([c, n]) => `${status?.channels?.[c]?.name ?? c} ${n}`).join(", ") : ""}`));
        row.appendChild(top);
        row.appendChild(make("div", "meta", `→ ${x.target}`));
        const shorts = make("div", "shorts");
        for (const [c, u] of Object.entries(x.short)) {
          const b = make("button", "btn sm outline", `Copy for ${status?.channels?.[c]?.name ?? c}`); b.type = "button"; b.title = u;
          b.addEventListener("click", async () => { try { await navigator.clipboard.writeText(u); b.textContent = "Copied"; } catch { b.textContent = u; } });
          shorts.appendChild(b);
        }
        row.appendChild(shorts);
        box.appendChild(row);
      }
      const sets = $("setlist"); sets.textContent = "";
      if (!h.sets.length) sets.appendChild(make("div", "empty", "No hashtag set yet."));
      for (const x of h.sets) {
        const row = make("div", "setrow");
        row.appendChild(make("b", null, x.name));
        row.appendChild(make("span", "grow", x.tags));
        if (canWrite) {
          const rm = make("button", "btn sm outline", "Remove"); rm.type = "button";
          rm.addEventListener("click", async () => { try { await call("/api/studio/hashtag-sets", "POST", { name: x.name, remove: true }); await loadMarketing(); } catch (e) { $("herr").textContent = e.message; } });
          row.appendChild(rm);
        }
        sets.appendChild(row);
      }
      renderMix(m);
      showErr(null);
    } catch (e) { showErr(e); }
  }
  /** The Create page's tools for one channel's editor: a tracked link at the cursor, a hashtag set as the last line. */
  async function editorTools(c, ta, onChange) {
    if (!mk.links.length && !mk.sets.length) {
      try { const [l, h] = await Promise.all([call("/api/studio/links"), call("/api/studio/hashtag-sets")]); mk.links = l.links; mk.sets = h.sets; } catch { /* tools stay empty */ }
    }
    const bar = make("div", "toolbar");
    const ls = make("select", "select"); ls.setAttribute("aria-label", "Insert a tracked link");
    const l0 = make("option", null, mk.links.length ? "Insert tracked link…" : "No tracked link (Marketing page)"); l0.value = ""; ls.appendChild(l0);
    for (const x of mk.links) { const o = make("option", null, `${x.label} (${x.campaign})`); o.value = x.short[c] ?? ""; ls.appendChild(o); }
    ls.addEventListener("change", () => {
      if (!ls.value) return;
      const at = ta.selectionStart ?? ta.value.length;
      ta.value = `${ta.value.slice(0, at)}${ls.value}${ta.value.slice(at)}`;
      ls.value = ""; onChange();
    });
    const hs = make("select", "select"); hs.setAttribute("aria-label", "Use a hashtag set");
    const h0 = make("option", null, mk.sets.length ? "Use hashtag set…" : "No hashtag set (Marketing page)"); h0.value = ""; hs.appendChild(h0);
    for (const x of mk.sets) { const o = make("option", null, `${x.name}: ${x.tags}`); o.value = x.tags; hs.appendChild(o); }
    hs.addEventListener("change", () => {
      if (!hs.value) return;
      const lines = ta.value.replace(/\s+$/, "").split("\n");
      if (lines.length && /^(#\w+\s*)+$/.test(lines[lines.length - 1].trim())) lines[lines.length - 1] = hs.value; else lines.push(hs.value);
      ta.value = lines.join("\n"); hs.value = ""; onChange();
    });
    bar.append(ls, hs);
    return bar;
  }

  // ---- library, calendar, media ----
  const lib = { offset: 0, total: 0, wired: false, timer: null };
  async function reloadCurrent() { if (!$("view-library").hidden) await loadLibrary(true); else await refresh(); }

  function option(sel, value, label) { const o = make("option", null, label); o.value = value; sel.appendChild(o); }
  function wireLibrary() {
    if (lib.wired) return;
    lib.wired = true;
    option($("lstatus"), "", "Any status"); for (const f of FILTERS.filter(Boolean)) option($("lstatus"), f, LABEL[f]);
    option($("lchannel"), "", "Any channel"); for (const [c, x] of Object.entries(status?.channels ?? {})) option($("lchannel"), c, x.name);
    option($("lkind"), "", "Any type"); for (const [k, label] of Object.entries(KIND)) option($("lkind"), k, label);
    for (const id of ["lstatus", "lchannel", "lkind", "lfrom", "lto"]) $(id).addEventListener("change", () => loadLibrary(true));
    $("lq").addEventListener("input", () => { clearTimeout(lib.timer); lib.timer = setTimeout(() => loadLibrary(true), 350); });
    $("lclear").addEventListener("click", () => { for (const id of ["lq", "lstatus", "lchannel", "lkind", "lfrom", "lto"]) $(id).value = ""; loadLibrary(true); });
    $("lmore").addEventListener("click", () => loadLibrary(false));
  }

  async function loadLibrary(reset) {
    wireLibrary();
    if (reset) lib.offset = 0;
    const q = new URLSearchParams();
    for (const [id, key] of [["lq", "q"], ["lstatus", "status"], ["lchannel", "channel"], ["lkind", "kind"], ["lfrom", "from"], ["lto", "to"]]) if ($(id).value) q.set(key, $(id).value);
    if (lib.offset) q.set("offset", String(lib.offset));
    try {
      const r = await call(`/api/studio/library?${q}`);
      canWrite = canWrite && r.can_edit !== false;
      const box = $("library");
      if (reset) box.textContent = "";
      lib.total = r.total; lib.offset = r.offset + r.drafts.length;
      $("lcount").textContent = `${r.total} draft${r.total === 1 ? "" : "s"}`;
      if (!r.drafts.length && reset) box.appendChild(make("div", "empty", "Nothing matches these filters."));
      let day = box.dataset.day && !reset ? box.dataset.day : "";
      for (const d of r.drafts) {
        const dd = String(d.created_at).slice(0, 10);
        if (dd !== day) { day = dd; box.appendChild(make("div", "daygroup", day)); }
        box.appendChild(draftCard(d));
      }
      box.dataset.day = day;
      $("lmore").hidden = lib.offset >= lib.total;
      showErr(null);
    } catch (e) { showErr(e); }
  }

  const cal = { month: null };
  const wibNow = () => new Date(Date.now() + 7 * 3_600_000).toISOString();
  function shiftMonth(m, by) { const [y, mo] = m.split("-").map(Number); const d = new Date(Date.UTC(y, mo - 1 + by, 1)); return d.toISOString().slice(0, 7); }
  async function loadCalendar() {
    if (!cal.month) {
      cal.month = wibNow().slice(0, 7);
      $("calprev").addEventListener("click", () => { cal.month = shiftMonth(cal.month, -1); loadCalendar(); });
      $("calnext").addEventListener("click", () => { cal.month = shiftMonth(cal.month, 1); loadCalendar(); });
    }
    try {
      const r = await call(`/api/studio/calendar?month=${cal.month}`);
      const [y, m] = cal.month.split("-").map(Number);
      $("calmonth").textContent = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
      const box = $("cal"); box.textContent = "";
      for (const d of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) box.appendChild(make("div", "dow", d));
      const first = new Date(Date.UTC(y, m - 1, 1));
      const lead = (first.getUTCDay() + 6) % 7;
      const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const today = wibNow().slice(0, 10);
      for (let i = 0; i < lead; i++) box.appendChild(make("div", "day out"));
      for (let n = 1; n <= days; n++) {
        const iso = `${cal.month}-${String(n).padStart(2, "0")}`;
        const x = r.days?.[iso];
        const cell = make("button", `day${iso === today ? " today" : ""}`); cell.type = "button";
        cell.setAttribute("aria-label", `${iso}: ${x ? `${x.created} drafted, ${x.published} published` : "nothing"}`);
        cell.appendChild(make("span", "dn", String(n)));
        if (x?.created) cell.appendChild(make("span", "chip c", `${x.created} drafted`));
        if (x?.published) cell.appendChild(make("span", "chip p", `${x.published} published`));
        if (x) cell.appendChild(make("span", "chs", Object.keys(x.channels).map((c) => status?.channels?.[c]?.name ?? c).join(" · ")));
        cell.addEventListener("click", () => { wireLibrary(); for (const id of ["lq", "lstatus", "lchannel", "lkind"]) $(id).value = ""; $("lfrom").value = iso; $("lto").value = iso; location.hash = "#library"; });
        box.appendChild(cell);
      }
      const tail = (7 - ((lead + days) % 7)) % 7;
      for (let i = 0; i < tail; i++) box.appendChild(make("div", "day out"));
      showErr(null);
    } catch (e) { showErr(e); }
  }

  const med = { offset: 0, wired: false };
  async function loadMedia(reset) {
    if (!med.wired) { med.wired = true; $("mmore").addEventListener("click", () => loadMedia(false)); }
    if (reset) med.offset = 0;
    try {
      const r = await call(`/api/studio/media-library${med.offset ? `?offset=${med.offset}` : ""}`);
      const box = $("medialist");
      if (reset) box.textContent = "";
      med.offset = r.offset + r.media.length;
      if (!r.media.length && reset) box.appendChild(make("div", "card empty", "No card or video yet."));
      for (const m of r.media) {
        const t = make("div", "card mtile");
        const video = m.content_type === "video/webm";
        const el = make(video ? "video" : "img");
        if (video) { el.controls = true; el.preload = "metadata"; el.muted = true; } else { el.alt = `${status?.channels?.[m.channel]?.name ?? m.channel} card`; el.loading = "lazy"; }
        el.src = `/api/studio/media?id=${m.id}`;
        t.appendChild(el);
        const row = make("div", "row");
        row.appendChild(badge("purple", status?.channels?.[m.channel]?.name ?? m.channel ?? "?"));
        if (m.status) row.appendChild(badge(TONE[m.status] ?? "", LABEL[m.status] ?? m.status));
        t.appendChild(row);
        t.appendChild(make("div", "meta", `${KIND[m.kind] ?? m.kind ?? ""} · ${(m.bytes / 1024).toFixed(0)} KB · ${when(m.created_at)}`));
        const a = make("a", null, "Open its draft"); a.href = "#library";
        a.addEventListener("click", () => { wireLibrary(); for (const id of ["lstatus", "lchannel", "lkind", "lfrom", "lto"]) $(id).value = ""; $("lq").value = m.draft_id; });
        t.appendChild(a);
        box.appendChild(t);
      }
      $("mmore").hidden = med.offset >= r.total;
      showErr(null);
    } catch (e) { showErr(e); }
  }

  // ---- create: a person's post, per channel, checked as it is typed (GET templates, POST check, POST compose) ----
  const CREATE_KINDS = [["custom", "Custom post"], ["key_levels", "Key-level map"], ["pattern", "Chart pattern"], ["daily_recap", "Daily recap"], ["warroom", "War Room"]];
  /** The kinds with a choice under them: a pattern, or the War Room's source (owner 2026-11-18). */
  const OPTION_LABEL = { pattern: "Pattern", warroom: "Source" };
  const MEDIA_NOTE = { image: "The chart card (TradingView's chart with our levels, and the Cryptophys panel) is made after saving.", video: "The 9:16 video made from the chart card is made after saving." };
  const FORMAT_BADGE = { none: "Text only", text: "Text only", image: "Image card", video: "Video" };
  const cs = { kind: "custom", ref: null, chosen: null, texts: {}, textsB: {}, results: {}, timers: {}, formats: {}, started: false, dirty: false };
  /** The format of this channel's post: a person's choice here, else the channel's setting (owner 2026-11-17). */
  const formatOf = (c) => cs.formats[c] ?? status?.channels?.[c]?.format ?? "text";

  function createChannels() { return Object.entries(status?.channels ?? {}).filter(([, c]) => c.enabled).map(([id]) => id); }

  async function loadCreate() {
    if (cs.started) return;
    cs.started = true;
    const all = createChannels();
    cs.chosen = new Set(all.slice(0, 1));
    const kinds = $("ckinds"); kinds.textContent = "";
    for (const [k, label] of CREATE_KINDS) {
      const b = make("button", k === cs.kind ? "on" : null, label); b.type = "button"; b.setAttribute("role", "radio"); b.setAttribute("aria-checked", String(k === cs.kind));
      b.addEventListener("click", () => {
        if (cs.dirty && !window.confirm("Replace what you wrote with the template?")) return;
        cs.kind = k; cs.ref = null;
        for (const x of kinds.children) { const on = x === b; x.classList.toggle("on", on); x.setAttribute("aria-checked", String(on)); }
        loadTemplate([...cs.chosen]);
      });
      kinds.appendChild(b);
    }
    const box = $("cchannels"); box.textContent = "";
    for (const c of all) {
      const l = make("label");
      const i = make("input"); i.type = "checkbox"; i.checked = cs.chosen.has(c);
      i.addEventListener("change", () => {
        if (i.checked) { cs.chosen.add(c); loadTemplate([c]); } else { cs.chosen.delete(c); delete cs.texts[c]; delete cs.textsB[c]; renderEditors(); }
      });
      l.append(i, make("span", null, status.channels[c].name));
      box.appendChild(l);
    }
    if (!all.length) box.appendChild(make("span", "meta", "No channel is enabled in this Worker."));
    $("cpattern").addEventListener("change", () => { cs.ref = $("cpattern").value; loadTemplate([...cs.chosen]); });
    if (!canWrite) { $("composesend").disabled = true; $("composesend").title = "Only a signed-in person can send a post"; }
    $("composesend").addEventListener("click", sendCompose);
    await loadTemplate([...cs.chosen]);
  }

  async function loadTemplate(channels) {
    $("cdone").textContent = "";
    if (!channels.length) { renderEditors(); return; }
    try {
      const q = new URLSearchParams({ kind: cs.kind, channels: channels.join(",") });
      if (cs.ref) q.set("ref", cs.ref);
      const t = await call(`/api/studio/templates?${q}`);
      for (const c of channels) { cs.texts[c] = t.texts?.[c] ?? ""; delete cs.results[c]; }
      cs.ref = t.ref ?? null;
      const sel = $("cpattern"); sel.textContent = "";
      for (const o of t.options ?? []) { const op = make("option", null, o.label); op.value = o.ref; op.selected = o.ref === cs.ref; sel.appendChild(op); }
      $("cpatternf").hidden = !OPTION_LABEL[cs.kind] || !(t.options ?? []).length;
      if (OPTION_LABEL[cs.kind]) { $("cpatternl").textContent = OPTION_LABEL[cs.kind]; $("cpattern").setAttribute("aria-label", OPTION_LABEL[cs.kind]); }
      const missing = channels.filter((c) => !t.texts?.[c]);
      $("cnote").textContent = t.note ?? (missing.length && cs.kind !== "custom" ? `The template does not fit ${missing.map((c) => status.channels[c].name).join(", ")}: write that channel's text yourself.` : "");
      if (t.at) $("cnote").textContent = `${$("cnote").textContent ? $("cnote").textContent + " " : ""}Analysis read ${when(t.at)}.`.trim();
      cs.dirty = false;
      renderEditors();
      for (const c of channels) checkSoon(c, 0);
      $("cerr").textContent = "";
    } catch (e) { $("cerr").textContent = e.message; }
  }

  function renderEditors() {
    const box = $("ceditors"); box.textContent = "";
    for (const c of [...cs.chosen]) {
      const info = status.channels[c];
      const card = make("article", "card chcard");
      const hd = make("div", "hd");
      hd.appendChild(make("span", "ic", initial(info.name)));
      const title = make("div", "grow");
      title.appendChild(make("h2", null, info.name));
      const row = make("div", "row");
      row.appendChild(badge("purple", FORMAT_BADGE[formatOf(c)] ?? formatOf(c)));
      row.appendChild(badge(info.configured ? "green" : "amber", info.configured ? "Account connected" : "No account yet"));
      title.appendChild(row);
      hd.appendChild(title);
      card.appendChild(hd);
      const bd = make("div", "bd");
      const ta = make("textarea", "editor"); ta.value = cs.texts[c] ?? ""; ta.setAttribute("aria-label", `${info.name} text`); ta.spellcheck = true;
      const meta = make("div", "edmeta");
      const g = make("div", "gcheck", "Checking…");
      const count = make("span", "count");
      meta.append(g, count);
      const pv = make("div", "preview");
      const ph = make("div", "ph");
      ph.appendChild(make("span", "av", initial(status?.brand?.name)));
      ph.appendChild(make("b", null, status?.brand?.name ?? "Cryptophys"));
      ph.appendChild(make("span", "meta", `· ${info.name} preview`));
      const pt = make("div", "pt");
      pv.append(ph, pt);
      // The format, chosen before the post is made (only where the channel can post more than one).
      if ((info.formats ?? []).length > 1) {
        const seg = make("div", "seg"); seg.setAttribute("role", "radiogroup"); seg.setAttribute("aria-label", `${info.name} format`);
        for (const f of info.formats) {
          const b = make("button", f === formatOf(c) ? "on" : null, FORMAT_BADGE[f] ?? f); b.type = "button"; b.setAttribute("role", "radio"); b.setAttribute("aria-checked", String(f === formatOf(c)));
          b.disabled = !canWrite;
          b.addEventListener("click", () => { cs.formats[c] = f; renderEditors(); });
          seg.appendChild(b);
        }
        bd.appendChild(seg);
      }
      if (formatOf(c) === "image" || formatOf(c) === "video") pv.appendChild(make("div", `pm ${formatOf(c)}`, MEDIA_NOTE[formatOf(c)] + (info.media === "none" ? " TradingView's credit is added to the text." : "")));
      const paint = () => {
        const limit = { threads: 500, instagram: 2200, x: 280, telegram: 4096, youtube: 5000, tiktok: 2200 }[c];
        count.textContent = `${ta.value.length}/${limit}`;
        count.classList.toggle("over", ta.value.length > limit);
        pt.textContent = ta.value;
        const r = cs.results[c];
        g.className = `gcheck${r ? (r.guardian.pass ? " ok" : " bad") : ""}`;
        g.textContent = !r ? "Checking…" : r.guardian.pass ? "✓ Guardian: every check passed" : `Guardian: ${r.guardian.failures.map((f) => `${f.check} (${f.detail})`).join(", ")}`;
      };
      const changed = () => { cs.texts[c] = ta.value; cs.dirty = true; delete cs.results[c]; paint(); checkSoon(c, 500); };
      ta.addEventListener("input", changed);
      if (canWrite) editorTools(c, ta, changed).then((bar) => ta.before(bar));
      card.paint = paint; card.dataset.channel = c;
      bd.append(ta, meta, pv);
      // A/B caption: a second text for this channel (both wait for approval; the Performance page compares them).
      const bwrap = make("div", "field");
      const bta = make("textarea", "editor"); bta.setAttribute("aria-label", `${info.name} variant B text`);
      const bmeta = make("div", "edmeta"); const bg = make("div", "gcheck"); const bcount = make("span", "count"); bmeta.append(bg, bcount);
      const paintB = () => {
        const r = cs.results[`${c}:b`];
        bcount.textContent = `${bta.value.length}`;
        bg.className = `gcheck${r ? (r.guardian.pass ? " ok" : " bad") : ""}`;
        bg.textContent = !r ? "Checking…" : r.guardian.pass ? "✓ Guardian: variant B passed" : `Guardian (B): ${r.guardian.failures.map((f) => `${f.check} (${f.detail})`).join(", ")}`;
      };
      const showB = (on) => {
        bwrap.textContent = "";
        if (!on) { delete cs.textsB[c]; delete cs.results[`${c}:b`]; return; }
        bwrap.append(make("div", "lbl", "Variant B (A/B test)"), bta, bmeta);
        if (cs.textsB[c] == null) cs.textsB[c] = cs.texts[c] ?? "";
        bta.value = cs.textsB[c]; paintB(); checkSoon(c, 0, "b");
      };
      bta.addEventListener("input", () => { cs.textsB[c] = bta.value; delete cs.results[`${c}:b`]; paintB(); checkSoon(c, 500, "b"); });
      card.paintB = paintB;
      if (canWrite) {
        const tog = make("label", "switch");
        const ti = make("input"); ti.type = "checkbox"; ti.checked = cs.textsB[c] != null;
        ti.addEventListener("change", () => showB(ti.checked));
        tog.append(ti, make("span", null, "Add variant B (A/B test)"));
        bd.append(tog, bwrap);
        if (ti.checked) showB(true);
      }
      card.appendChild(bd);
      box.appendChild(card);
      paint();
    }
    if (!cs.chosen.size) box.appendChild(make("div", "card empty", "Choose one or more channels."));
  }

  function repaint(c) {
    const [ch, v] = c.split(":");
    for (const card of $("ceditors").children) if (card.dataset.channel === ch) { if (v === "b") card.paintB?.(); else card.paint?.(); }
  }

  function checkSoon(c, ms, variant = "a") {
    const key = variant === "b" ? `${c}:b` : c;
    const src = variant === "b" ? cs.textsB : cs.texts;
    clearTimeout(cs.timers[key]);
    if (!canWrite) return;
    cs.timers[key] = setTimeout(async () => {
      const text = src[c] ?? "";
      try {
        const r = await call("/api/studio/check", "POST", { kind: cs.kind, channel: c, text });
        if ((src[c] ?? "") === text) { cs.results[key] = r; repaint(key); }
      } catch (e) { $("cerr").textContent = e.message; }
    }, ms);
  }

  async function sendCompose() {
    const b = $("composesend");
    $("cerr").textContent = ""; $("cdone").textContent = "";
    const posts = [...cs.chosen].map((c) => ({ channel: c, text: cs.texts[c] ?? "", format: formatOf(c), ...(cs.textsB[c] != null ? { text_b: cs.textsB[c] } : {}) }));
    if (!posts.length) { $("cerr").textContent = "Choose at least one channel."; return; }
    b.disabled = true;
    try {
      const res = await fetch("/api/studio/compose", { method: "POST", credentials: "same-origin", headers: { accept: "application/json", "content-type": "application/json" }, body: JSON.stringify({ kind: cs.kind, ref: cs.ref, posts }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        for (const [c, r] of Object.entries(data.results ?? {})) { cs.results[c] = r; repaint(c); }
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const done = $("cdone");
      done.appendChild(make("span", null, `Sent to the queue: ${data.drafts.length} draft${data.drafts.length === 1 ? "" : "s"}${data.ab?.length ? ` (${data.ab.length} A/B test${data.ab.length === 1 ? "" : "s"})` : ""}, waiting for approval. `));
      const a = make("a", null, "Open the queue"); a.href = "#queue"; done.appendChild(a);
      cs.dirty = false;
      await refresh();
    } catch (e) { $("cerr").textContent = e.message; }
    finally { b.disabled = !canWrite; }
  }

  // ---- the agent (owner 2026-11-25: "setuju semua, mulai dari Checks"): Overview and Checks for Threads ----
  const VERDICT = { READY: ["green", "Ready"], REVIEW: ["amber", "Review"], FIX: ["red", "Fix"] };
  const CHECK_TONE = { PASS: "green", WARN: "amber", FAIL: "red" };
  const HUMAN = { burstiness: "Burstiness", specificity: "Specificity", slop: "Slop density", fingerprint: "Fingerprint", voice: "Voice" };
  function agentTab(name) {
    for (const b of $("agenttabs").querySelectorAll("[role=tab]")) {
      const on = b.dataset.tab === name;
      b.classList.toggle("on", on); b.setAttribute("aria-selected", String(on)); b.tabIndex = on ? 0 : -1;
      $(`agent-${b.dataset.tab}`).hidden = !on;
    }
  }
  let agentChannel = "threads";
  function renderAgentChannels(a) {
    const box = $("agentchannels"); box.textContent = "";
    for (const c of a.channels ?? []) {
      const on = c.id === a.channel;
      const b = make("button", `tab${on ? " on" : ""}`); b.type = "button";
      b.setAttribute("role", "tab"); b.setAttribute("aria-selected", String(on)); b.tabIndex = on ? 0 : -1;
      b.append(c.name, c.active ? "" : " ", c.active ? "" : badge("", "Next"));
      b.addEventListener("click", () => { agentChannel = c.id; loadAgent(); });
      box.appendChild(b);
    }
  }
  async function loadAgent() {
    try {
      const a = await call(`/api/studio/agent?channel=${encodeURIComponent(agentChannel)}`);
      renderAgentChannels(a);
      const inactive = $("agentinactive");
      inactive.hidden = a.active;
      $("agentbody").hidden = !a.active;
      if (!a.active) {
        inactive.textContent = "";
        inactive.appendChild(make("p", null, `The agent does not manage ${(a.channels ?? []).find((c) => c.id === a.channel)?.name ?? a.channel} yet. Phase 1 is Threads; each channel joins in its own change.`));
        return;
      }
      agentTab([...$("agenttabs").querySelectorAll("[role=tab]")].find((b) => b.classList.contains("on"))?.dataset.tab ?? "overview");
      const t = $("agenttiles"); t.textContent = "";
      t.appendChild(tile("Drafts checked", String(a.summary.checked), "the latest 30 on this channel"));
      t.appendChild(tile("Ready", String(a.summary.ready), `${a.summary.review} to review · ${a.summary.fix} to fix`));
      t.appendChild(tile("Humanizer pass", String(a.summary.human_pass), "five checks; information only"));
      if (a.topic_tag) t.appendChild(tile("Topic tag", a.topic_tag, "one per post, set through the API"));
      renderModel(a.model, a.can_edit);
      renderWrite(a.write, a.can_edit);
      const sk = $("agentskills"); sk.textContent = "";
      // A list, not a table: it fits a phone (each skill, its state, then what it does, when and with which model).
      const list = make("div", "list");
      for (const s of a.skills) {
        const item = make("div", "draft");
        const top = make("div");
        top.append(badge(s.live ? "green" : "", s.live ? "On" : "Next"), " ", make("b", null, s.name), " ", make("span", "meta", s.id));
        item.append(top, make("div", null, s.what), make("div", "meta", `Runs ${s.runs} · model: ${s.model}`));
        list.appendChild(item);
      }
      sk.appendChild(list);
      const box = $("agentchecks"); box.textContent = "";
      if (!a.checks.length) box.appendChild(make("div", "empty", "No draft on this channel yet."));
      for (const c of a.checks) {
        const item = make("div", "draft");
        const top = make("div", "meta");
        const [tone, word] = VERDICT[c.lint.verdict] ?? ["", c.lint.verdict];
        top.append(badge(tone, word), " ", `${KIND[c.kind] ?? c.kind} · ${LABEL[c.status] ?? c.status} · ${when(c.created_at)}`);
        item.appendChild(top);
        item.appendChild(make("div", "text", c.text));
        const list = make("div");
        for (const k of c.lint.checks) {
          const row = make("div", "meta");
          row.append(badge(CHECK_TONE[k.status] ?? "", k.status), ` ${k.check.toLowerCase()}: ${k.detail}`);
          list.appendChild(row);
        }
        item.appendChild(list);
        item.appendChild(make("div", "meta", `Humanizer ${c.human.score} (${c.human.verdict.toLowerCase()}): ${Object.entries(c.human.checks).map(([k, v]) => `${HUMAN[k] ?? k} ${v.score}`).join(" · ")}`));
        if (c.hook) item.appendChild(make("div", "meta", `Hook ${c.hook.score} (${c.hook.verdict.toLowerCase()}): weakest ${c.hook.weakest.toLowerCase()}${c.hook.formula ? ` · formula ${c.hook.formula.name}` : ""}${c.hook.flags.length ? ` · ${c.hook.flags[0]}` : ""}`));
        if (c.humanized) item.appendChild(make("div", "meta", "Shown as it goes out: the humanizer rewrites it at publish, and the guardian checks it again."));
        for (const f of c.structures ?? []) item.appendChild(make("div", "meta", `Shape: ${f.name}. ${f.fix}`));
        box.appendChild(item);
      }
      renderAudit(a.audit);
      renderReplies(a.replies, a.can_edit);
      renderPlan(a.plan, a.can_edit, a.channel, (a.channels ?? []).find((c) => c.id === a.channel)?.name ?? a.channel);
    } catch (e) { showErr(e); }
  }
  // The model router (src/agent/router.mjs): today's spend against the cap, the switch, the latest calls.
  const usd = (n, d = 4) => `$${Number(n).toFixed(d)}`;
  function renderModel(m, canEdit) {
    const box = $("agentmodel"); box.textContent = "";
    if (!m) return;
    const head = make("div");
    head.append(badge(!m.has_key ? "" : m.enabled ? "green" : "red", !m.has_key ? "No key" : m.enabled ? "On" : "Off"), " ", make("b", null, `${m.model} on ${m.host}`));
    box.appendChild(head);
    box.appendChild(make("div", "meta", `Today (WIB): ${usd(m.today.cost_usd)} of ${usd(m.cap_usd, 2)} · ${m.today.calls} call(s) · ${m.today.tokens_in + m.today.tokens_out} tokens`));
    if (!m.has_key) box.appendChild(make("div", "meta", "The key (REFLECTION_API_KEY) is set as a Worker secret through the platform; until then the agent uses no model."));
    if (m.reason) box.appendChild(make("div", "meta warn", `Off: ${m.reason}${m.switched_by ? ` (${m.switched_by}, ${when(m.switched_at)})` : ""}`));
    for (const c of m.recent ?? []) box.appendChild(make("div", "meta", `${when(c.at)} · ${c.purpose} · ${c.status} · ${c.tokens_in + c.tokens_out} tokens · ${usd(c.cost_usd)}${c.retention ? ` · retention ${c.retention}` : ""}`));
    if (m.has_key) {
      const b = make("button", m.enabled ? "btn outline sm" : "btn primary sm", m.enabled ? "Turn the model off" : "Turn the model on"); b.type = "button"; b.disabled = !canEdit;
      if (!canEdit) b.title = "Approvers only";
      b.addEventListener("click", async () => { b.disabled = true; try { await call("/api/studio/agent/model", "POST", { enabled: !m.enabled }); await loadAgent(); } catch (e) { showErr(e); b.disabled = false; } });
      box.appendChild(b);
    }
  }
  // cta-write (src/agent/write.mjs): its switch, the kill switch (off: every post keeps its template), and what it did.
  function renderWrite(w, canEdit) {
    const box = $("agentwrite"); box.textContent = "";
    if (!w) return;
    const head = make("div");
    head.append(badge(w.mode === "on" ? "green" : "", w.mode === "on" ? "Writing" : "Template"), " ", make("b", null, "Model-worded posts (cta-write)"));
    box.appendChild(head);
    box.appendChild(make("div", "meta", w.mode === "on" ? `The model rewords fresh ${w.kinds.join(", ")} posts from their own facts; any failed guard keeps the template.` : `Off: ${w.why}${w.switched_by ? ` (${w.switched_by}, ${when(w.switched_at)})` : ""}`));
    for (const x of w.recent ?? []) box.appendChild(make("div", "meta", `${when(x.at)} · ${KIND[x.kind] ?? x.kind} · ${x.action === "written" ? "written" : "template kept"}${x.detail ? ` · ${x.detail}` : ""}`));
    const b = make("button", w.enabled ? "btn outline sm" : "btn primary sm", w.enabled ? "Stop writing: use the templates" : "Let the model word posts"); b.type = "button"; b.disabled = !canEdit;
    if (!canEdit) b.title = "Approvers only";
    b.addEventListener("click", async () => { b.disabled = true; try { await call("/api/studio/agent/write", "POST", { enabled: !w.enabled }); await loadAgent(); } catch (e) { showErr(e); b.disabled = false; } });
    box.appendChild(b);
  }
  // Audit: the last complete WIB week on Threads against our own median (src/agent/audit.mjs).
  function renderAudit(au) {
    const box = $("agentaudit"); box.textContent = "";
    if (!au) return;
    if (au.summary) { const s = make("div", "notice info"); s.append(make("b", null, "Beam's summary: "), au.summary); box.appendChild(s); }
    box.appendChild(make("div", "meta", `Week ${au.week.from.slice(0, 10)} to ${au.week.to.slice(0, 10)} (WIB, Monday to Sunday) · median ${fmt(au.median_views)} views over the ${au.baseline_days} days before · ${au.measured} measured posts`));
    for (const f of au.findings) box.appendChild(make("p", null, f));
    if (!au.posts.length) return;
    // A list, not a table: it fits a phone (each post, its kind, then its numbers against the median).
    const list = make("div", "list");
    for (const p of au.posts) {
      const item = make("div", "draft");
      item.append(make("div", null, p.head), make("div", "meta", `${KIND[p.kind] ?? p.kind} · ${fmt(p.views)} views · ${p.multiple == null ? "–" : `${p.multiple}× the median`} · ${p.replies} replies · ${p.reposts} reposts`));
      list.appendChild(item);
    }
    box.appendChild(list);
  }
  // Replies (src/agent/replies.mjs): the mode (dry run, live, off), the caps, the switch, and what it did with each reply.
  const REPLY_STATUS = { sent: ["green", "Sent"], dry_run: ["blue", "Would send"], no_answer: ["", "No answer"], blocked: ["red", "Blocked"], capped_person: ["", "Answered already"], no_model: ["amber", "No model"], model_skipped: ["", "Model skipped"], send_failed: ["red", "Not sent"], no_reading: ["amber", "No reading"] };
  function renderReplies(r, canEdit) {
    const box = $("agentreplies"); box.textContent = "";
    if (!r) { box.appendChild(make("div", "empty", "Replies are not on for this channel yet.")); return; }
    const head = make("div");
    const tone = r.mode === "live" ? "green" : r.mode === "dry_run" ? "blue" : "red";
    const word = r.mode === "live" ? "Live" : r.mode === "dry_run" ? "Dry run" : "Off";
    head.append(badge(tone, word), " ", make("b", null, r.mode === "dry_run" ? (r.waiting === "about_lede" ? "Nothing is sent; live waits for the About page's sentence about the model (the owner's words)" : r.live_at ? `Nothing is sent; live by itself at ${when(r.live_at)}` : `Nothing is sent; the ${r.dry_run_hours}-hour dry run starts at the next run`) : r.mode === "live" ? "Replies go out without approval, within the caps" : `Stopped: ${r.why ?? "off"}`));
    box.appendChild(head);
    box.appendChild(make("div", "meta", `Caps: ${r.caps.hour} an hour, ${r.caps.day} a day, ${r.caps.per_person_per_thread} per person per thread · ${r.sent_today} in the last 24 hours${r.switched_by ? ` · switch: ${r.switched_by}, ${when(r.switched_at)}` : ""}`));
    const b = make("button", r.mode === "off" ? "btn primary sm" : "btn danger sm", r.mode === "off" ? "Resume replies" : "Stop replies"); b.type = "button"; b.disabled = !canEdit || r.why === "AGENT_REPLIES is not on";
    if (!canEdit) b.title = "Approvers only";
    b.addEventListener("click", async () => { b.disabled = true; try { await call("/api/studio/agent/replies", "POST", { enabled: r.mode === "off" }); await loadAgent(); } catch (e) { showErr(e); b.disabled = false; } });
    box.appendChild(b);
    const list = make("div", "list");
    if (!r.recent.length) list.appendChild(make("div", "empty", "No reply read yet."));
    for (const x of r.recent) {
      const item = make("div", "draft");
      const [t, w] = REPLY_STATUS[x.status] ?? ["", x.status];
      const top = make("div", "meta"); top.append(badge(t, w), " ", `${x.bucket} · ${x.username ? `@${x.username}` : "someone"} · ${when(x.at)}${x.detail ? ` · ${x.detail}` : ""}`);
      item.appendChild(top);
      if (x.text) item.appendChild(make("div", null, x.text));
      if (x.answer) item.appendChild(make("div", "text", x.answer));
      list.appendChild(item);
    }
    box.appendChild(list);
  }
  // Plan: the mix and the slots; "Add these slots" saves them into Threads' posting schedule (approvers only).
  function renderPlan(pl, canEdit, channel, name) {
    const box = $("agentplan"); box.textContent = "";
    if (!pl) return;
    box.appendChild(make("h3", null, "Mix"));
    if (!pl.mix.length) box.appendChild(make("div", "empty", "No measured kind yet."));
    for (const m of pl.mix) box.appendChild(make("div", "meta", `${m.name}: ${m.advice} (${m.why})`));
    box.appendChild(make("h3", null, "Posting slots (WIB, every day)"));
    if (!pl.slots.length) { box.appendChild(make("div", "empty", pl.note || "No new slot to suggest.")); return; }
    for (const s of pl.slots) box.appendChild(make("div", "meta", `${s.time} · ${s.why}`));
    box.appendChild(make("div", "meta warn", "A key-level map or a pattern expires 2 hours after it is made: one still waiting when its slot is more than 2 hours away is not posted."));
    const b = make("button", "btn primary sm", `Add these slots to ${name}`); b.type = "button"; b.disabled = !canEdit;
    if (!canEdit) b.title = "Approvers only";
    b.addEventListener("click", async () => {
      b.disabled = true;
      try {
        const cfg = await call("/api/studio/settings");
        const cur = cfg.settings[channel];
        const have = new Set(cur.schedule.map((s) => `${s.days.join(",")}@${s.time}`));
        const schedule = [...cur.schedule, ...pl.slots.map((s) => ({ days: s.days, time: s.time })).filter((s) => !have.has(`${s.days.join(",")}@${s.time}`))].slice(0, cfg.max_slots ?? 12);
        await call("/api/studio/settings", "POST", { channel, settings: { ...cur, schedule } });
        await loadAgent();
      } catch (e) { showErr(e); b.disabled = false; }
    });
    box.appendChild(b);
  }

  // ---- performance ----
  async function loadPerformance() {
    try {
      perf = await call("/api/studio/performance");
      const p = perf;
      const t = $("perftiles"); t.textContent = "";
      t.appendChild(tile(`Posts, last ${p.days} days`, String(p.total.posts)));
      t.appendChild(tile("Views", fmt(p.total.views)));
      t.appendChild(tile("Likes", fmt(p.total.likes)));
      t.appendChild(tile("Comments", fmt(p.total.comments)));
      t.appendChild(tile("Shares", fmt(p.total.shares)));
      const box = $("perf"); box.textContent = "";
      const rows = Object.entries(p.channels || {});
      if (!rows.length) { box.appendChild(make("div", "empty", "No channel is enabled.")); return; }
      const table = make("table", "data");
      const head = make("tr");
      for (const [h, num] of [["Channel"], ["Posts", 1], ["Measured", 1], ["Views", 1], ["Likes", 1], ["Best post", 1]]) head.appendChild(make("th", num ? "num" : null, h));
      table.appendChild(make("thead")).appendChild(head);
      const body = table.appendChild(make("tbody"));
      for (const [c, r] of rows) {
        const read = (p.read || []).includes(c);
        const tr = make("tr");
        tr.appendChild(make("td", null, status?.channels?.[c]?.name ?? c));
        tr.appendChild(make("td", "num", String(r.posts ?? 0)));
        tr.appendChild(make("td", "num", read ? String(r.measured ?? 0) : "not read"));
        tr.appendChild(make("td", "num", read ? fmt(r.views) : "–"));
        tr.appendChild(make("td", "num", read ? fmt(r.likes) : "–"));
        tr.appendChild(make("td", "num", r.best ? `${fmt(r.best.views)} views` : "–"));
        body.appendChild(tr);
      }
      box.appendChild(table);
    } catch (e) { showErr(e); }
  }

  async function refresh() {
    try { status = await call("/api/studio/status"); renderStatus(); } catch (e) { showErr(e); }
    try { sched = await call("/api/studio/schedule"); renderUpNext(); } catch (e) { showErr(e); }
    try { renderMix(await call("/api/studio/mix")); } catch (e) { showErr(e); }
    if (!$("view-queue").hidden) await load();
  }

  async function init() {
    try {
      const who = await call("/api/studio/whoami");
      $("who").textContent = who.subject;
      $("avatar").textContent = initial(who.subject);
      $("avatar").title = who.can_decide ? "can approve" : who.can_write ? "editor: writes, never approves" : "read only";
      canDecide = Boolean(who.can_decide); canWrite = Boolean(who.can_write ?? who.can_decide); role = who.role ?? null;
      if (role) $("role").textContent = role === "approver" ? "Approver" : role === "editor" ? "Editor" : "Read only";
    } catch (e) { showErr(e); }
    const busy = (id, fn) => $(id).addEventListener("click", async (ev) => {
      ev.currentTarget.disabled = true; const b = ev.currentTarget;
      try { await fn(); } catch (e) { showErr(e); } finally { b.disabled = false; }
    });
    // A card that could not be made says why (2026-11-17: the page only refreshed, and the draft stayed in "Needs image").
    const renderProblem = (r) => {
      if (r?.status === "no_browser") return "Browser Run is not connected: cards cannot be made";
      const failed = (r?.rendered ?? []).filter((x) => x.status !== "pending" && x.status !== "blocked");
      return failed.length ? `Card not made for ${failed.length} draft(s): ${failed.map((x) => x.error || x.status).join("; ")}` : "";
    };
    busy("draftnow", async () => { const r = await call("/api/studio/draft-now", "POST", {}); await refresh(); const p = renderProblem(r?.cards); if (p) showErr(p); });
    busy("rendernow", async () => { const r = await call("/api/studio/render-now", "POST", {}); await refresh(); const p = renderProblem(r); if (p) showErr(p); });
    busy("insightsnow", async () => { await call("/api/studio/insights-now", "POST", {}); await loadPerformance(); });
    $("agenttabs").addEventListener("click", (ev) => { const b = ev.target.closest("[role=tab]"); if (b) agentTab(b.dataset.tab); });
    $("agenttabs").addEventListener("keydown", (ev) => {
      if (ev.key !== "ArrowRight" && ev.key !== "ArrowLeft") return;
      const tabs = [...$("agenttabs").querySelectorAll("[role=tab]")], i = tabs.indexOf(document.activeElement);
      if (i < 0) return;
      const next = tabs[(i + (ev.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
      next.focus(); agentTab(next.dataset.tab);
    });
    window.addEventListener("hashchange", show);
    await refresh();
    show();
    setInterval(refresh, 120000);
  }
  init();
})();
