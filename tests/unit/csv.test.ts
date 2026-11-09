import { describe, expect, it } from "vitest";
import { parseCsv, parseCsvRows, toCsv } from "@/lib/csv";

describe("parseCsv", () => {
  it("handles quoted fields, escaped quotes, embedded commas/newlines, CRLF and a BOM", () => {
    const text = '﻿Plot Number,Notes,Area (sq yd)\r\n"7","He said ""corner"", east",166.67\r\n8,"line1\nline2",200\r\n\r\n';
    const { headers, rows } = parseCsv(text);
    expect(headers).toEqual(["plot_number", "notes", "area_sq_yd"]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ plot_number: "7", notes: 'He said "corner", east', area_sq_yd: "166.67" });
    expect(rows[1].notes).toBe("line1\nline2");
  });

  it("fills missing trailing cells with empty strings and skips blank lines", () => {
    const { rows } = parseCsv("a,b,c\n1\n\n2,3,4\n");
    expect(rows).toEqual([{ a: "1", b: "", c: "" }, { a: "2", b: "3", c: "4" }]);
    expect(parseCsvRows("x,y")).toEqual([["x", "y"]]);
  });
});

describe("toCsv", () => {
  it("neutralises spreadsheet formula injection in text values but leaves numbers intact", () => {
    const csv = toCsv(["a", "b", "c", "d", "e"], [{ a: "=HYPERLINK(\"x\")", b: "+1", c: "@SUM(A1)", d: -5, e: "-10" }]);
    const [, line] = csv.split("\r\n");
    expect(line).toBe('"\'=HYPERLINK(""x"")",\'+1,\'@SUM(A1),-5,\'-10');
  });

  it("quotes commas, quotes and newlines and round-trips through parseCsv", () => {
    const rows = [{ n: "1", t: 'a,"b"\nc', z: null }, { n: "2", t: "plain", z: undefined }];
    const csv = toCsv(["n", "t", "z"], rows);
    expect(csv.endsWith("\r\n")).toBe(true);
    const back = parseCsv(csv);
    expect(back.rows).toEqual([{ n: "1", t: 'a,"b"\nc', z: "" }, { n: "2", t: "plain", z: "" }]);
  });

  it("serialises arrays and booleans", () => {
    expect(toCsv(["x", "y"], [{ x: ["A", "B"], y: true }])).toBe("x,y\r\nA; B,true\r\n");
  });
});
