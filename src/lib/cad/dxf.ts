/**
 * Dependency-free ASCII DXF reader (R12 / R2000+ ASCII). Extracts CLOSED
 * LWPOLYLINE and POLYLINE/VERTEX outlines with their layer names, plus TEXT /
 * MTEXT labels, converted to metres using the $INSUNITS header variable.
 *
 * Deliberately limited: arcs (bulges) are approximated by their chords, blocks /
 * INSERTs are not exploded, and binary DXF / DWG are not supported. Imported
 * geometry must always be checked against the approved survey drawings.
 */
import { normalizeRing, type Pt } from "./geometry";

export interface DxfPolygon {
  index: number;
  layer: string;
  entity: "LWPOLYLINE" | "POLYLINE";
  points: Pt[]; // metres, without a repeated closing vertex
  hadBulge: boolean;
}

export interface DxfText {
  layer: string;
  text: string;
  position: Pt; // metres
}

export interface DxfParseResult {
  insunits: number | null;
  unitName: string;
  scaleToMetres: number;
  polygons: DxfPolygon[];
  texts: DxfText[];
  openPolylines: number;
  skippedEntities: Record<string, number>;
  warnings: string[];
}

export class DxfParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DxfParseError";
  }
}

/** $INSUNITS code → [name, metres per unit]. 0 (unitless) defaults to metres. */
export const INSUNITS: Record<number, [string, number]> = {
  0: ["unitless (treated as metres)", 1],
  1: ["inches", 0.0254],
  2: ["feet", 0.3048],
  4: ["millimetres", 0.001],
  5: ["centimetres", 0.01],
  6: ["metres", 1],
  10: ["yards", 0.9144],
};

interface Pair {
  code: number;
  value: string;
}

function readPairs(text: string): Pair[] {
  const lines = text.replace(/^﻿/, "").split(/\r\n|\r|\n/);
  const pairs: Pair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const codeStr = lines[i].trim();
    if (codeStr === "") {
      if (lines.slice(i).every((l) => l.trim() === "")) break;
      throw new DxfParseError(`Malformed DXF: empty group code on line ${i + 1}`);
    }
    const code = Number(codeStr);
    if (!Number.isInteger(code)) throw new DxfParseError(`Malformed DXF: expected a group code on line ${i + 1}`);
    pairs.push({ code, value: lines[i + 1] });
    if (code === 0 && lines[i + 1].trim() === "EOF") break;
  }
  return pairs;
}

