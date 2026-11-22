// Builds the war room's two mannequins from the source model (frontend audit 2026-11-22, owner approved):
// - public/room/mannequin.glb: the source quantized (KHR_mesh_quantization: positions 16-bit, normals and weights
//   8-bit), the same mesh, skeleton and look: 466 KiB to 266 KiB (43 % less);
// - public/room/mannequin-lo.glb: for phones and small GPUs (the scene's LOW), 58 % of the source's triangles
//   (meshoptimizer's simplifier at ratio 0.5 within its error bound), then quantized the same way: 157 KiB.
// It writes scripts/mannequin.lock.json: the source's and this recipe's sha256, the tools' versions and the outputs'
// sha256, which test/room.test.mjs RM12 holds against the committed files (orchestrator review of #64).
// Plain glTF that three's GLTFLoader reads without a decoder, so the CSP stays as it is (Draco and meshopt
// compression need WebAssembly in script-src). The source, site/room/mannequin.source.glb, is the file
// public/room/CREDITS.txt describes. Run: npm run build:mannequin (then npm run build:room for the URLs' hashes).
// The tools are imported only when this runs as a script: the tests read its constants before npm ci (CI runs them
// first), so this module must load without its dev dependencies.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";

export const QUANTIZE = Object.freeze({ quantizePosition: 16, quantizeNormal: 8, quantizeWeight: 8 });
export const SIMPLIFY = Object.freeze({ ratio: 0.5, error: 0.001 });

export const LOCK = "scripts/mannequin.lock.json";
export const SOURCE = "site/room/mannequin.source.glb";
export const OUTPUTS = Object.freeze(["public/room/mannequin.glb", "public/room/mannequin-lo.glb"]);
export const TOOLS = Object.freeze(["@gltf-transform/core", "@gltf-transform/extensions", "@gltf-transform/functions", "meshoptimizer"]);

// Run as a script. pathToFileURL of the real path: a hand-built file:// URL never equals import.meta.url for a path
// with a space, a symlink or on Windows, and the script then exited 0 having built nothing (orchestrator review).
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const { NodeIO } = await import("@gltf-transform/core");
  const { ALL_EXTENSIONS } = await import("@gltf-transform/extensions");
  const { quantize, simplify, weld, prune } = await import("@gltf-transform/functions");
  const { MeshoptSimplifier } = await import("meshoptimizer");
  const at = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));
  await MeshoptSimplifier.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const full = await io.read(at(SOURCE));
  await full.transform(quantize(QUANTIZE), prune());
  await io.write(at("public/room/mannequin.glb"), full);
  const lo = await io.read(at(SOURCE));
  await lo.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ...SIMPLIFY }), quantize(QUANTIZE), prune());
  await io.write(at("public/room/mannequin-lo.glb"), lo);
  const sha = (p) => createHash("sha256").update(readFileSync(at(p))).digest("hex");
  const version = (pkg) => JSON.parse(readFileSync(at(`node_modules/${pkg}/package.json`), "utf8")).version;
  const lock = { source: { [SOURCE]: sha(SOURCE) }, recipe: { "scripts/mannequin.mjs": sha("scripts/mannequin.mjs") }, tools: Object.fromEntries(TOOLS.map((t) => [t, version(t)])), quantize: QUANTIZE, simplify: SIMPLIFY, outputs: Object.fromEntries(OUTPUTS.map((o) => [o, sha(o)])) };
  writeFileSync(at(LOCK), `${JSON.stringify(lock, null, 2)}\n`);
  const kib = (p) => (readFileSync(at(p)).length / 1024).toFixed(0);
  console.log(`mannequin.glb ${kib("public/room/mannequin.glb")} KiB, mannequin-lo.glb ${kib("public/room/mannequin-lo.glb")} KiB, ${LOCK} written`);
}
