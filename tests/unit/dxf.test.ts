import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseDxf, DxfParseError } from "@/lib/cad/dxf";
import { buildImportPreview, meshIdForPlot, normalizePlotLabel } from "@/lib/cad/import";
import { isSelfIntersecting, polygonArea, SQ_M_TO_SQ_YD } from "@/lib/cad/geometry";
import { buildBoxesGlb, glbMeshNodeNames, readGlb } from "@/lib/cad/glb";
import { buildDemoVentureGlb } from "@/lib/cad/sample-glb";

/** Builds an ASCII DXF string from group-code/value pairs. */
function dxf(pairs: (string | number)[]): string {
  return pairs.map(String).join("\n") + "\n";
}
const header = (insunits: number | null) =>
  insunits === null ? ["0", "SECTION", "2", "HEADER", "0", "ENDSEC"] : ["0", "SECTION", "2", "HEADER", "9", "$INSUNITS", "70", insunits, "0", "ENDSEC"];
const lw = (layer: string, pts: [number, number][], closed = true) => [
  "0", "LWPOLYLINE", "8", layer, "90", pts.length, "70", closed ? 1 : 0, ...pts.flatMap(([x, y]) => ["10", x, "20", y]),
];
const text = (layer: string, x: number, y: number, t: string) => ["0", "TEXT", "8", layer, "10", x, "20", y, "40", 1, "1", t];
const mtext = (layer: string, x: number, y: number, t: string) => ["0", "MTEXT", "8", layer, "10", x, "20", y, "1", t];
const rect = (x: number, y: number, w: number, h: number): [number, number][] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];

function fixture(insunits: number | null) {
  return dxf([
    ...header(insunits),
    "0", "SECTION", "2", "ENTITIES",
    ...lw("PLOTS", rect(0, 0, 30, 50)),
    ...lw("PLOTS", rect(30, 0, 30, 50)),
    ...lw("PLOTS", rect(60, 0, 30, 50)),
    ...lw("PLOTS", [[0, 60], [90, 60], [90, 70]], false), // open polyline → ignored
    ...lw("ROAD", rect(0, -40, 90, 40)),
    ...text("LABELS", 15, 25, "1"),
    ...text("LABELS", 45, 25, "PLOT 2"),
    ...mtext("LABELS", 75, 25, "{\\fArial;003}"),
    ...text("ROAD", 45, -20, "40 ft road"),
    "0", "ENDSEC", "0", "EOF",
  ]);
}

describe("DXF parser", () => {
  it("extracts closed LWPOLYLINEs with layers and text labels, ignoring open polylines", () => {
    const r = parseDxf(fixture(6));
    expect(r.unitName).toBe("metres");
    const plots = r.polygons.filter((p) => p.layer === "PLOTS");
    expect(plots).toHaveLength(3);
    expect(r.polygons.filter((p) => p.layer === "ROAD")).toHaveLength(1);
    expect(r.openPolylines).toBe(1);
    expect(plots[0].points).toEqual([[0, 0], [30, 0], [30, 50], [0, 50]]);
    expect(r.texts.map((t) => t.text)).toEqual(["1", "PLOT 2", "003", "40 ft road"]);
  });

  it("converts feet, inches, millimetres and centimetres to metres via $INSUNITS", () => {
    const ft = parseDxf(fixture(2));
    expect(ft.unitName).toBe("feet");
    expect(ft.polygons[0].points[2][0]).toBeCloseTo(30 * 0.3048, 6);
    expect(polygonArea(ft.polygons[0].points)).toBeCloseTo(30 * 50 * 0.3048 ** 2, 6);
    expect(ft.texts[0].position[0]).toBeCloseTo(15 * 0.3048, 6);
    expect(parseDxf(fixture(1)).polygons[0].points[1][0]).toBeCloseTo(30 * 0.0254, 9);
    expect(parseDxf(fixture(4)).polygons[0].points[1][0]).toBeCloseTo(0.03, 9);
    expect(parseDxf(fixture(5)).polygons[0].points[1][0]).toBeCloseTo(0.3, 9);
    const none = parseDxf(fixture(null));
    expect(none.scaleToMetres).toBe(1);
    expect(none.warnings.join(" ")).toMatch(/INSUNITS/);
  });

  it("reads R12 POLYLINE/VERTEX outlines and treats a repeated first vertex as closed", () => {
    const r = parseDxf(dxf([
      "0", "SECTION", "2", "ENTITIES",
      "0", "POLYLINE", "8", "PLOT", "66", 1, "70", 1,
      "0", "VERTEX", "8", "PLOT", "10", 0, "20", 0,
      "0", "VERTEX", "8", "PLOT", "10", 10, "20", 0,
      "0", "VERTEX", "8", "PLOT", "10", 10, "20", 10,
      "0", "SEQEND",
      ...lw("PLOT", [[20, 0], [30, 0], [30, 10], [20, 10], [20, 0]], false),
      "0", "ENDSEC", "0", "EOF",
    ]));
    expect(r.polygons).toHaveLength(2);
    expect(r.polygons[0].entity).toBe("POLYLINE");
    expect(r.polygons[1].points).toHaveLength(4);
  });

  it("rejects binary DXF / DWG / non-DXF input", () => {
    expect(() => parseDxf("AutoCAD Binary DXF\r\n\x1a\x00")).toThrow(DxfParseError);
    expect(() => parseDxf("AC1032 binary")).toThrow(/DWG/);
    expect(() => parseDxf("hello\nworld\n")).toThrow(DxfParseError);
  });
});

