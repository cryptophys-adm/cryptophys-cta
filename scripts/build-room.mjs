// Builds the home, Performance and Archive pages' scripts and fonts:
// - the holo war room: site/room/*.js and three.js into one minified ES module (public/room/room.js);
// - the page itself: site/home/home.js (the minutes, the header's clock and menu, the panels, the meeting dial, the TradingView quote, the
//   one feed of the rooms) into public/home.js;
// - the Performance page: site/performance/performance.js (the simulated track record) into public/performance.js;
// - the Archive page: site/archive/archive.js (the published posts) into public/archive.js;
// - the cast directory into public/index.html, from site/room/data.js;
// - the self-hosted fonts (Rajdhani, Newsreader; OFL, latin woff2 only) from @fontsource into public/fonts/;
// - public/room/build.json: the hash of the sources, of each bundle and of the mannequins, which test/room.test.mjs checks, so a source
//   change without a rebuild fails the tests;
// - the version hashes in the URLs of home.css, home.js, performance.js and archive.js in the pages, and of the mannequin in the
//   scene (scripts/versions.mjs): browsers keep these files for a year (public/_headers).
// The mannequins (public/room/mannequin.glb, mannequin-lo.glb) come from npm run build:mannequin. Run: npm run build:room
import { build } from "esbuild";
import { pathToFileURL, fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync, rmSync } from "node:fs";
import { withNavigator, sourceHash } from "./navigator.mjs";
import { FONTS } from "./fonts.mjs";
import { withVersions, mannequinVersion, mannequinLoVersion, VERSIONED_PAGES } from "./versions.mjs";

export { FONTS };

/**
 * The vendor entry, written from the scene's own imports: the THREE names main.js uses and the addons it imports, so
 * three.js stays tree-shaken and goes whole into the chunk the two entries share (public/room/three-<hash>.js).
 */
export function vendorSource(main) {
  const names = [...new Set([...main.matchAll(/\bTHREE\.([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]))].sort();
  const addons = [...main.matchAll(/^import (.+) from '(three\/addons\/[^']+)';$/gm)].map(([, what, from]) => `export ${what} from '${from}';`);
  return [`export { ${names.join(", ")} } from 'three';`, ...addons].join("\n");
}
const vendorEntry = (main, resolveDir) => ({
  name: "vendor-entry",
  setup(b) {
    b.onResolve({ filter: /^vendor:three$/ }, () => ({ path: "vendor", namespace: "vendor" }));
    b.onLoad({ filter: /.*/, namespace: "vendor" }, () => ({ contents: vendorSource(main), resolveDir, loader: "js" }));
  }
});

// Run as a script (not imported by the tests). pathToFileURL of the real path: a path with a space or other escaped
// character, a symlink or a Windows path never equals a hand-built file:// URL (orchestrator review of #64).
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const at = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));
  const opts = { bundle: true, format: "esm", minify: true, target: "es2020", legalComments: "none", logLevel: "warning" };
  // The mannequin's URL carries its file's hash (the scene and the page, which starts its download with the scene's).
  const mannequin = { __MANNEQUIN_VERSION__: JSON.stringify(mannequinVersion()), __MANNEQUIN_LO_VERSION__: JSON.stringify(mannequinLoVersion()) };
  // The scene and three.js apart (frontend audit 2026-11-22): esbuild splitting puts what the scene and the vendor entry
  // share, three.js and its addons, into public/room/three-<hash>.js, which room.js imports; the vendor entry's own
  // output is removed. A scene-only change then re-sends the scene's few KB, not three.js.
  for (const f of readdirSync(at("public/room"))) if (/^three-[A-Z0-9]+\.js$/i.test(f)) rmSync(at(`public/room/${f}`));
  await build({ ...opts, splitting: true, outdir: at("public/room"), entryPoints: { room: at("site/room/main.js"), vendor: "vendor:three" }, chunkNames: "three-[hash]", define: mannequin, plugins: [vendorEntry(readFileSync(at("site/room/main.js"), "utf8"), at("."))] });
  rmSync(at("public/room/vendor.js"));
  // /room/room.js is the scene's own file: the page imports it at run time, never into its bundle, with the scene's hash
  // in the URL (?v=), so a new scene is fetched at once although browsers keep /room/* for an hour.
  const roomHash = createHash("sha256").update(readFileSync(at("public/room/room.js"))).digest("hex");
  await build({ ...opts, entryPoints: [at("site/home/home.js")], outfile: at("public/home.js"), define: { __ROOM_VERSION__: JSON.stringify(roomHash.slice(0, 12)), ...mannequin } });
  await build({ ...opts, entryPoints: [at("site/performance/performance.js")], outfile: at("public/performance.js") });
  await build({ ...opts, entryPoints: [at("site/archive/archive.js")], outfile: at("public/archive.js") });
  mkdirSync(at("public/fonts"), { recursive: true });
  for (const [pkg, file] of FONTS) copyFileSync(at(`node_modules/@fontsource/${pkg}/files/${file}`), at(`public/fonts/${file}`));
  // Both families' licences in one file (the OFL asks for it to travel with the fonts).
  writeFileSync(at("public/fonts/OFL.txt"), [...new Set(FONTS.map(([p]) => p))].map((pkg) => `${pkg} (@fontsource/${pkg})\n\n${readFileSync(at(`node_modules/@fontsource/${pkg}/LICENSE`), "utf8").trim()}\n`).join("\n\n"));
  const three = JSON.parse(readFileSync(at("node_modules/three/package.json"), "utf8")).version;
  const sha = (p) => createHash("sha256").update(readFileSync(at(p))).digest("hex");
  const chunk = readdirSync(at("public/room")).find((f) => /^three-[A-Z0-9]+\.js$/i.test(f));
  writeFileSync(at("public/room/build.json"), `${JSON.stringify({ sources: sourceHash(), bundle: sha("public/room/room.js"), chunk, three_chunk: sha(`public/room/${chunk}`), mannequin: sha("public/room/mannequin.glb"), mannequin_lo: sha("public/room/mannequin-lo.glb"), home: sha("public/home.js"), performance: sha("public/performance.js"), archive: sha("public/archive.js"), three }, null, 2)}\n`);
  writeFileSync(at("public/index.html"), withNavigator(readFileSync(at("public/index.html"), "utf8")));
  for (const page of VERSIONED_PAGES) writeFileSync(at(`public/${page}`), withVersions(readFileSync(at(`public/${page}`), "utf8")));
  const kb = (p) => (readFileSync(at(p)).length / 1024).toFixed(0);
  console.log(`room.js ${kb("public/room/room.js")} KB, ${chunk} ${kb(`public/room/${chunk}`)} KB, home.js ${kb("public/home.js")} KB, performance.js ${kb("public/performance.js")} KB, archive.js ${kb("public/archive.js")} KB, three ${three}`);
}
