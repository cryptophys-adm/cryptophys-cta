// The public CTA page: the brand's profile, its channels and the published archive (GET /api/public/*).
(function () {
  const el = (id) => document.getElementById(id);
  const text = (node, value) => { node.textContent = value; return node; };
  const make = (tag, cls, value) => { const n = document.createElement(tag); if (cls) n.className = cls; if (value != null) n.textContent = value; return n; };
  const when = (iso) => (iso ? new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC" : "");
  const initial = (s) => String(s || "?").trim().charAt(0).toUpperCase();
  const label = {};
  fetch("/api/public/profile").then((r) => r.json()).then((p) => {
    if (p?.brand) {
      text(el("name"), p.brand.name);
      text(el("tagline"), p.brand.tagline);
      text(el("disclaimer"), p.brand.disclaimer);
      document.title = p.brand.name;
    }
    const links = el("links");
    const list = el("chanlist");
    list.textContent = "";
    const all = p?.links ?? [];
    all.forEach((l, i) => {
      label[l.channel] = l.label;
      const a = make("a", "btn lg" + (i === 0 ? " primary" : " outline"), `Follow on ${l.label}`);
      a.href = l.url; a.rel = "noopener"; a.target = "_blank";
      links.appendChild(a);
      const c = make("a", "card chan");
      c.href = l.url; c.rel = "noopener"; c.target = "_blank";
      c.appendChild(make("span", "ic", initial(l.label)));
      const t = make("span");
      t.appendChild(make("b", null, l.label));
      t.appendChild(make("span", "meta", String(l.url).replace(/^https:\/\/(www\.)?/, "")));
      c.appendChild(t);
      list.appendChild(c);
    });
    if (!all.length) list.appendChild(make("div", "card empty", "Channels are coming soon."));
  }).catch(() => {});
  fetch("/api/public/archive?limit=24").then((r) => r.json()).then((a) => {
    const box = el("archive");
    const posts = a?.posts ?? [];
    if (!posts.length) return;
    box.textContent = "";
    for (const p of posts) {
      const card = make("article", "card");
      const hd = make("div", "hd");
      hd.appendChild(make("span", "badge blue plain", label[p.channel] || p.channel));
      hd.appendChild(make("span", "grow"));
      hd.appendChild(make("span", "meta", when(p.published_at)));
      card.appendChild(hd);
      card.appendChild(make("div", "post", p.text));
      box.appendChild(card);
    }
  }).catch(() => {});
})();
