// The home page (owner 2026-11-19): Follow first (every active channel and its latest post), then the holo war room,
// loaded after first paint and only where WebGL works. X stays hidden while the owner holds it.
(function () {
  const el = (id) => document.getElementById(id);
  const make = (tag, cls, value) => { const n = document.createElement(tag); if (cls) n.className = cls; if (value != null) n.textContent = value; return n; };
  const HIDDEN = new Set(["x"]);
  const NAMES = { threads: "Threads", instagram: "Instagram", telegram: "Telegram", youtube: "YouTube", tiktok: "TikTok" };
  const when = (iso) => (iso ? `${new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}, ${new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "UTC" })} UTC` : "");
  // The first line of a post, without its "Education ·" prefix: what the post is about.
  const headline = (text) => String(text || "").split("\n").map((l) => l.trim()).find(Boolean)?.replace(/^Education\s*·\s*/i, "") ?? "";

  let loaded = null;
  function channels() {
    loaded = loaded || Promise.all([
      fetch("/api/public/profile").then((r) => r.json()).catch(() => ({})),
      fetch("/api/public/archive?limit=30").then((r) => r.json()).catch(() => ({}))
    ]).then(([p, a]) => {
      if (p?.brand?.disclaimer && el("disclaimer")) el("disclaimer").textContent = p.brand.disclaimer;
      const byChannel = new Map();
      for (const l of p?.links ?? []) if (!HIDDEN.has(l.channel)) byChannel.set(l.channel, { channel: l.channel, label: l.label, url: l.url, last: null });
      for (const post of a?.posts ?? []) {
        if (HIDDEN.has(post.channel) || !NAMES[post.channel]) continue;
        const c = byChannel.get(post.channel) ?? { channel: post.channel, label: NAMES[post.channel], url: null, last: null };
        if (!c.last || String(post.published_at) > String(c.last.published_at)) c.last = post;
        byChannel.set(post.channel, c);
      }
      return [...byChannel.values()];
    });
    return loaded;
  }
  function renderFollow(list) {
    const box = el("follow-list");
    box.textContent = "";
    if (!list.length) { box.appendChild(make("p", "meta", "Channels are coming soon.")); return; }
    for (const c of list) {
      const row = make("div", "chan-row");
      row.appendChild(make("span", "ic", c.label.charAt(0)));
      const mid = make("div");
      mid.appendChild(make("b", null, c.label));
      if (c.last) { mid.appendChild(make("p", "last", headline(c.last.text))); mid.appendChild(make("span", "when", `Latest post · ${when(c.last.published_at)}`)); }
      else mid.appendChild(make("p", "last", "No post here yet."));
      row.appendChild(mid);
      if (c.url) { const a = make("a", "btn primary sm", "Follow"); a.href = c.url; a.rel = "noopener"; a.target = "_blank"; a.setAttribute("aria-label", `Follow on ${c.label}`); row.appendChild(a); }
      box.appendChild(row);
    }
  }
  const dlg = el("follow");
  document.querySelectorAll("[data-follow]").forEach((b) => b.addEventListener("click", () => {
    if (typeof dlg.showModal === "function") dlg.showModal(); else dlg.setAttribute("open", "");
    channels().then(renderFollow);
  }));
  el("follow-close").addEventListener("click", () => dlg.close());
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  channels();

  // The scene: three.js and the mannequin are this site's own files, fetched once the page has painted.
  const gl = (() => { try { const c = document.createElement("canvas"); return Boolean(c.getContext("webgl2") || c.getContext("webgl")); } catch { return false; } })();
  if (!gl) { el("nogl").hidden = false; return; }
  const start = () => { el("loading").hidden = false; import("/room/room.js").catch(() => { el("loading").textContent = "The scene did not load."; }); };
  const later = () => (window.requestIdleCallback ? requestIdleCallback(start, { timeout: 1500 }) : setTimeout(start, 200));
  if (document.readyState === "complete") later(); else window.addEventListener("load", later, { once: true });
})();
