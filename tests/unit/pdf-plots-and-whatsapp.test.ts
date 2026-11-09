import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { itemsToRows, recordsToCsv, tableRowsToPlots, type PdfTextItem } from "@/lib/inventory/pdf-plots";
import { decryptToken, encryptToken, verifyMetaSignature } from "@/lib/whatsapp/crypto";

function row(y: number, cells: string[]): PdfTextItem[] {
  return cells.map((str, i) => ({ str, x: 20 + i * 90, y, w: str.length * 5 }));
}

describe("PDF plot table parsing", () => {
  const items = [
    ...row(700, ["Plot No.", "Phase", "Area (Sq. Yds)", "Facing", "Rate per Sq. Yd"]),
    ...row(680, ["101", "A", "166.67", "East", "18,000"]),
    ...row(660, ["102", "A", "200", "N", "₹19,500"]),
    ...row(640, ["Total", "", "366.67"]),
  ];

  it("groups text items into cells and finds plots under mapped headers", () => {
    const { records } = tableRowsToPlots(itemsToRows(items));
    expect(records.map((r) => r.plot_number)).toEqual(["101", "102"]);
    expect(records[0]).toMatchObject({ phase: "A", area_sq_yards: "166.67", facing: "East", base_price_per_sq_yard: "18,000" });
  });

  it("emits importer CSV with numeric cleanup", () => {
    const csv = recordsToCsv(tableRowsToPlots(itemsToRows(items)).records);
    expect(csv.split("\r\n")[0]).toBe("plot_number,phase,area_sq_yards,facing,base_price_per_sq_yard");
    expect(csv).toContain("101,A,166.67,East,18000");
    expect(csv).toContain("102,A,200,N,19500");
  });

  it("warns instead of guessing when there is no plot table", () => {
    const { records, warnings } = tableRowsToPlots(itemsToRows(row(700, ["Brochure", "Welcome"])));
    expect(records).toHaveLength(0);
    expect(warnings[0]).toMatch(/No table header/);
  });
});

describe("WhatsApp helpers", () => {
  it("round-trips encrypted tokens and never stores plaintext", () => {
    const enc = encryptToken("EAAG-secret-token");
    expect(enc).not.toContain("secret");
    expect(decryptToken(enc)).toBe("EAAG-secret-token");
    expect(() => decryptToken(enc.slice(0, -2) + "xx")).toThrow();
  });

  it("verifies Meta X-Hub-Signature-256 over the raw body", () => {
    const raw = '{"entry":[]}';
    const sig = "sha256=" + createHmac("sha256", "app-secret").update(raw).digest("hex");
    expect(verifyMetaSignature(raw, sig, "app-secret")).toBe(true);
    expect(verifyMetaSignature(raw + " ", sig, "app-secret")).toBe(false);
    expect(verifyMetaSignature(raw, sig, undefined)).toBe(false);
    expect(verifyMetaSignature(raw, null, "app-secret")).toBe(false);
  });
});
