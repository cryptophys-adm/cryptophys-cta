// Builds the home page's scripts and fonts:
// - the holo war room: site/room/*.js and three.js into one minified ES module (public/room/room.js);
// - the page itself: site/home/home.js (the minutes, the status, the one feed of the rooms) into public/home.js;
// - the cast directory into public/index.html, from site/room/data.js;
// - the self-hosted fonts (Rajdhani, Newsreader; OFL, latin woff2 only) from @fontsource into public/fonts/;
// - public/room/build.json: the hash of the sources and of both bundles, which test/room.test.mjs checks, so a source
//   change without a rebuild fails the tests.
// The mannequin (public/room/mannequin.glb) is a committed file, not built. Run: npm run build:room
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { withNavigator, sourceHash } from "./navigator.mjs";
import { FONTS } from "./fonts.mjs";

export { FONTS };

if (import.meta.url === `file://${process.argv[1]}`) {
  const at = (p) => new URL(`../${p}`, import.meta.url).pathname;
  const opts = { bundle: true, format: "esm", minify: true, target: "es2020", legalComments: "none", logLevel: "warning" };
  await build({ ...opts, entryPoints: [at("site/room/main.js")], outfile: at("public/room/room.js") });
  // /room/room.js is the scene's own file: the page imports it at run time, never into its bundle.
  await build({ ...opts, entryPoints: [at("site/home/home.js")], outfile: at("public/home.js"), external: ["/room/room.js"] });
  mkdirSync(at("public/fonts"), { recursive: true });
  for (const [pkg, file] of FONTS) copyFileSync(at(`node_modules/@fontsource/${pkg}/files/${file}`), at(`public/fonts/${file}`));
  // Both families' licences in one file (the OFL asks for it to travel with the fonts).
  writeFileSync(at("public/fonts/OFL.txt"), [...new Set(FONTS.map(([p]) => p))].map((pkg) => `${pkg} (@fontsource/${pkg})\n\n${readFileSync(at(`node_modules/@fontsource/${pkg}/LICENSE`), "utf8").trim()}\n`).join("\n\n"));
  const three = JSON.parse(readFileSync(at("node_modules/three/package.json"), "utf8")).version;
  const sha = (p) => createHash("sha256").update(readFileSync(at(p))).digest("hex");
  writeFileSync(at("public/room/build.json"), `${JSON.stringify({ sources: sourceHash(), bundle: sha("public/room/room.js"), home: sha("public/home.js"), three }, null, 2)}\n`);
  writeFileSync(at("public/index.html"), withNavigator(readFileSync(at("public/index.html"), "utf8")));
  console.log(`room.js ${(readFileSync(at("public/room/room.js")).length / 1024).toFixed(0)} KB, home.js ${(readFileSync(at("public/home.js")).length / 1024).toFixed(0)} KB, three ${three}`);
}