function cleanText(s: string): string {
  return s
    .replace(/\\P/g, " ")
    .replace(/\\[ACFHQTWLOKSaocfhqtwlosk][^;\\{}]*;/g, "")
    .replace(/\\[LlOoKk]/g, "")
    .replace(/\\~/g, " ")
    .replace(/[{}]/g, "")
    .replace(/%%[cdpCDP]/g, "")
    .replace(/%%[uoUO]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

interface RawEntity {
  type: string;
  pairs: Pair[];
}

export function parseDxf(text: string, opts: { unitsOverride?: number | null } = {}): DxfParseResult {
  if (text.startsWith("AutoCAD Binary DXF")) throw new DxfParseError("Binary DXF is not supported — save as ASCII DXF (R12 or R2000).");
  if (/^AC10\d\d/.test(text)) throw new DxfParseError("This is a DWG file, not DXF. Export to ASCII DXF from your CAD tool.");
  const pairs = readPairs(text);
  if (!pairs.some((p) => p.code === 0 && p.value.trim() === "SECTION")) throw new DxfParseError("Not a DXF file (no SECTION found).");

  const warnings: string[] = [];
  let insunits: number | null = null;
  let section: string | null = null;
  const entities: RawEntity[] = [];
  let current: RawEntity | null = null;

  for (let i = 0; i < pairs.length; i++) {
    const { code, value } = pairs[i];
    const v = value.trim();
    if (code === 0 && v === "SECTION") {
      const next = pairs[i + 1];
      section = next && next.code === 2 ? next.value.trim() : null;
      i++;
      current = null;
      continue;
    }
    if (code === 0 && v === "ENDSEC") {
      if (current) entities.push(current);
      current = null;
      section = null;
      continue;
    }
    if (code === 0 && v === "EOF") break;
    if (section === "HEADER") {
      if (code === 9 && v === "$INSUNITS") {
        const next = pairs[i + 1];
        if (next && next.code === 70) insunits = Number(next.value.trim());
        i++;
      }
      continue;
    }
    if (section === "ENTITIES") {
      if (code === 0) {
        if (current) entities.push(current);
        current = { type: v, pairs: [] };
      } else if (current) current.pairs.push({ code, value });
    }
  }
  if (current) entities.push(current);

  const unitCode = opts.unitsOverride ?? insunits ?? 0;
  const unit = INSUNITS[unitCode];
  if (!unit) warnings.push(`Unsupported $INSUNITS value ${unitCode}; coordinates treated as metres.`);
  const [unitName, scale] = unit ?? [`unknown (${unitCode}) — treated as metres`, 1];
  if (insunits === null && opts.unitsOverride == null) warnings.push("No $INSUNITS header found; coordinates treated as metres.");

  const polygons: DxfPolygon[] = [];
  const texts: DxfText[] = [];
  const skipped: Record<string, number> = {};
  let openPolylines = 0;
  let bulgeSeen = false;

  const pushPolygon = (layer: string, entity: DxfPolygon["entity"], raw: Pt[], closedFlag: boolean, hadBulge: boolean) => {
    const pts = raw.map(([x, y]) => [x * scale, y * scale] as Pt);
    const explicitClose = pts.length > 2 && Math.abs(pts[0][0] - pts[pts.length - 1][0]) < 1e-9 && Math.abs(pts[0][1] - pts[pts.length - 1][1]) < 1e-9;
    const ring = normalizeRing(pts);
    if (!(closedFlag || explicitClose) || ring.length < 3) {
      openPolylines++;
      return;
    }
    if (hadBulge) bulgeSeen = true;
    polygons.push({ index: polygons.length, layer, entity, points: ring, hadBulge });
  };

  for (let e = 0; e < entities.length; e++) {
    const ent = entities[e];
    const layerOf = (ps: Pair[]) => ps.find((p) => p.code === 8)?.value.trim() || "0";
    if (ent.type === "LWPOLYLINE") {
      let flags = 0;
      let hadBulge = false;
      const pts: Pt[] = [];
      let x: number | null = null;
      for (const p of ent.pairs) {
        if (p.code === 70) flags = Number(p.value.trim()) || 0;
        else if (p.code === 10) x = Number(p.value.trim());
        else if (p.code === 20 && x !== null) {
          pts.push([x, Number(p.value.trim())]);
          x = null;
        } else if (p.code === 42 && Math.abs(Number(p.value.trim())) > 1e-9) hadBulge = true;
      }
      pushPolygon(layerOf(ent.pairs), "LWPOLYLINE", pts, (flags & 1) === 1, hadBulge);
    } else if (ent.type === "POLYLINE") {
      const flags = Number(ent.pairs.find((p) => p.code === 70)?.value.trim() ?? 0) || 0;
      const layer = layerOf(ent.pairs);
      const pts: Pt[] = [];
      let hadBulge = false;
      let j = e + 1;
      for (; j < entities.length && entities[j].type === "VERTEX"; j++) {
        const vp = entities[j].pairs;
        const vflags = Number(vp.find((p) => p.code === 70)?.value.trim() ?? 0) || 0;
        if (vflags & 16) continue; // spline frame control point
        const vx = vp.find((p) => p.code === 10);
        const vy = vp.find((p) => p.code === 20);
        if (vx && vy) pts.push([Number(vx.value.trim()), Number(vy.value.trim())]);
        const b = vp.find((p) => p.code === 42);
        if (b && Math.abs(Number(b.value.trim())) > 1e-9) hadBulge = true;
      }
      if (j < entities.length && entities[j].type === "SEQEND") j++;
      e = j - 1;
      if (flags & (16 | 64)) {
        skipped["POLYLINE (mesh)"] = (skipped["POLYLINE (mesh)"] ?? 0) + 1;
        continue;
      }
      pushPolygon(layer, "POLYLINE", pts, (flags & 1) === 1, hadBulge);
    } else if (ent.type === "TEXT" || ent.type === "MTEXT") {
      const get = (c: number) => ent.pairs.find((p) => p.code === c)?.value;
      let x = Number(get(10)?.trim());
      let y = Number(get(20)?.trim());
      if (ent.type === "TEXT") {
        const h = Number(get(72)?.trim() ?? 0) || 0;
        const vj = Number(get(73)?.trim() ?? 0) || 0;
        const ax = get(11);
        const ay = get(21);
        if ((h || vj) && ax !== undefined && ay !== undefined) {
          x = Number(ax.trim());
          y = Number(ay.trim());
        }
      }
      const raw = ent.type === "MTEXT"
        ? ent.pairs.filter((p) => p.code === 3).map((p) => p.value).join("") + (get(1) ?? "")
        : get(1) ?? "";
      const t = cleanText(raw);
      if (t && Number.isFinite(x) && Number.isFinite(y)) texts.push({ layer: layerOf(ent.pairs), text: t, position: [x * scale, y * scale] });
    } else if (ent.type !== "VERTEX" && ent.type !== "SEQEND") {
      skipped[ent.type] = (skipped[ent.type] ?? 0) + 1;
    }
  }

  if (bulgeSeen) warnings.push("Some outlines contain arc segments (bulges); arcs were approximated by straight chords.");
  if (skipped.INSERT) warnings.push(`${skipped.INSERT} block reference(s) (INSERT) were not exploded — explode blocks before exporting if plots are inside blocks.`);
  if (polygons.some((p) => p.points.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y)))) throw new DxfParseError("DXF contains invalid coordinates.");

  return { insunits, unitName, scaleToMetres: scale, polygons, texts, openPolylines, skippedEntities: skipped, warnings };
}
