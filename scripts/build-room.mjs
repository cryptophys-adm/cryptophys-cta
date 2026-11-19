// Builds the holo war room: site/room/*.js and three.js into one minified ES module (public/room/room.js), the
// navigator into public/index.html, and public/room/build.json (the hash of the sources it was built from, which
// test/room.test.mjs checks, so a source change without a rebuild fails the tests). The mannequin
// (public/room/mannequin.glb) is a committed file, not built. Run: npm run build:room
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { withNavigator, sourceHash } from "./navigator.mjs";

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = new URL("../public/room/room.js", import.meta.url).pathname;
  await build({ entryPoints: [new URL("../site/room/main.js", import.meta.url).pathname], bundle: true, format: "esm", minify: true, target: "es2020", legalComments: "none", outfile: out, logLevel: "warning" });
  const three = JSON.parse(readFileSync(new URL("../node_modules/three/package.json", import.meta.url), "utf8")).version;
  const bundle = createHash("sha256").update(readFileSync(out)).digest("hex");
  writeFileSync(new URL("../public/room/build.json", import.meta.url), `${JSON.stringify({ sources: sourceHash(), bundle, three }, null, 2)}\n`);
  const page = new URL("../public/index.html", import.meta.url);
  writeFileSync(page, withNavigator(readFileSync(page, "utf8")));
  console.log(`room.js ${(readFileSync(out).length / 1024).toFixed(0)} KB, three ${three}`);
}
