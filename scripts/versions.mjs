// Pure: the version hash in the URLs of the home and Performance pages' own files (frontend audit 2026-11-22, approved by
// the owner). public/_headers lets browsers keep these files for a year, so each page names the exact build it needs
// (`/home.css?v=<hash>`): a deploy that changes a file changes its URL. scripts/build-room.mjs writes the hashes into
// the pages; test/room.test.mjs keeps every page equal to the files.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

/** The files a page names with a version, and the pages that name them. */
export const VERSIONED = Object.freeze(["home.css", "home.js", "performance.js", "archive.js"]);
export const VERSIONED_PAGES = Object.freeze(["index.html", "performance.html", "archive.html"]);

const pub = (p) => new URL(`../public/${p}`, import.meta.url);
/** The first 12 hex characters of a public file's SHA-256. */
export const versionOf = (file) => createHash("sha256").update(readFileSync(pub(file))).digest("hex").slice(0, 12);
export const mannequinVersion = () => versionOf("room/mannequin.glb");

/** The page with each versioned file's `href`/`src` carrying that file's current hash. */
export function withVersions(html, version = versionOf) {
  let out = html;
  for (const f of VERSIONED) {
    const re = new RegExp(`((?:href|src)="/${f.replace(/\./g, "\\.")})(\\?v=[0-9a-f]+)?"`, "g");
    out = out.replace(re, (_, head) => `${head}?v=${version(f)}"`);
  }
  return out;
}
