// Marketing tools (owner 2026-11-16: "kerjakan tambahan pro marketing juga"): tracked links with UTM tags (never an
// open redirect, nothing about the person), hashtag sets, the weekly content mix.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { normalizeLink, linkHosts, redirectTarget, shortUrl, randomSlug, SLUG, GO_PATH, normalizeHashtagSet, withHashtagLine, normalizeMix, DEFAULT_MIX, wibWeek, mixReport } from "../src/marketing.mjs";
import { addLink, getLink, countClick, listLinks, saveHashtagSet, listHashtagSets, kindMixSince, addDrafts, decideDraft, recordPublish } from "../src/desk.mjs";
import { checkContentDraft } from "../src/guardian.mjs";

const sqlite = () => { const db = new DatabaseSync(":memory:"); return { exec(q, ...b) { const s = db.prepare(q); const out = /^\s*SELECT/i.test(q) ? s.all(...b) : (s.run(...b), []); return { toArray: () => out.map((r) => ({ ...r })) }; } }; };

test("a tracked link: our own or the brand's profile hosts only, https, the UTM tags of the channel and campaign", () => {
  const hosts = linkHosts({});
  assert.deepEqual(hosts, ["cta.cryptophys.work", "www.threads.net"]);
  assert.equal(normalizeLink({ target: "https://cta.cryptophys.work/", campaign: "Gold-Week_47" }, { hosts }).link.campaign, "gold-week_47", "lower case");
  assert.equal(normalizeLink({ target: "https://cta.cryptophys.work/", campaign: "gold week" }, { hosts }).ok, false);
  const n = normalizeLink({ target: "https://cta.cryptophys.work/archive?utm_source=old&x=1", campaign: "gold-week_47", label: " Archive " }, { hosts });
  assert.deepEqual(n.link, { target: "https://cta.cryptophys.work/archive?x=1", campaign: "gold-week_47", label: "Archive" }, "old UTM tags dropped");
  assert.equal(redirectTarget(n.link, "threads"), "https://cta.cryptophys.work/archive?x=1&utm_source=threads&utm_medium=social&utm_campaign=gold-week_47");
  for (const target of ["http://cta.cryptophys.work/", "https://evil.example/", "https://cta.cryptophys.work.evil.example/", "https://user:pw@cta.cryptophys.work/", "javascript:alert(1)", "/archive"]) {
    assert.equal(normalizeLink({ target, campaign: "x" }, { hosts }).ok, false, target);
  }
  assert.deepEqual(linkHosts({ LINK_HOSTS: "cta.cryptophys.work, cryptophys.work" }), ["cta.cryptophys.work", "cryptophys.work", "www.threads.net"]);
  const slug = randomSlug();
  assert.match(slug, SLUG);
  assert.equal(shortUrl("https://cta.cryptophys.work", slug, "x"), `https://cta.cryptophys.work/go/${slug}/x`);
  assert.deepEqual(GO_PATH.exec(`/go/${slug}/telegram`).slice(1), [slug, "telegram"]);
  assert.equal(GO_PATH.exec(`/go/${slug}/myspace`), null);
  // A short link in a post never reads as a price to the guardian (letters only).
  const text = `Education · XAUUSD\n\nRead the archive: ${shortUrl("https://cta.cryptophys.work", "qwertyui", "threads")}\n\nNot financial advice.`;
  assert.equal(checkContentDraft({ text, now: Date.now() }).pass, true);
});

test("clicks: per link, channel and WIB day; the list sums them", () => {
  const sql = sqlite();
  const n = normalizeLink({ target: "https://cta.cryptophys.work/", campaign: "launch" }, { hosts: linkHosts({}) });
  assert.equal(addLink(sql, { slug: "abcdefgh", link: n.link, actor: "owner@example.com" }).ok, true);
  assert.equal(addLink(sql, { slug: "abcdefgh", link: n.link, actor: "o" }).error, "slug taken");
  for (const [ch, at] of [["threads", "2026-11-16T16:59:00Z"], ["threads", "2026-11-16T17:01:00Z"], ["x", "2026-11-16T10:00:00Z"]]) countClick(sql, { slug: "abcdefgh", channel: ch }, { now: Date.parse(at) });
  const [l] = listLinks(sql);
  assert.deepEqual([l.total, l.clicks], [3, { threads: 2, x: 1 }]);
  assert.deepEqual(sql.exec("SELECT day, n FROM link_clicks WHERE channel = 'threads' ORDER BY day").toArray(), [{ day: "2026-11-16", n: 1 }, { day: "2026-11-17", n: 1 }], "the WIB day");
  assert.deepEqual(Object.keys(sql.exec("SELECT * FROM link_clicks").toArray()[0]).sort(), ["channel", "day", "n", "slug"], "nothing about the person");
  assert.equal(getLink(sql, "zzzzzzzz"), null);
});

