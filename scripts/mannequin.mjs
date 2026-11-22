// Builds the war room's two mannequins from the source model (frontend audit 2026-11-22, owner approved):
// - public/room/mannequin.glb: the source quantized (KHR_mesh_quantization: positions 16-bit, normals and weights
//   8-bit), the same mesh, skeleton and look in about half the bytes;
// - public/room/mannequin-lo.glb: for phones and small GPUs (the scene's LOW), about half the triangles
//   (meshoptimizer's simplifier at build time), then quantized the same way.
// Plain glTF that three's GLTFLoader reads without a decoder, so the CSP stays as it is (Draco and meshopt
// compression need WebAssembly in script-src). The source, site/room/mannequin.source.glb, is the file
// public/room/CREDITS.txt describes. Run: npm run build:mannequin (then npm run build:room for the URLs' hashes).
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { quantize, simplify, weld, prune } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";

export const QUANTIZE = Object.freeze({ quantizePosition: 16, quantizeNormal: 8, quantizeWeight: 8 });
export const SIMPLIFY = Object.freeze({ ratio: 0.5, error: 0.001 });

if (import.meta.url === `file://${process.argv[1]}`) {
  const at = (p) => new URL(`../${p}`, import.meta.url).pathname;
  await MeshoptSimplifier.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const full = await io.read(at("site/room/mannequin.source.glb"));
  await full.transform(quantize(QUANTIZE), prune());
  await io.write(at("public/room/mannequin.glb"), full);
  const lo = await io.read(at("site/room/mannequin.source.glb"));
  await lo.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ...SIMPLIFY }), quantize(QUANTIZE), prune());
  await io.write(at("public/room/mannequin-lo.glb"), lo);
  const { statSync } = await import("node:fs");
  const kb = (p) => (statSync(at(p)).size / 1024).toFixed(0);
  console.log(`mannequin.glb ${kb("public/room/mannequin.glb")} KB, mannequin-lo.glb ${kb("public/room/mannequin-lo.glb")} KB`);
}
