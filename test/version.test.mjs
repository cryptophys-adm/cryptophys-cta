// The running version and the deployed commit (src/version.mjs): /health, CtaHealth.health() and OrganismDna.dna().
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { versionOf, organismDna } from "../src/version.mjs";
import { handle } from "../src/app.mjs";

const ORGANISM = JSON.parse(readFileSync(new URL("../organism.json", import.meta.url), "utf8"));
const SHA = "cccd50548da97bb55bc507f4142eb684b6b9524d";
const META = { id: "0f3c-version", tag: SHA.slice(0, 12), timestamp: "2026-11-28T04:40:01.123Z" };

test("V1. versionOf reads CF_VERSION_METADATA; a tag that is not a 12-character commit is null", () => {
  assert.deepEqual(versionOf({ CF_VERSION_METADATA: META }), { id: "0f3c-version", tag: "cccd50548da9", timestamp: "2026-11-28T04:40:01.123Z" });
  assert.deepEqual(versionOf({}), { id: null, tag: null, timestamp: null }, "no binding");
  assert.equal(versionOf({ CF_VERSION_METADATA: { ...META, tag: "" } }).tag, null, "uploaded without --tag");
  assert.equal(versionOf({ CF_VERSION_METADATA: { ...META, tag: "hotfix" } }).tag, null, "never read as a commit");
  assert.equal(versionOf({ CF_VERSION_METADATA: { ...META, tag: SHA } }).tag, null, "the full sha is not the tag's shape");
  assert.equal(versionOf({ CF_VERSION_METADATA: { ...META, tag: "CCCD50548DA9" } }).tag, "cccd50548da9");
});

test("V2. GET /health carries the running version", async () => {
  const r = await handle(new Request("https://cta.cryptophys.work/health"), { CONTENT_PUBLISH: "on", PUBLISH_CHANNELS: "threads", CF_VERSION_METADATA: META });
  const j = await r.json();
  assert.deepEqual([j.ok, j.service, j.version.tag, j.version.id], [true, "cryptophys-cta", "cccd50548da9", "0f3c-version"]);
  const none = await (await handle(new Request("https://cta.cryptophys.work/health"), {})).json();
  assert.deepEqual(none.version, { id: null, tag: null, timestamp: null });
});

test("V3. the DNA names the deployed commit from the running version's tag, else null", () => {
  const dna = organismDna(ORGANISM, { CF_VERSION_METADATA: META });
  assert.deepEqual([dna.deploy_commit, dna.deployed_at], ["cccd50548da9", "2026-11-28T04:40:01.123Z"]);
  assert.deepEqual([dna.schema, dna.organs], [ORGANISM.schema, ORGANISM.organs], "the census reads schema and organs as before");
  for (const env of [{}, { CF_VERSION_METADATA: { ...META, tag: "" } }, { CF_VERSION_METADATA: { ...META, tag: "hotfix" } }]) {
    const u = organismDna(ORGANISM, env);
    assert.deepEqual([u.deploy_commit, u.deployed_at], [null, null], "untracked: " + JSON.stringify(env));
  }
  assert.equal(ORGANISM.deploy_commit, undefined, "organism.json itself is never changed");
});
