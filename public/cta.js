// The public pages (/, /archive, /about, /disclaimer, /signin): the brand's profile, its channels and the published
// archive (GET /api/public/*). Each part fills only when its element is on the page.
(function () {
  const el = (id) => document.getElementById(id);
  const text = (node, value) => { if (node && value) node.textContent = value; return node; };
  const make = (tag, cls, value) => { const n = document.createElement(tag); if (cls) n.className = cls; if (value != null) n.textContent = value; return n; };
  // "17 Nov 2026, 5:27 PM UTC": UTC clock times in 12-hour form (owner 2026-11-17).
  const when = (iso) => (iso ? `${new Date(iso).toLocaleDateString("en-GB", { dateStyle: "medium", timeZone: "UTC" })}, ${new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "UTC" })} UTC` : "");
  const day = (iso) => (iso ? new Date(iso).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : "");
  const initial = (s) => String(s || "?").trim().charAt(0).toUpperCase();
  const KIND = { key_levels: "Key-level map", pattern: "Chart pattern", daily_recap: "Daily recap", custom: "Post" };
  const label = {};

  const profile = fetch("/api/public/profile").then((r) => r.json()).then((p) => {
    if (p?.brand) {
      text(el("name"), p.brand.name);
      text(el("tagline"), p.brand.tagline);
      text(el("disclaimer"), p.brand.disclaimer);
      if (el("name")) document.title = p.brand.name;
    }
    const all = p?.links ?? [];
    for (const l of all) label[l.channel] = l.label;
    const links = el("links");
    if (links) all.forEach((l, i) => {
      const a = make("a", "btn lg" + (i === 0 ? " primary" : " outline"), `Follow on ${l.label}`);
      a.href = l.url; a.rel = "noopener"; a.target = "_blank";
      links.appendChild(a);
    });
    const list = el("chanlist");
    if (list) {
      list.textContent = "";
      for (const l of all) {
        const c = make("a", "card chan");
        c.href = l.url; c.rel = "noopener"; c.target = "_blank";
        c.appendChild(make("span", "ic", initial(l.label)));
        const t = make("span");
        t.appendChild(make("b", null, l.label));
        t.appendChild(make("span", "meta", String(l.url).replace(/^https:\/\/(www\.)?/, "")));
        c.appendChild(t);
        list.appendChild(c);
      }
      if (!all.length) list.appendChild(make("div", "card empty", "Channels are coming soon."));
    }
  }).catch(() => {});

  const box = el("archive");
  if (!box) return;
  const grouped = box.dataset.grouped === "1";
  const limit = Number(box.dataset.limit) || 24;
  let posts = [], kind = "";

  function postCard(p) {
    const card = make("article", grouped ? "draft" : "card");
    const hd = make("div", grouped ? "row" : "hd");
    hd.appendChild(make("span", "badge blue plain", label[p.channel] || p.channel));
    if (KIND[p.kind]) hd.appendChild(make("span", "badge plain", KIND[p.kind]));
    hd.appendChild(make("span", "grow"));
    hd.appendChild(make("span", "meta", when(p.published_at)));
    card.appendChild(hd);
    card.appendChild(make("div", grouped ? "text" : "post", p.text));
    return card;
  }

  function render() {
    const shown = posts.filter((p) => !kind || p.kind === kind);
    const tabs = el("kinds");
    if (tabs) {
      tabs.textContent = "";
      for (const k of ["", ...Object.keys(KIND)]) {
        const b = make("button", `tab${k === kind ? " on" : ""}`, k ? KIND[k] : "All posts");
        b.type = "button"; b.setAttribute("role", "tab"); b.setAttribute("aria-selected", String(k === kind));
        b.appendChild(make("span", "c", String(k ? posts.filter((p) => p.kind === k).length : posts.length)));
        b.addEventListener("click", () => { kind = k; render(); });
        tabs.appendChild(b);
      }
    }
    box.textContent = "";
    if (!shown.length) { box.appendChild(make("div", grouped ? "empty" : "card empty", posts.length ? "No posts of this type yet." : "No posts published yet.")); return; }
    let d = "";
    for (const p of shown) {
      if (grouped && day(p.published_at) !== d) { d = day(p.published_at); box.appendChild(make("div", "daygroup", d)); }
      box.appendChild(postCard(p));
    }
  }

  Promise.all([profile, fetch(`/api/public/archive?limit=${limit}`).then((r) => r.json())]).then(([, a]) => {
    posts = a?.posts ?? [];
    render();
  }).catch(() => {});
})();
