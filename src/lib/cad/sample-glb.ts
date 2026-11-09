import { generateDemoLayout } from "@/lib/demo/layout-generator";
import { bbox, type Pt } from "./geometry";
import { buildBoxesGlb, type GlbBox } from "./glb";

/**
 * DEMONSTRATION model: one box per demo plot, named PLOT_001 … so it maps onto
 * plot_geometry.mesh_id. Positions follow the 3D viewer's convention: the layout
 * (x east, y north) is centred on the bounds of plots + features, x → x, y → −z.
 */
export function buildDemoVentureGlb(): { glb: Buffer; names: string[] } {
  const layout = generateDemoLayout();
  const all: Pt[] = [...layout.plots.flatMap((p) => p.polygon), ...layout.features.flatMap((f) => f.polygon)];
  const b = bbox(all);
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const height = 0.5;
  const boxes: GlbBox[] = layout.plots.map((p) => {
    const pb = bbox(p.polygon);
    const w = (pb.maxX - pb.minX) * 0.97;
    const d = (pb.maxY - pb.minY) * 0.97;
    const mx = (pb.minX + pb.maxX) / 2 - cx;
    const my = (pb.minY + pb.maxY) / 2 - cy;
    return { name: p.meshId, center: [mx, height / 2, -my], size: [w, height, d], color: [0.82, 0.84, 0.9, 1] };
  });
  const glb = buildBoxesGlb(boxes, {
    generator: "uniklife-3d-venture scripts/generate-sample-glb.ts",
    extras: { demo: true, note: "DEMONSTRATION model — not a real or approved venture layout" },
  });
  return { glb, names: boxes.map((x) => x.name) };
}
