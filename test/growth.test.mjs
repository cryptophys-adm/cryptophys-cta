// Growth tools (owner 2026-11-16, pro marketing part 2): A/B captions, best posting times, evergreen suggestions.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { engagement, bestTimes, abResult, evergreen, MIN_PER_BUCKET } from "../src/growth.mjs";
import { composeDrafts } from "../src/compose.mjs";

const T = "Education · XAUUSD\n\nGold held its range through London.\n\nEducational analysis by Cryptophys. Not an invitation to buy or sell, and not financial advice.\n#XAUUSD";
const post = (id, channel, iso, metrics, kind = "custom") => ({ id, channel, kind, published_at: iso, metrics, text: T });

test("engagement and the best WIB hours per channel, from at least two measured posts an hour", () => {
  assert.equal(engagement({ likes: 3, comments: 1, shares: null, saves: 2, reposts: 1, views: 100 }), 7);
  assert.equal(MIN_PER_BUCKET, 2);
  const posts = [
    post("a", "threads", "2026-11-16T12:05:00Z", { views: 900, likes: 9 }), // Mon 19:05 WIB
    post("b", "threads", "2026-11-09T12:40:00Z", { views: 700, likes: 5 }), // Mon 19:40 WIB
    post("c", "threads", "2026-11-17T01:00:00Z", { views: 300, likes: 2 }), // Tue 08:00 WIB
    post("d", "threads", "2026-11-10T01:30:00Z", { views: 100, likes: 1 }), // Tue 08:30 WIB
    post("e", "threads", "2026-11-11T01:30:00Z", { views: 5000 }),            // Wed 08:30: one post only
    post("f", "x", "2026-11-11T01:30:00Z", null)                              // not measured
  ];
  const r = bestTimes(posts);
  assert.deepEqual(r.threads.best, [{ day: "mon", time: "19:00", posts: 2, views: 800, engagement: 7 }, { day: "tue", time: "08:00", posts: 2, views: 200, engagement: 1.5 }]);
  assert.equal(r.threads.measured, 5);
  assert.equal(r.x, undefined);
});

test("an A/B result: waiting until both are measured; engagement per view wins", () => {
  const a = { id: "a", status: "published", metrics: { views: 1000, likes: 20 } };
  const b = { id: "b", status: "published", metrics: { views: 500, likes: 15 } };
  assert.equal(abResult(a, { id: "b", status: "approved", metrics: null }).state, "waiting");
  const r = abResult(a, b);
  assert.deepEqual([r.state, r.winner, r.a.rate, r.b.rate], ["measured", "B", 2, 3]);
  assert.equal(abResult({ ...a, metrics: { likes: 4 } }, { ...b, metrics: { likes: 4 } }).winner, "tie");
});

test("evergreen: custom posts only, old enough, best engagement first, not copied lately", () => {
  const now = Date.parse("2026-12-20T00:00:00Z");
  const posts = [
    post("old-good", "threads", "2026-11-01T00:00:00Z", { views: 100, likes: 30 }),
    post("old-ok", "threads", "2026-11-02T00:00:00Z", { views: 900, likes: 5 }),
    post("young", "threads", "2026-12-10T00:00:00Z", { likes: 99 }),
    post("levels", "threads", "2026-11-01T00:00:00Z", { likes: 99 }, "key_levels"),
    post("copied", "threads", "2026-11-01T00:00:00Z", { likes: 50 })
  ];
  assert.deepEqual(evergreen(posts, { now, copiedSince: new Set(["copied"]) }).map((p) => p.id), ["old-good", "old-ok"]);
});

test("composing an A/B pair: variant B checked the same way, never equal to A, both wait for approval", () => {
  const made = composeDrafts({ kind: "custom", posts: [{ channel: "threads", text: T, text_b: T.replace("held its range", "stayed in its range") }], now: Date.parse("2026-11-17T08:00:00Z"), id: "ab12cd34" });
  assert.ok(made.ok, JSON.stringify(made));
  assert.deepEqual(made.drafts.map((d) => d.id), ["manual:2026-11-17:ab12cd34:threads", "manual:2026-11-17:ab12cd34-b:threads"]);
  assert.deepEqual(made.ab, [{ grp: "ab:2026-11-17:ab12cd34:threads", a: made.drafts[0].id, b: made.drafts[1].id, channel: "threads" }]);
  const same = composeDrafts({ kind: "custom", posts: [{ channel: "threads", text: T, text_b: T }], id: "x" });
  assert.equal(same.results["threads:b"].guardian.failures[0].check, "variant");
  const bad = composeDrafts({ kind: "custom", posts: [{ channel: "threads", text: T, text_b: T.replace("Gold held", "Buy now, gold held") }], id: "x" });
  assert.equal(bad.ok, false, "nothing saved when B fails");
  assert.equal(composeDrafts({ kind: "custom", posts: [{ channel: "threads", text: T, text_b: "  " }], id: "y" }).drafts.length, 1, "an empty B is no test");
});

test("the studio shows A/B tests, best times and evergreen suggestions; Create offers a variant B", () => {
  const html = readFileSync(new URL("../public/studio/index.html", import.meta.url), "utf8");
  const js = readFileSync(new URL("../public/studio/studio.js", import.meta.url), "utf8");
  assert.ok(js.includes("/api/studio/growth"));
  assert.match(js, /text_b/);
  for (const id of ["abtests", "besttimes", "evergreen"]) assert.match(html, new RegExp(`id="${id}"`));
  assert.doesNotMatch(js + html, /innerHTML|<script>|style="/);
});