describe("DXF import matching", () => {
  const plots = [
    { id: "p1", plotNumber: "1", areaSqYards: 166.67, meshId: null },
    { id: "p2", plotNumber: "2", areaSqYards: 166.67, meshId: null },
    { id: "p3", plotNumber: "3", areaSqYards: 200, meshId: null },
    { id: "p4", plotNumber: "4", areaSqYards: 166.67, meshId: null },
  ];

  it("matches by label inside the outline, flags >3% area deviation and lists unmatched plots", () => {
    const preview = buildImportPreview(parseDxf(fixture(2)), plots);
    expect(preview.matchMode).toBe("label");
    expect(preview.polygons.map((p) => p.plotNumber)).toEqual(["1", "2", "3"]);
    expect(preview.polygons[0].areaSqYards).toBeCloseTo(166.67, 1);
    expect(preview.polygons[0].deviationFlag).toBe(false);
    expect(preview.polygons[2].deviationFlag).toBe(true); // 166.67 vs recorded 200
    expect(preview.unmatchedPlots.map((p) => p.plotNumber)).toEqual(["4"]);
    expect(preview.features).toEqual([expect.objectContaining({ kind: "road", name: "40 ft road" })]);
    expect(preview.summary.applicable).toBe(3);
  });

  it("reports duplicate labels, zero-area and self-intersecting outlines as conflicts", () => {
    const parsed = parseDxf(dxf([
      "0", "SECTION", "2", "ENTITIES",
      ...lw("PLOTS", rect(0, 0, 10, 10)),
      ...lw("PLOTS", rect(20, 0, 10, 10)),
      ...lw("PLOTS", [[40, 0], [50, 10], [50, 0], [40, 10]]), // bow-tie
      ...lw("PLOTS", [[60, 0], [70, 0], [80, 0]]), // zero area
      ...text("T", 5, 5, "1"), ...text("T", 25, 5, "1"), ...text("T", 42, 5, "2"), ...text("T", 70, 0, "3"),
      "0", "ENDSEC", "0", "EOF",
    ]));
    const preview = buildImportPreview(parsed, plots);
    expect(preview.duplicateLabels).toEqual(["1"]);
    expect(preview.polygons.filter((p) => p.duplicate)).toHaveLength(2);
    const bow = preview.polygons.find((p) => p.index === 2)!;
    expect(bow.selfIntersecting).toBe(true);
    expect(preview.polygons.find((p) => p.index === 3)!.zeroArea).toBe(true);
    expect(preview.summary.applicable).toBe(0);
  });

  it("falls back to order matching when no labels exist", () => {
    const parsed = parseDxf(dxf(["0", "SECTION", "2", "ENTITIES", ...lw("0", rect(0, 0, 5, 5)), ...lw("0", rect(5, 0, 5, 5)), "0", "ENDSEC", "0", "EOF"]));
    const preview = buildImportPreview(parsed, plots);
    expect(preview.matchMode).toBe("order");
    expect(preview.polygons.map((p) => p.plotNumber)).toEqual(["1", "2"]);
    expect(preview.warnings.join(" ")).toMatch(/BY ORDER/);
  });

  it("helpers: label normalisation, mesh ids, sq m → sq yd, self-intersection", () => {
    expect(normalizePlotLabel("Plot No. 007")).toBe("7");
    expect(normalizePlotLabel("A-12")).toBe("A-12");
    expect(meshIdForPlot("7")).toBe("PLOT_007");
    expect(meshIdForPlot("A-12")).toBe("PLOT_A_12");
    expect(SQ_M_TO_SQ_YD).toBeCloseTo(1 / 0.83612736, 6);
    expect(isSelfIntersecting(rect(0, 0, 1, 1))).toBe(false);
  });
});

describe("GLB writer", () => {
  it("writes a valid GLB 2.0 container with a JSON chunk and the expected node names", () => {
    const { glb, names } = buildDemoVentureGlb();
    expect(glb.readUInt32LE(0)).toBe(0x46546c67);
    expect(glb.toString("ascii", 0, 4)).toBe("glTF");
    expect(glb.readUInt32LE(4)).toBe(2);
    expect(glb.readUInt32LE(8)).toBe(glb.length);
    expect(glb.toString("ascii", 16, 20)).toBe("JSON");
    const info = readGlb(glb);
    expect(info.json.asset?.version).toBe("2.0");
    const nodeNames = glbMeshNodeNames(info);
    expect(nodeNames).toHaveLength(80);
    expect(nodeNames[0]).toBe("PLOT_001");
    expect(nodeNames).toContain("PLOT_080");
    expect(nodeNames).toEqual(names);
    expect(info.binLength).toBeGreaterThan(0);
    expect(info.binLength % 4).toBe(0);
  });

  it("the committed sample public/samples/demo-venture.glb is valid and identical to the generator output", () => {
    const file = path.resolve(process.cwd(), "public/samples/demo-venture.glb");
    expect(existsSync(file)).toBe(true);
    const buf = readFileSync(file);
    const info = readGlb(buf);
    expect(glbMeshNodeNames(info).slice(0, 3)).toEqual(["PLOT_001", "PLOT_002", "PLOT_003"]);
    expect(buf.equals(buildDemoVentureGlb().glb)).toBe(true);
  });

  it("rejects corrupted containers", () => {
    const glb = buildBoxesGlb([{ name: "PLOT_001", center: [0, 0, 0], size: [1, 1, 1] }]);
    const bad = Buffer.from(glb);
    bad.writeUInt32LE(1, 4);
    expect(() => readGlb(bad)).toThrow(/version/);
    expect(() => readGlb(glb.subarray(0, glb.length - 4))).toThrow(/length/);
  });
});
