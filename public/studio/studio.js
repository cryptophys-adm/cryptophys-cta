// CTA Studio (behind Cloudflare Access): channels, the content queue, a person's approval or rejection, a dry run.
// Everything goes through /api/studio/* on the same origin; a rejection needs a reason.
(function () {
  const $ = (id) => document.getElementById(id);
  const make = (tag, cls, value) => { const n = document.createElement(tag); if (cls) n.className = cls; if (value != null) n.textContent = value; return n; };
  const when = (iso) => (iso ? `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC` : "—");
  const LABEL = { pending: "menunggu Anda", needs_image: "butuh gambar", needs_video: "butuh video", blocked: "ditahan guardian", approved: "disetujui", rejected: "ditolak", published: "terbit", failed: "gagal terbit" };
  const TONE = { pending: "cyan", needs_image: "", needs_video: "", blocked: "red", approved: "amber", rejected: "", published: "green", failed: "red" };
  const KIND = { daily_recap: "Rekap harian", key_levels: "Peta level kunci", pattern: "Pola chart" };
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
      row.appendChild(make("span", `pill ${c.configured ? "green" : "amber"}`, c.configured ? "akun terhubung" : "belum ada akun"));
      row.appendChild(make("span", `pill ${c.publisher === "built" ? "cyan" : ""}`, c.publisher === "built" ? "publisher siap" : "publisher menyusul"));
      if (c.media !== "none") row.appendChild(make("span", "pill purple", c.media === "image" ? "butuh gambar" : "butuh video"));
      if (!c.enabled) row.appendChild(make("span", "pill", "nonaktif"));
      card.appendChild(row);
      if (c.quota) card.appendChild(make("div", "meta", `${c.quota.used}/${c.quota.total ?? "?"} post hari ini`));
      card.title = c.note || "";
      box.appendChild(card);
    }
  }

  function renderTabs(counts) {
    const tabs = $("tabs"); tabs.textContent = "";
    for (const f of FILTERS) {
      const b = make("button", `tab${f === filter ? " on" : ""}`, f ? `${LABEL[f]} (${counts?.[f] ?? 0})` : "semua");
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
    head.appendChild(make("span", "meta count", `${d.text.length}${limit ? `/${limit}` : ""} karakter · ${when(d.created_at)}`));
    card.appendChild(head);
    card.appendChild(make("div", "post", d.text));
    const g = d.guardian || {};
    const gl = make("div", "meta", g.pass ? "Guardian: semua cek lolos" : `Guardian: ${(g.failures || []).map((f) => `${f.check} (${f.detail})`).join(", ") || "belum dicek"}`);
    card.appendChild(gl);
    if (d.decided_by) card.appendChild(make("div", "meta", `Diputuskan oleh ${d.decided_by}${d.decision_reason ? ` · ${d.decision_reason}` : ""}`));
    if (d.remote_id) card.appendChild(make("div", "meta", `ID post: ${d.remote_id}`));
    if (d.error) card.appendChild(make("div", "err", d.error));
    const err = make("div", "err");
    const dry = make("pre", "dry"); dry.hidden = true;
    const actions = make("div", "row");
    if (d.status === "pending" && canDecide) {
      const reason = make("input", "reason"); reason.placeholder = "alasan (wajib untuk menolak)";
      const ok = make("button", "act ok", status?.publish === "on" ? "Setujui & terbitkan" : "Setujui (publikasi off)"); ok.type = "button";
      const no = make("button", "act no", "Tolak"); no.type = "button";
      const decide = async (decision) => {
        if (decision === "reject" && !reason.value.trim()) { err.textContent = "alasan wajib untuk menolak"; return; }
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

  async function load() {
    try {
      const q = await call(`/api/studio/drafts${filter ? `?status=${filter}` : ""}`);
      canDecide = Boolean(q.can_decide);
      renderTabs(q.counts);
      const box = $("queue"); box.textContent = "";
      const drafts = q.drafts || [];
      if (!drafts.length) { box.appendChild(make("div", "empty", "Tidak ada draf di sini. Draf baru dibuat otomatis: analisa tiap jam (Senin–Jumat), peta level 13:09 WIB, rekap 05:17 WIB (Selasa–Sabtu).")); return; }
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
    await load();
    setInterval(load, 120000);
  }
  init();
})();
