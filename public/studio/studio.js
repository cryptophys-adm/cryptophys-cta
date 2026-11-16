// CTA Studio (behind Cloudflare Access): a dashboard, the content queue, a person's approval or rejection, a dry
// run, performance and channels. Everything goes through /api/studio/* on the same origin; a rejection needs a reason.
// Views are switched by the URL hash (#dashboard, #queue, #performance, #channels). The Channels page edits each
// channel's settings (format, content, drafts per day, schedule in WIB, hashtags); never a token.
(function () {
  const $ = (id) => document.getElementById(id);
  const make = (tag, cls, value) => { const n = document.createElement(tag); if (cls) n.className = cls; if (value != null) n.textContent = value; return n; };
  const when = (iso) => (iso ? `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC` : "—");
  const LABEL = { pending: "Waiting for you", needs_image: "Needs image", needs_video: "Needs video", blocked: "Held by guardian", approved: "Approved", rejected: "Rejected", published: "Published", failed: "Failed to publish" };
  const TONE = { pending: "blue", needs_image: "", needs_video: "", blocked: "red", approved: "amber", rejected: "", published: "green", failed: "red" };
  const KIND = { daily_recap: "Daily recap", key_levels: "Key-level map", pattern: "Chart pattern" };
  const FILTERS = ["pending", "needs_image", "needs_video", "blocked", "approved", "published", "rejected", "failed", ""];
  const VIEWS = ["dashboard", "queue", "performance", "channels"];
  let filter = "pending", status = null, canDecide = false, perf = null;

  async function call(path, method = "GET", body) {
    const res = await fetch(path, { method, credentials: "same-origin", headers: { accept: "application/json", ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.ok === false) throw new Error(data?.error || data?.reason || `HTTP ${res.status}`);
    return data;
  }
  const showErr = (e) => { $("err").textContent = e ? String(e.message || e) : ""; };
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
    if (v === "performance") loadPerformance();
    if (v === "channels") loadChannels();
  }

  function tile(label, value, meta, link) {
    const t = make("div", "card tile");
    t.appendChild(make("div", "label", label));
    t.appendChild(make("div", "value", value));
    if (meta) t.appendChild(make("div", "meta", meta));
    if (link) { const a = make("a", null, link.text); a.href = link.href; t.appendChild(a); }
    return t;
  }

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
    const p = $("publish"); p.textContent = `Publishing ${on ? "on" : "off"}`; p.className = `badge ${on ? "green" : "amber"}`;
    renderDashboard();
  }

  // ---- channels: each channel's settings (GET/POST /api/studio/settings) ----
  const FORMAT_NAMES = { text: "Text only", image: "Image", video: "Video" };
  const FORMAT_NOTE = { planned: "planned", na: "not available" };
  const DAY_NAMES = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };

  async function loadChannels() {
    try {
      const cfg = await call("/api/studio/settings");
      const n = $("chnotice"); n.textContent = "";
      const line = make("span");
      line.appendChild(make("b", null, "Times are in WIB (UTC+7). "));
      n.appendChild(line);
      line.appendChild(document.createTextNode(status?.publish === "on"
        ? "Approved posts go out in each channel's slots once the per-channel scheduler is on (next studio update)."
        : "Publishing is off: the slots are saved now, and approved posts wait. The per-channel scheduler comes in the next studio update."));
      const box = $("channels"); box.textContent = "";
      for (const c of Object.keys(cfg.settings || {})) box.appendChild(channelCard(c, cfg));
      showErr(null);
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
      const ok = make("button", "btn primary", status?.publish === "on" ? "Approve & publish" : "Approve (publishing off)"); ok.type = "button";
      const decide = async (decision) => {
        if (decision === "reject" && !reason.value.trim()) { err.textContent = "a reason is required to reject"; return; }
        ok.disabled = no.disabled = true;
        try { await call("/api/studio/decide", "POST", { id: d.id, decision, reason: reason.value.trim() }); await refresh(); }
        catch (e) { err.textContent = e.message; ok.disabled = no.disabled = false; }
      };
      ok.addEventListener("click", () => decide("approve"));
      no.addEventListener("click", () => decide("reject"));
      actions.append(reason, no, ok);
    }
    const preview = make("button", "btn outline", "Dry run"); preview.type = "button";
    preview.addEventListener("click", async () => {
      try { dry.textContent = JSON.stringify(await call(`/api/studio/preview?id=${encodeURIComponent(d.id)}`), null, 2); dry.hidden = false; }
      catch (e) { err.textContent = e.message; }
    });
    actions.appendChild(preview);
    card.append(actions, err, dry);
    return card;
  }

  async function load() {
    try {
      const q = await call(`/api/studio/drafts${filter ? `?status=${filter}` : ""}`);
      canDecide = Boolean(q.can_decide);
      renderTabs(q.counts);
      const box = $("queue"); box.textContent = "";
      const drafts = q.drafts || [];
      if (!drafts.length) { box.appendChild(make("div", "empty", filter ? `No drafts are “${LABEL[filter].toLowerCase()}”.` : "No drafts yet.")); return; }
      let day = "";
      for (const d of drafts) {
        const dd = String(d.created_at).slice(0, 10);
        if (dd !== day) { day = dd; box.appendChild(make("div", "daygroup", day)); }
        box.appendChild(draftCard(d));
      }
      showErr(null);
    } catch (e) { showErr(e); }
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
    if (!$("view-queue").hidden) await load();
  }

  async function init() {
    try {
      const who = await call("/api/studio/whoami");
      $("who").textContent = who.subject;
      $("avatar").textContent = initial(who.subject);
      $("avatar").title = who.can_decide ? "can approve" : "read only";
    } catch (e) { showErr(e); }
    const busy = (id, fn) => $(id).addEventListener("click", async (ev) => {
      ev.currentTarget.disabled = true; const b = ev.currentTarget;
      try { await fn(); } catch (e) { showErr(e); } finally { b.disabled = false; }
    });
    busy("draftnow", async () => { await call("/api/studio/draft-now", "POST", {}); await refresh(); });
    busy("rendernow", async () => { const r = await call("/api/studio/render-now", "POST", {}); if (r.status === "no_browser") showErr("Browser Run is not connected"); else await refresh(); });
    busy("insightsnow", async () => { await call("/api/studio/insights-now", "POST", {}); await loadPerformance(); });
    window.addEventListener("hashchange", show);
    await refresh();
    show();
    setInterval(refresh, 120000);
  }
  init();
})();
