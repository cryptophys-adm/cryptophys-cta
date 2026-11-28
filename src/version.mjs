// The deployed version, for the platform's drift check and census (desired_version, option B, organ side; orchestrator
// 2026-11-28). deploy.yml uploads each version with `--tag <commit12>`; the Worker reads it back from its
// CF_VERSION_METADATA binding. No variable is set from the workflow (wrangler.jsonc stays the Worker's whole config),
// and nothing is read from git at run time.

const TAG = /^[0-9a-f]{12}$/;

/**
 * The running version from the `CF_VERSION_METADATA` binding: `{ id, tag, timestamp }`, each null when unknown. `tag`
 * is the commit's first 12 characters (deploy.yml's `--tag`); a tag of any other shape (a version uploaded from outside
 * the workflow) is reported as null, so the platform never reads it as a commit.
 */
export function versionOf(env) {
  const m = env?.CF_VERSION_METADATA ?? {};
  const tag = String(m.tag ?? "").toLowerCase();
  const at = Date.parse(m.timestamp ?? "");
  return {
    id: typeof m.id === "string" && m.id ? m.id : null,
    tag: TAG.test(tag) ? tag : null,
    timestamp: Number.isFinite(at) ? new Date(at).toISOString() : null
  };
}

/**
 * The DNA served by OrganismDna.dna(): organism.json plus `deploy_commit`, the running version's tag (the commit's
 * first 12 characters, written by the deploy's `--tag`), and `deployed_at`, that version's upload time. Both are null
 * when the version carries no commit tag ("untracked"). organism.json itself never changes.
 */
export function organismDna(organism, env) {
  const v = versionOf(env);
  return { ...JSON.parse(JSON.stringify(organism)), deploy_commit: v.tag, deployed_at: v.tag ? v.timestamp : null };
}
