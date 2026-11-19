// Pure: the navigator (the agent list under the war room) as static HTML, from site/room/data.js. It is written into
// public/index.html by scripts/build-room.mjs, so screen readers and visitors without WebGL or JavaScript read the
// same roles; test/room.test.mjs keeps the page equal to the data.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { PEOPLE, DEPTS } from "../site/room/data.js";

/** The hash of the scene's sources (site/room/*.js), recorded in public/room/build.json by the build. No dependency. */
export function sourceHash() {
  const dir = new URL("../site/room/", import.meta.url), h = createHash("sha256");
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".js")).sort()) h.update(f).update("\0").update(readFileSync(new URL(f, dir))).update("\0");
  return h.digest("hex");
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const MARK_START = "<!-- agents:start (written by scripts/build-room.mjs from site/room/data.js) -->";
export const MARK_END = "<!-- agents:end -->";

export function navigatorHtml() {
  const out = [];
  for (const d of DEPTS) {
    const people = PEOPLE.filter((p) => p.dept === d.id);
    if (!people.length) continue;
    out.push(`    <h3 class="group" id="g-${d.id}">${esc(d.label)}</h3>`);
    out.push(`    <ul aria-labelledby="g-${d.id}">`);
    for (const p of people) out.push(`      <li><button type="button" data-agent="${esc(p.id)}"><b>${esc(p.name)}</b><span class="t">${esc(p.title)}</span></button><p>${esc(p.role)}</p></li>`);
    out.push("    </ul>");
  }
  return out.join("\n");
}

/** The page with the navigator written between its markers. */
export function withNavigator(page) {
  const a = page.indexOf(MARK_START), b = page.indexOf(MARK_END);
  if (a < 0 || b < a) throw new Error("public/index.html has no agents markers");
  return `${page.slice(0, a + MARK_START.length)}\n${navigatorHtml()}\n    ${page.slice(b)}`;
}
