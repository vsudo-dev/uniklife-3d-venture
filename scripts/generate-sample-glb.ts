/**
 * Writes public/samples/demo-venture.glb — a DEMONSTRATION binary glTF 2.0 model
 * with one box per demo plot (nodes PLOT_001 … PLOT_080) positioned from the demo
 * layout polygons. Hand-built (no browser APIs). Does not touch the database.
 *
 *   npm run assets:sample-glb
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildDemoVentureGlb } from "../src/lib/cad/sample-glb";
import { glbMeshNodeNames, readGlb } from "../src/lib/cad/glb";

async function main() {
  const { glb } = buildDemoVentureGlb();
  const info = readGlb(glb); // self-check
  const out = path.resolve(process.cwd(), "public", "samples", "demo-venture.glb");
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, glb);
  const names = glbMeshNodeNames(info);
  console.log(`Wrote ${out} (${glb.length} bytes, ${names.length} plot meshes: ${names[0]} … ${names[names.length - 1]})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
