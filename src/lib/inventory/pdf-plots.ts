import reviewedLayout from "./layouts/sphoorthy-green-nest.json";
/** Mirrors PLOT_CSV_HEADERS in services/plots (kept local so this module stays pure and unit-testable). */
export const PLOT_CSV_HEADERS = ["plot_number", "phase", "area_sq_yards", "length_ft", "width_ft", "facing", "road_width_ft", "is_corner", "base_price_per_sq_yard", "property_type", "north_ft", "south_ft", "east_ft", "west_ft", "is_mortgaged", "mortgage_reference"] as const;

/**
 * PDF → plot-inventory rows. Output is always the SAME CSV the manual importer accepts, so every
 * extracted value goes through preview + validation + human confirmation. Nothing is written here.
 */

export interface PdfTextItem { str: string; x: number; y: number; w: number }

export interface ExtractedPlots {
  csv: string;
  rows: number;
  method: "text" | "ai" | "reviewed_layout";
  warnings: string[];
}

type Column = (typeof PLOT_CSV_HEADERS)[number];

/** Header-cell aliases (lower-case, punctuation stripped) → CSV column. */
const HEADER_ALIASES: Record<Column, string[]> = {
  is_mortgaged:["is mortgaged","mortgage","mortgaged"],mortgage_reference:["mortgage reference","mortgage key","loan reference"],
  north_ft:["north ft","north boundary"],south_ft:["south ft","south boundary"],east_ft:["east ft","east boundary"],west_ft:["west ft","west boundary"],
  plot_number: ["plot no", "plot number", "plot", "plot #", "sy no", "site no", "site number", "unit no", "unit", "no"],
  phase: ["phase", "block", "sector", "zone"],
  area_sq_yards: ["area sq yds", "area sq yards", "area sqyds", "area", "sq yds", "sq yards", "sqyds", "extent", "extent sq yds", "size", "area sy"],
  length_ft: ["length", "length ft", "length feet", "depth"],
  width_ft: ["width", "width ft", "width feet", "breadth", "frontage"],
  facing: ["facing", "direction", "face"],
  road_width_ft: ["road width", "road ft", "road", "road width ft", "road feet"],
  is_corner: ["corner", "is corner", "corner plot"],
  base_price_per_sq_yard: ["price per sq yd", "price per sq yard", "rate per sq yd", "rate per sq yard", "rate", "price", "base price", "rate sq yd", "price sq yd", "rate/sq yd"],
  property_type: ["property type", "type", "category"],
};

