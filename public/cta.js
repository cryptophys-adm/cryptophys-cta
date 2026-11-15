// The public CTA page: the brand's profile, its channels and the published archive (GET /api/public/*).
(function () {
  const el = (id) => document.getElementById(id);
  const text = (node, value) => { node.textContent = value; return node; };
  const make = (tag, cls, value) => { const n = document.createElement(tag); if (cls) n.className = cls; if (value != null) n.textContent = value; return n; };
  const when = (iso) => (iso ? new Date(iso).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" }) : "");
  fetch("/api/public/profile").then((r) => r.json()).then((p) => {
    if (p?.brand) {
      text(el("name"), p.brand.name);
      text(el("tagline"), p.brand.tagline);
      text(el("disclaimer"), p.brand.disclaimer);
      document.title = p.brand.name;
    }
    const links = el("links");
    for (const l of p?.links ?? []) {
      const a = make("a", "btn" + (l.channel === "threads" ? " primary" : ""), `Ikuti di ${l.label}`);
      a.href = l.url; a.rel = "noopener"; a.target = "_blank";
      links.appendChild(a);
    }
  }).catch(() => {});
  fetch("/api/public/archive?limit=24").then((r) => r.json()).then((a) => {
    const box = el("archive");
    const posts = a?.posts ?? [];
    if (!posts.length) return;
    box.textContent = "";
    for (const p of posts) {
      const card = make("article", "card");
      card.appendChild(make("div", "post", p.text));
      card.appendChild(make("div", "meta", `${p.channel} · ${when(p.published_at)}`));
      box.appendChild(card);
    }
  }).catch(() => {});
})();
