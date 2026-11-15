// CTA Studio (behind Cloudflare Access): channels, the content queue, a person's approval or rejection, a dry run.
// Everything goes through /api/studio/* on the same origin; a rejection needs a reason.
(function () {
  const $ = (id) => document.getElementById(id);
  const make = (tag, cls, value) => { const n = document.createElement(tag); if (cls) n.className = cls; if (value != null) n.textContent = value; return n; };
  const when = (iso) => (iso ? `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC` : "—");
  const LABEL = { pending: "waiting for you", needs_image: "needs image", needs_video: "needs video", blocked: "held by guardian", approved: "approved", rejected: "rejected", published: "published", failed: "failed to publish" };
  const TONE = { pending: "cyan", needs_image: "", needs_video: "", blocked: "red", approved: "amber", rejected: "", published: "green", failed: "red" };
  const KIND = { daily_recap: "Daily recap", key_levels: "Key-level map", pattern: "Chart pattern" };
  const FILTERS = ["", "pending", "needs_image", "needs_video", "blocked", "approved", "published", "rejected", "failed"];
  let filter = "pending", status = null, canDecide = false;

  async function call(path, method = "GET", body) {
    const res = await fetch(path, { method, credentials: "same-origin", headers: { accept: "application/json", ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.ok === false) throw new Error(data?.error || data?.reason || `HTTP ${res.status}`);
    return data;
  }
  const showErr = (e) => { $("err").textContent = e ? String(e.message || e) : ""; };

  function renderStatus() {
    const on = status?.publish === "on";
    const p = $("publish"); p.textContent = `publishing ${on ? "on" : "off"}`; p.className = `pill ${on ? "green" : "amber"}`;
    const box = $("channels"); box.textContent = "";
    for (const [id, c] of Object.entries(status?.channels ?? {})) {
      const card = make("div", "card");
      card.appendChild(make("b", null, c.name));
      const row = make("div", "row");
      row.appendChild(make("span", `pill ${c.configured ? "green" : "amber"}`, c.configured ? "account connected" : "no account yet"));
      row.appendChild(make("span", `pill ${c.publisher === "built" ? "cyan" : ""}`, c.publisher === "built" ? "publisher ready" : "publisher later"));
      if (c.media !== "none") row.appendChild(make("span", "pill purple", c.media === "image" ? "needs image" : "needs video"));
      if (!c.enabled) row.appendChild(make("span", "pill", "nonaktif"));
      card.appendChild(row);
      if (c.quota) card.appendChild(make("div", "meta", `${c.quota.used}/${c.quota.total ?? "?"} posts today`));
      card.title = c.note || "";
      box.appendChild(card);
    }
  }

  function renderTabs(counts) {
    const tabs = $("tabs"); tabs.textContent = "";
    for (const f of FILTERS) {
      const b = make("button", `tab${f === filter ? " on" : ""}`, f ? `${LABEL[f]} (${counts?.[f] ?? 0})` : "all");
      b.type = "button";
      b.addEventListener("click", () => { filter = f; load(); });
      tabs.appendChild(b);
    }
  }

  function draftCard(d) {
    const card = make("article", "card");
    const head = make("div", "row");
    head.appendChild(make("span", "pill purple", status?.channels?.[d.channel]?.name ?? d.channel));
    head.appendChild(make("span", `pill ${TONE[d.status] ?? ""}`, LABEL[d.status] ?? d.status));
    head.appendChild(make("span", "pill", KIND[d.kind] ?? d.kind));
    const limit = { threads: 500, instagram: 2200, x: 280, telegram: 4096, youtube: 5000, tiktok: 2200 }[d.channel];
    head.appendChild(make("span", "meta count", `${d.text.length}${limit ? `/${limit}` : ""} characters · ${when(d.created_at)}`));
    card.appendChild(head);
    card.appendChild(make("div", "post", d.text));
    // The Instagram card (TradingView's chart and the Cryptophys panel), as Instagram will get it.
    const media = /\/media\/([0-9a-f]{32})\.(jpg|webm)$/.exec(d.image_url || "");
    if (media && media[2] === "jpg") { const img = make("img", "cardimg"); img.alt = "Instagram card"; img.loading = "lazy"; img.src = `/api/studio/media?id=${media[1]}`; card.appendChild(img); }
    // The YouTube Shorts / TikTok video (9:16), as the platform will get it.
    if (media && media[2] === "webm") { const v = make("video", "cardvid"); v.controls = true; v.preload = "metadata"; v.muted = true; v.src = `/api/studio/media?id=${media[1]}`; card.appendChild(v); }
    const g = d.guardian || {};
    const gl = make("div", "meta", g.pass ? "Guardian: every check passed" : `Guardian: ${(g.failures || []).map((f) => `${f.check} (${f.detail})`).join(", ") || "not checked yet"}`);
    card.appendChild(gl);
    if (d.decided_by) card.appendChild(make("div", "meta", `Decided by ${d.decided_by}${d.decision_reason ? ` · ${d.decision_reason}` : ""}`));
    if (d.remote_id) card.appendChild(make("div", "meta", `Post ID: ${d.remote_id}`));
    // The post's own metrics, read once a day from the platform (Threads, Instagram, YouTube; X when enabled).
    if (d.metrics) card.appendChild(make("div", "meta metrics", metricsLine(d.metrics) + (d.metrics_at ? ` · read ${when(d.metrics_at)}` : "")));
    if (d.error) card.appendChild(make("div", "err", d.error));
    const err = make("div", "err");
    const dry = make("pre", "dry"); dry.hidden = true;
    const actions = make("div", "row");
    if (d.status === "pending" && canDecide) {
      const reason = make("input", "reason"); reason.placeholder = "reason (required to reject)";
      const ok = make("button", "act ok", status?.publish === "on" ? "Approve & publish" : "Approve (publishing off)"); ok.type = "button";
      const no = make("button", "act no", "Reject"); no.type = "button";
      const decide = async (decision) => {
        if (decision === "reject" && !reason.value.trim()) { err.textContent = "a reason is required to reject"; return; }
        ok.disabled = no.disabled = true;
        try { await call("/api/studio/decide", "POST", { id: d.id, decision, reason: reason.value.trim() }); await load(); }
        catch (e) { err.textContent = e.message; ok.disabled = no.disabled = false; }
      };
      ok.addEventListener("click", () => decide("approve"));
      no.addEventListener("click", () => decide("reject"));
      actions.append(reason, ok, no);
    }
    const preview = make("button", "act", "Dry run"); preview.type = "button";
    preview.addEventListener("click", async () => {
      try { dry.textContent = JSON.stringify(await call(`/api/studio/preview?id=${encodeURIComponent(d.id)}`), null, 2); dry.hidden = false; }
      catch (e) { err.textContent = e.message; }
    });
    actions.appendChild(preview);
    card.append(actions, err, dry);
    return card;
  }

  const posts = (n) => `${n} post${n === 1 ? "" : "s"}`;
  const fmt = (n) => (n == null ? "–" : n >= 10000 ? `${(n / 1000).toFixed(1)}k` : String(n));
  function metricsLine(m) {
    return [["views", "views"], ["likes", "likes"], ["comments", "comments"], ["shares", "shares"], ["saves", "saves"], ["reposts", "reposts"]]
      .filter(([k]) => m[k] != null).map(([k, label]) => `${fmt(m[k])} ${label}`).join(" · ") || "no metrics yet";
  }

  async function loadPerformance() {
    try {
      const p = await call("/api/studio/performance");
      const box = $("perf"); box.textContent = "";
      const total = make("div", "card");
      total.appendChild(make("b", null, `Last ${p.days} days`));
      total.appendChild(make("div", "meta", `${posts(p.total.posts)} · ${fmt(p.total.views)} views · ${fmt(p.total.likes)} likes · ${fmt(p.total.comments)} comments · ${fmt(p.total.shares)} shares`));
      box.appendChild(total);
      for (const [c, r] of Object.entries(p.channels || {})) {
        const card = make("div", "card");
        card.appendChild(make("b", null, status?.channels?.[c]?.name ?? c));
        const read = (p.read || []).includes(c);
        card.appendChild(make("div", "meta", !r.posts ? "no posts yet" : !read ? `${posts(r.posts)} · metrics not read for this channel` : `${posts(r.posts)} (${r.measured} measured) · ${fmt(r.views)} views · ${fmt(r.likes)} likes`));
        if (r.best) card.appendChild(make("div", "meta", `best: ${fmt(r.best.views)} views`));
        box.appendChild(card);
      }
    } catch (e) { showErr(e); }
  }

  async function load() {
    try {
      const q = await call(`/api/studio/drafts${filter ? `?status=${filter}` : ""}`);
      canDecide = Boolean(q.can_decide);
      renderTabs(q.counts);
      const box = $("queue"); box.textContent = "";
      const drafts = q.drafts || [];
      if (!drafts.length) { box.appendChild(make("div", "empty", "No drafts here. New drafts are made automatically: analysis every hour (Monday–Friday), the key-level map at 06:09 UTC, the recap at 22:17 UTC (Tuesday–Saturday).")); return; }
      let day = "";
      for (const d of drafts) {
        const dd = String(d.created_at).slice(0, 10);
        if (dd !== day) { day = dd; box.appendChild(make("div", "daygroup", day)); }
        box.appendChild(draftCard(d));
      }
      showErr(null);
    } catch (e) { showErr(e); }
  }

  async function init() {
    try {
      const who = await call("/api/studio/whoami");
      const w = $("who"); w.textContent = who.subject; w.className = `pill ${who.can_decide ? "cyan" : ""}`;
      status = await call("/api/studio/status");
      renderStatus();
    } catch (e) { showErr(e); }
    $("draftnow").addEventListener("click", async (ev) => {
      ev.target.disabled = true;
      try { await call("/api/studio/draft-now", "POST", {}); await load(); } catch (e) { showErr(e); } finally { ev.target.disabled = false; }
    });
    $("rendernow").addEventListener("click", async (ev) => {
      ev.target.disabled = true;
      try {
        const r = await call("/api/studio/render-now", "POST", {});
        if (r.status === "no_browser") showErr("Browser Run is not connected"); else await load();
      } catch (e) { showErr(e); } finally { ev.target.disabled = false; }
    });
    $("insightsnow").addEventListener("click", async (ev) => {
      ev.target.disabled = true;
      try { await call("/api/studio/insights-now", "POST", {}); await loadPerformance(); await load(); } catch (e) { showErr(e); } finally { ev.target.disabled = false; }
    });
    await loadPerformance();
    await load();
    setInterval(load, 120000);
  }
  init();
})();