test("hashtag sets and the hashtag line of a post", () => {
  const sql = sqlite();
  assert.deepEqual(normalizeHashtagSet({ name: "Gold core", tags: "#XAUUSD  #gold #XAUUSD" }).set, { name: "Gold core", tags: "#XAUUSD #gold" });
  for (const bad of [{ name: "", tags: "#a" }, { name: "x", tags: "gold" }, { name: "x", tags: "#nexus" }, { name: "x", tags: Array.from({ length: 9 }, (_, i) => `#t${i}`).join(" ") }, { name: "<b>", tags: "#a" }]) assert.equal(normalizeHashtagSet(bad).ok, false, JSON.stringify(bad));
  saveHashtagSet(sql, { set: { name: "a", tags: "#a" }, actor: "o" });
  saveHashtagSet(sql, { set: { name: "a", tags: "#b" }, actor: "o" });
  assert.deepEqual(listHashtagSets(sql).map((x) => [x.name, x.tags]), [["a", "#b"]]);
  assert.match(saveHashtagSet(sql, { set: { name: "b", tags: "#c" }, actor: "o", max: 1 }).error, /at most 1/);
  saveHashtagSet(sql, { set: { name: "a" }, remove: true, actor: "o" });
  assert.deepEqual(listHashtagSets(sql), []);
  assert.equal(withHashtagLine("Education.\nNot advice.\n#XAUUSD #gold", "#XAUUSD #edu"), "Education.\nNot advice.\n#XAUUSD #edu");
  assert.equal(withHashtagLine("Education.\nNot advice.\n", "#XAUUSD"), "Education.\nNot advice.\n#XAUUSD");
});

test("the content mix: targets add up to 100; the WIB week; actual against target", () => {
  assert.deepEqual(normalizeMix(DEFAULT_MIX).mix, DEFAULT_MIX);
  assert.match(normalizeMix({ key_levels: 50, pattern: 40 }).error, /add up to 90%/);
  assert.equal(normalizeMix({ ...DEFAULT_MIX, custom: 10.5 }).ok, false);
  assert.deepEqual(wibWeek(Date.parse("2026-11-16T16:59:00Z")), { from: "2026-11-15T17:00:00.000Z", to: "2026-11-22T17:00:00.000Z" }, "Monday 23:59 WIB");
  assert.deepEqual(wibWeek(Date.parse("2026-11-15T16:59:00Z")).from, "2026-11-08T17:00:00.000Z", "Sunday 23:59 WIB is the week before");
  const r = mixReport(DEFAULT_MIX, { pattern: 3, custom: 1 });
  assert.equal(r.total, 4);
  assert.deepEqual(r.kinds.find((k) => k.kind === "pattern"), { kind: "pattern", target: 40, actual: 75, posts: 3, gap: 35 });
  const sql = sqlite();
  addDrafts(sql, [{ id: "a", kind: "pattern", channel: "x", text: "Education only. Not financial advice.", status: "pending" }, { id: "b", kind: "custom", channel: "x", text: "Education only. Not financial advice. b", status: "pending" }], { now: Date.parse("2026-11-16T05:00:00Z") });
  decideDraft(sql, { id: "a", decision: "approve", actor: "o" }, { now: Date.parse("2026-11-16T06:00:00Z") });
  assert.deepEqual(kindMixSince(sql, "2026-11-15T17:00:00.000Z", "2026-11-22T17:00:00.000Z"), { pattern: 1 }, "only approved or published");
  recordPublish(sql, { id: "a", remoteId: "1" }, { now: Date.parse("2026-11-23T01:00:00Z") });
  assert.deepEqual(kindMixSince(sql, "2026-11-15T17:00:00.000Z", "2026-11-22T17:00:00.000Z"), {}, "counted in the week it was published");
});

test("the Marketing page: links, hashtag sets and the content mix through the studio API; no inline script", () => {
  const html = readFileSync(new URL("../public/studio/index.html", import.meta.url), "utf8");
  const js = readFileSync(new URL("../public/studio/studio.js", import.meta.url), "utf8");
  assert.match(html, /data-view="marketing"/);
  for (const p of ["/api/studio/links", "/api/studio/hashtag-sets", "/api/studio/mix"]) assert.ok(js.includes(p), p);
  assert.doesNotMatch(js + html, /innerHTML|<script>|style="/);
});
