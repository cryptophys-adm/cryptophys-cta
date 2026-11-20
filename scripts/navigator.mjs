// Pure: the navigator (the cast directory under the war room) as static HTML, from site/room/data.js. It is written into
// public/index.html by scripts/build-room.mjs, so screen readers and visitors without WebGL or JavaScript read the
// same roles; test/room.test.mjs keeps the page equal to the data.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { PEOPLE, DEPTS } from "../site/room/data.js";

/** The hash of the pages' sources (site/room, site/home and site/performance *.js), recorded in public/room/build.json. No dependency. */
export function sourceHash() {
  const h = createHash("sha256");
  for (const sub of ["room", "home", "performance"]) {
    const dir = new URL(`../site/${sub}/`, import.meta.url);
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".js")).sort()) h.update(`${sub}/${f}`).update("\0").update(readFileSync(new URL(f, dir))).update("\0");
  }
  return h.digest("hex");
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const MARK_START = "<!-- agents:start (written by scripts/build-room.mjs from site/room/data.js) -->";
export const MARK_END = "<!-- agents:end -->";

/**
 * The cast as a directory grouped by department (owner 2026-11-19, the homepage redesign): each agent's title and its
 * own role. The title is a button that shows the agent in the 3D room when the scene runs.
 */
export function navigatorHtml() {
  const out = [];
  const at = PEOPLE.filter((p) => p.dept === "hall").length;
  out.push(`    <p class="cast-count">${PEOPLE.length} agents. ${at === 16 ? "Sixteen" : at} argue at the table; the rest lead, research, write, learn and keep the platform running.</p>`);
  out.push(`    <div class="cast-groups">`);
  for (const d of DEPTS) {
    const people = PEOPLE.filter((p) => p.dept === d.id);
    if (!people.length) continue;
    out.push(`      <section class="group" aria-labelledby="g-${d.id}">`);
    out.push(`        <h3 id="g-${d.id}">${esc(d.label)}<small>${people.length} ${people.length === 1 ? "agent" : "agents"}</small></h3>`);
    out.push(`        <dl class="people">`);
    for (const p of people) out.push(`          <div><dt><button type="button" data-agent="${esc(p.id)}">${esc(p.title)}</button></dt><dd>${esc(p.role)}</dd></div>`);
    out.push("        </dl>");
    out.push("      </section>");
  }
  out.push("    </div>");
  return out.join("\n");
}

/** The page with the navigator written between its markers. */
export function withNavigator(page) {
  const a = page.indexOf(MARK_START), b = page.indexOf(MARK_END);
  if (a < 0 || b < a) throw new Error("public/index.html has no agents markers");
  return `${page.slice(0, a + MARK_START.length)}\n${navigatorHtml()}\n    ${page.slice(b)}`;
}
