import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { extractPlotsFromPdfText } from "@/lib/inventory/pdf-plots";

async function makePdf(rows: string[][]) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([700, 500]);
  rows.forEach((r, i) => r.forEach((c, j) => page.drawText(c, { x: 30 + j * 120, y: 450 - i * 24, size: 11, font })));
  return Buffer.from(await doc.save());
}

describe("extractPlotsFromPdfText (real PDF)", () => {
  it("reads a digital plot table into importer CSV", async () => {
    const pdf = await makePdf([
      ["Plot No.", "Phase", "Area (Sq. Yds)", "Facing", "Rate per Sq. Yd"],
      ["101", "A", "166.67", "East", "18,000"],
      ["102", "A", "200", "North", "19,500"],
      ["103", "B", "150", "West", "17,000"],
    ]);
    const r = await extractPlotsFromPdfText(pdf);
    expect(r.rows).toBe(3);
    expect(r.csv).toContain("plot_number,phase,area_sq_yards,facing,base_price_per_sq_yard");
    expect(r.csv).toContain("102,A,200,North,19500");
  });

  it("returns no rows (so AI can be offered) for a PDF without a plot table", async () => {
    const r = await extractPlotsFromPdfText(await makePdf([["Welcome to our brochure"]]));
    expect(r.rows).toBe(0);
    expect(r.csv).toBe("");
  });
});