const norm = (s: string) => s.toLowerCase().replace(/[().:_\-\\/]+/g, " ").replace(/[^a-z0-9# ]/g, "").replace(/\s+/g, " ").trim();

function matchColumn(cell: string): Column | null {
  const n = norm(cell);
  if (!n) return null;
  let best: { col: Column; len: number } | null = null;
  for (const col of PLOT_CSV_HEADERS) {
    for (const alias of HEADER_ALIASES[col]) {
      if (n === alias && (!best || alias.length > best.len)) best = { col, len: alias.length };
    }
  }
  if (best) return best.col;
  // Looser: header contains a distinctive alias (e.g. "Area (Sq. Yds)" already normalised, "Plot No." etc.).
  for (const col of PLOT_CSV_HEADERS) {
    for (const alias of HEADER_ALIASES[col]) {
      if (alias.length >= 5 && n.includes(alias) && (!best || alias.length > best.len)) best = { col, len: alias.length };
    }
  }
  return best?.col ?? null;
}

/** Groups positioned text items into visual rows, then splits each row into cells on wide gaps. */
export function itemsToRows(items: PdfTextItem[]): string[][] {
  const sorted = [...items].filter((i) => i.str.trim()).sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: PdfTextItem[][] = [];
  for (const it of sorted) {
    const line = lines.find((l) => Math.abs(l[0].y - it.y) <= 2.5);
    if (line) line.push(it);
    else lines.push([it]);
  }
  return lines
    .sort((a, b) => b[0].y - a[0].y)
    .map((line) => {
      line.sort((a, b) => a.x - b.x);
      const cells: string[] = [];
      let cur = "";
      let prevEnd = -Infinity;
      for (const it of line) {
        const gap = it.x - prevEnd;
        if (cur && gap > 6) { cells.push(cur.trim()); cur = it.str; } else cur += (cur && gap > 0.5 ? " " : "") + it.str;
        prevEnd = it.x + it.w;
      }
      if (cur.trim()) cells.push(cur.trim());
      return cells;
    });
}

const num = (s: string) => /^[\d,]+(\.\d+)?$/.test(s.replace(/[₹\s]|rs\.?/gi, ""));

/** Finds the header row(s) and converts table rows to CSV. Rows without a plot number + area are skipped with a warning. */
export function tableRowsToPlots(rows: string[][]): { records: Partial<Record<Column, string>>[]; warnings: string[] } {
  const warnings: string[] = [];
  const records: Partial<Record<Column, string>>[] = [];
  let mapping: (Column | null)[] | null = null;
  let skipped = 0;
  for (const cells of rows) {
    const mapped = cells.map(matchColumn);
    const hits = new Set(mapped.filter(Boolean));
    if (hits.has("plot_number") && (hits.has("area_sq_yards") || hits.size >= 3)) { mapping = mapped; continue; }
    if (!mapping) continue;
    if (cells.length < 2) continue;
    const rec: Partial<Record<Column, string>> = {};
    cells.forEach((c, i) => {
      const col = mapping![i] ?? (mapping!.length === cells.length ? null : undefined);
      if (col) rec[col] = c;
    });
    const plot = rec.plot_number?.trim();
    if (!plot || !/^[A-Za-z0-9\-/]{1,12}$/.test(plot) || (rec.area_sq_yards && !num(rec.area_sq_yards))) { if (cells.some(num)) skipped++; continue; }
    if (!rec.area_sq_yards) { skipped++; continue; }
    records.push(rec);
  }
  if (!mapping) warnings.push("No table header with a plot-number column was found in the PDF text.");
  if (skipped) warnings.push(`${skipped} row(s) looked like data but could not be read; check the PDF.`);
  return { records, warnings };
}

const esc = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
export function recordsToCsv(records: Partial<Record<Column, string>>[]): string {
  const cols = PLOT_CSV_HEADERS.filter((c) => c === "plot_number" || records.some((r) => r[c]));
  const numeric = new Set<Column>(["area_sq_yards", "length_ft", "width_ft", "road_width_ft", "base_price_per_sq_yard"]);
  const cell = (c: Column, raw: string | undefined) => {
    const v = (raw ?? "").trim();
    return numeric.has(c) ? v.replace(/[₹,\s]|rs\.?/gi, "") : v;
  };
  return [cols.join(","), ...records.map((r) => cols.map((c) => esc(cell(c, r[c]))).join(","))].join("\r\n") + "\r\n";
}

/** Text-layer extraction (works for digital PDFs; scanned PDFs yield nothing and fall through to AI). */
export async function extractPlotsFromPdfText(pdf: Buffer): Promise<ExtractedPlots> {
  const { createHash }=await import("node:crypto");
  if(createHash("sha256").update(pdf).digest("hex")===reviewedLayout.sha256){
    const records=reviewedLayout.plots.map(p=>({is_mortgaged:p.mortgaged?"yes":"no",mortgage_reference:"",plot_number:p.plot_number,area_sq_yards:String(p.area_sq_yards),facing:p.facing,road_width_ft:String(p.road_width_ft),is_corner:p.is_corner?"yes":"no",north_ft:p.north_ft===null?"":String(p.north_ft),south_ft:p.south_ft===null?"":String(p.south_ft),east_ft:p.east_ft===null?"":String(p.east_ft),west_ft:p.west_ft===null?"":String(p.west_ft)}));
    return {csv:recordsToCsv(records),rows:records.length,method:"reviewed_layout",warnings:["Matched the reviewed Sphoorthy layout (279 plots). Prices are not supplied in this file: enter prices before importing new bookable inventory. Mortgage plots 173-178 and 251-279 must remain blocked. Blank boundary values need survey confirmation; scanned geometry is illustrative."]};
  }

  const { getDocumentProxy } = await import("unpdf");
  const doc = await getDocumentProxy(new Uint8Array(pdf));
  const all: string[][] = [];
  const pages = Math.min(doc.numPages, 60);
  for (let p = 1; p <= pages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const items: PdfTextItem[] = [];
    for (const it of content.items as Array<{ str?: string; transform?: number[]; width?: number }>) {
      if (it.str && it.transform) items.push({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width ?? 0 });
    }
    all.push(...itemsToRows(items));
  }
  const { records, warnings } = tableRowsToPlots(all);
  if (doc.numPages > pages) warnings.push(`Only the first ${pages} pages were read.`);
  return { csv: records.length ? recordsToCsv(records) : "", rows: records.length, method: "text", warnings };
}
