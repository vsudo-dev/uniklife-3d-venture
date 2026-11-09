import { beforeAll, describe, expect, it, vi } from "vitest";

// Uploaded test files go to a disposable temp folder, never to .data/.
vi.hoisted(() => {
  const tmp = process.env.TEMP ?? process.env.TMPDIR ?? "/tmp";
  process.env.LOCAL_UPLOAD_DIR = `${tmp}/uniklife-inventory-test-${process.pid}`;
  process.env.STORAGE_DRIVER = "local";
});

import type { Database } from "@/lib/db/types";
import { createTestDb, ctxFor, demoVenture, key, plotIds } from "../support/db";
import { placeHold, requestBooking } from "@/lib/services/bookings";
import {
  applyDxfGeometry, applyPlotCsvImport, autoMapMeshIds, blockPlots, getPlot, listPlots, previewDxfImport, previewPlotCsvImport,
  unblockPlots, updateMeshMapping, updatePlot, updatePlotPrices,
} from "@/lib/services/plots";
import { deleteVentureAsset, getAssetForDownload, setVentureAssetRole, uploadVentureAsset } from "@/lib/services/assets";
import { buildDemoVentureGlb } from "@/lib/cad/sample-glb";

let db: Database;
let ventureId: string;
const customer = { fullName: "Inventory Buyer", phone: "+919833300000" };

beforeAll(async () => {
  db = await createTestDb();
  ventureId = (await demoVenture(db)).id;
});

const statusOf = async (id: string) => (await db.query<{ status: string }>("select status from plots where id = $1", [id]))[0].status;

describe("block / unblock", () => {
  it("blocks and unblocks available plots with history and audit", async () => {
    const ceo = await ctxFor(db, "ceo@demo.local");
    const [p50] = await plotIds(db, ventureId, ["50"]);
    await blockPlots(ceo, { plotIds: [p50], reason: "Reserved for road widening" });
    expect(await statusOf(p50)).toBe("blocked");
    await expect(blockPlots(ceo, { plotIds: [p50], reason: "Again please" })).rejects.toMatchObject({ status: 409 });
    await unblockPlots(ceo, { plotIds: [p50], reason: "Road plan finalised" });
    expect(await statusOf(p50)).toBe("available");
    await expect(unblockPlots(ceo, { plotIds: [p50], reason: "Not blocked" })).rejects.toMatchObject({ status: 409 });
    const hist = await db.query<{ from_status: string; to_status: string }>("select from_status, to_status from plot_status_history where plot_id = $1 order by created_at", [p50]);
    expect(hist.map((h) => `${h.from_status}->${h.to_status}`)).toEqual(["available->blocked", "blocked->available"]);
    const audit = await db.query<{ n: number }>("select count(*)::int as n from audit_logs where action in ('plot.blocked','plot.unblocked') and metadata->'plot_ids' ? $1", [p50]);
    expect(audit[0].n).toBe(2);
  });

  it("refuses to block a plot with an active hold", async () => {
    const anil = await ctxFor(db, "anil@demo.local");
    const ceo = await ctxFor(db, "ceo@demo.local");
    const [p51] = await plotIds(db, ventureId, ["51"]);
    await placeHold(anil, { plotIds: [p51], customer, idempotencyKey: key("hold") });
    await expect(blockPlots(ceo, { plotIds: [p51], reason: "Management hold" })).rejects.toMatchObject({ status: 409 });
    expect(await statusOf(p51)).toBe("held");
  });

  it("sales_executive cannot block, edit or reprice plots", async () => {
    const anil = await ctxFor(db, "anil@demo.local");
    const [p52] = await plotIds(db, ventureId, ["52"]);
    await expect(blockPlots(anil, { plotIds: [p52], reason: "Should not work" })).rejects.toMatchObject({ status: 403 });
    await expect(updatePlotPrices(anil, { plotIds: [p52], mode: "set", value: 1, reason: "nope" })).rejects.toMatchObject({ status: 403 });
    const { plot } = await getPlot(anil, p52); // can still view
    await expect(updatePlot(anil, p52, {
      version: Number(plot.version), plotNumber: "52", phaseId: null, areaSqYards: 1, lengthFt: null, widthFt: null, dimensionsText: null,
      facing: null, roadWidthFt: null, isCorner: false, basePricePerSqYard: 1, priceReason: "x", notes: null,
    })).rejects.toMatchObject({ status: 403 });
  });
});

describe("pricing", () => {
  it("records price history and never changes an existing booking snapshot", async () => {
    const anil = await ctxFor(db, "anil@demo.local");
    const ceo = await ctxFor(db, "ceo@demo.local");
    const [p53] = await plotIds(db, ventureId, ["53"]);
    const hold = await placeHold(anil, { plotIds: [p53], customer, idempotencyKey: key("h") });
    const { bookingId } = await requestBooking(anil, { holdGroupId: hold.holdGroupId, discountRefs: [], idempotencyKey: key("b") });
    const [before] = await db.query<Record<string, unknown>>(
      "select bp.price_per_sq_yard, bp.net_amount, b.base_amount, b.pricing_snapshot from booking_plots bp join bookings b on b.id = bp.booking_id where b.id = $1", [bookingId]);

    const res = await updatePlotPrices(ceo, { plotIds: [p53], mode: "percent", value: 10, reason: "Quarterly revision" });
    expect(res.updated).toBe(1);
    const prices = await db.query<{ price_per_sq_yard: string; reason: string }>("select price_per_sq_yard, reason from plot_prices where plot_id = $1 order by created_at desc", [p53]);
    expect(prices).toHaveLength(2);
    expect(prices[0].reason).toBe("Quarterly revision");
    expect(Number(prices[0].price_per_sq_yard)).toBeCloseTo(Number(before.price_per_sq_yard) * 1.1, 2);

    const [after] = await db.query<Record<string, unknown>>(
      "select bp.price_per_sq_yard, bp.net_amount, b.base_amount, b.pricing_snapshot from booking_plots bp join bookings b on b.id = bp.booking_id where b.id = $1", [bookingId]);
    expect(after).toEqual(before);
    expect(await statusOf(p53)).toBe("reserved");
    const audit = await db.query("select 1 from audit_logs where action = 'plot.price_changed' and entity_id = $1", [p53]);
    expect(audit).toHaveLength(1);
  });
});

describe("CSV import", () => {
  it("upserts by plot number without altering the status of held/reserved/booked/sold plots", async () => {
    const ceo = await ctxFor(db, "ceo@demo.local");
    const [p53, p54, p51] = await plotIds(db, ventureId, ["53", "54", "51"]);
    await db.query("update plots set status = 'sold' where id = $1", [p54]);
    const csv = [
      "plot_number,phase,area_sq_yards,length_ft,width_ft,facing,road_width_ft,is_corner,base_price_per_sq_yard",
      "53,C,170,50,30.6,North,40,no,21000",
      "54,,175,,,E,,yes,",
      "51,,,,,,,,25000",
      "999,Z,200,60,30,NE,30,yes,15000",
    ].join("\n");
    const preview = await previewPlotCsvImport(ceo, { ventureId, csv });
    expect(preview.summary).toMatchObject({ create: 1, update: 3, error: 0 });
    expect(preview.newPhases).toEqual(["Z"]);
    expect(preview.rows.find((r) => r.plotNumber === "53")!.warnings.join(" ")).toMatch(/status is preserved/);

    const res = await applyPlotCsvImport(ceo, { ventureId, csv });
    expect(res).toMatchObject({ created: 1, updated: 3 });
    expect(await statusOf(p53)).toBe("reserved");
    expect(await statusOf(p54)).toBe("sold");
    expect(await statusOf(p51)).toBe("held");
    const [row53] = await db.query<{ area_sq_yards: string; base_price_per_sq_yard: string; facing: string; dimensions_text: string }>(
      "select area_sq_yards, base_price_per_sq_yard, facing, dimensions_text from plots where id = $1", [p53]);
    expect(Number(row53.area_sq_yards)).toBe(170);
    expect(row53.facing).toBe("N");
    expect(row53.dimensions_text).toBe("30.6 ft × 50 ft");
    const [created] = await db.query<{ status: string; phase: string }>(
      "select p.status, ph.code as phase from plots p join venture_phases ph on ph.id = p.phase_id where p.venture_id = $1 and p.plot_number = '999'", [ventureId]);
    expect(created).toEqual({ status: "available", phase: "Z" });
    // Booking snapshot for plot 53 is still the original line.
    const [line] = await db.query<{ area_sq_yards: string }>("select bp.area_sq_yards from booking_plots bp where bp.plot_id = $1 and bp.is_live", [p53]);
    expect(Number(line.area_sq_yards)).not.toBe(170);
  });

  it("rejects invalid rows and refuses to apply them", async () => {
    const ceo = await ctxFor(db, "ceo@demo.local");
    const csv = "plot_number,area_sq_yards,base_price_per_sq_yard,facing\n1000,-5,abc,UP\n1000,10,10,N\n=CMD,10,10,N\n";
    const preview = await previewPlotCsvImport(ceo, { ventureId, csv });
    expect(preview.summary.error).toBe(3);
    await expect(applyPlotCsvImport(ceo, { ventureId, csv })).rejects.toMatchObject({ status: 422 });
  });
});

describe("tenant isolation & privacy", () => {
  it("org B cannot read org A plots", async () => {
    const orgB = await ctxFor(db, "admin@sample-b.local");
    const [p1] = await plotIds(db, ventureId, ["1"]);
    await expect(getPlot(orgB, p1)).rejects.toMatchObject({ status: 404 });
    const list = await listPlots(orgB, { ventureId });
    expect(list.total).toBe(0);
    await expect(updatePlotPrices(orgB, { plotIds: [p1], mode: "set", value: 1, reason: "cross-tenant" })).rejects.toMatchObject({ status: 404 });
  });

  it("customers cannot use the inventory", async () => {
    const cust = await ctxFor(db, "customer@demo.local");
    await expect(listPlots(cust, {})).rejects.toMatchObject({ status: 403 });
  });

  it("shows the current customer only when the booking is visible to the caller", async () => {
    const lakshmi = await ctxFor(db, "lakshmi@demo.local"); // upline of Anil
    const deepa = await ctxFor(db, "deepa@demo.local"); // parallel team
    const a = (await listPlots(lakshmi, { ventureId, q: "53" })).rows.find((r) => r.plot_number === "53")!;
    const b = (await listPlots(deepa, { ventureId, q: "53" })).rows.find((r) => r.plot_number === "53")!;
    expect(a.current_customer).toBe(customer.fullName);
    expect(b.has_live_booking).toBe(true);
    expect(b.current_customer).toBeNull();
  });
});

describe("assets", () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);

  it("validates by magic bytes, not by the claimed kind", async () => {
    const ceo = await ctxFor(db, "ceo@demo.local");
    await expect(uploadVentureAsset(ceo, ventureId, { kind: "layout_pdf", fileName: "layout.pdf", data: png })).rejects.toMatchObject({ status: 400 });
    await expect(uploadVentureAsset(ceo, ventureId, { kind: "model_glb", fileName: "m.glb", data: Buffer.from("glTF....garbage") })).rejects.toMatchObject({ status: 400 });
    const glb = await uploadVentureAsset(ceo, ventureId, { kind: "model_glb", fileName: "demo.glb", data: buildDemoVentureGlb().glb });
    await setVentureAssetRole(ceo, ventureId, { role: "model", assetId: glb.id });
    await expect(setVentureAssetRole(ceo, ventureId, { role: "cover_image", assetId: glb.id })).rejects.toMatchObject({ status: 400 });
    await deleteVentureAsset(ceo, ventureId, glb.id);
    const [v] = await db.query<{ model_asset_id: string | null }>("select model_asset_id from ventures where id = $1", [ventureId]);
    expect(v.model_asset_id).toBeNull();
  });

  it("customers may fetch public kinds of published ventures only", async () => {
    const ceo = await ctxFor(db, "ceo@demo.local");
    const cust = await ctxFor(db, "customer@demo.local");
    const anil = await ctxFor(db, "anil@demo.local");
    const img = await uploadVentureAsset(ceo, ventureId, { kind: "image", fileName: "cover.png", data: png });
    const dxfText = "0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n";
    const cad = await uploadVentureAsset(ceo, ventureId, { kind: "cad_dxf", fileName: "layout.dxf", data: Buffer.from(dxfText) });

    const got = await getAssetForDownload(cust, ventureId, img.id);
    expect(got.mimeType).toBe("image/png");
    expect(got.disposition).toBe("inline");
    expect(got.data.equals(png)).toBe(true);
    await expect(getAssetForDownload(cust, ventureId, cad.id)).rejects.toMatchObject({ status: 404 });
    expect((await getAssetForDownload(anil, ventureId, cad.id)).disposition).toBe("attachment");
    await expect(uploadVentureAsset(anil, ventureId, { kind: "image", fileName: "x.png", data: png })).rejects.toMatchObject({ status: 403 });

    await db.query("update ventures set is_published = false where id = $1", [ventureId]);
    try {
      await expect(getAssetForDownload(cust, ventureId, img.id)).rejects.toMatchObject({ status: 404 });
      const orgB = await ctxFor(db, "admin@sample-b.local");
      await expect(getAssetForDownload(orgB, ventureId, img.id)).rejects.toMatchObject({ status: 404 });
    } finally {
      await db.query("update ventures set is_published = true where id = $1", [ventureId]);
    }
  });
});

describe("DXF geometry import", () => {
  // Plots 1 (33×50 ft corner → 183.33 sq yd recorded), 2 and 3 (30×50 ft → 166.67 sq yd) drawn as 30×50 ft rectangles, in feet.
  const lw = (x: number, label: string) =>
    `0\nLWPOLYLINE\n8\nPLOTS\n90\n4\n70\n1\n10\n${x}\n20\n0\n10\n${x + 30}\n20\n0\n10\n${x + 30}\n20\n50\n10\n${x}\n20\n50\n` +
    `0\nTEXT\n8\nLABELS\n10\n${x + 15}\n20\n25\n40\n2\n1\n${label}\n`;
  const dxf = `0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n2\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n${lw(0, "1")}${lw(30, "2")}${lw(60, "3")}` +
    `0\nLWPOLYLINE\n8\nROAD\n90\n4\n70\n1\n10\n0\n20\n-40\n10\n90\n20\n-40\n10\n90\n20\n0\n10\n0\n20\n0\n0\nENDSEC\n0\nEOF\n`;

  it("flags >3% area deviation and requires explicit acceptance before applying", async () => {
    const ceo = await ctxFor(db, "ceo@demo.local");
    const asset = await uploadVentureAsset(ceo, ventureId, { kind: "cad_dxf", fileName: "plots.dxf", data: Buffer.from(dxf) });
    const preview = await previewDxfImport(ceo, ventureId, { assetId: asset.id });
    expect(preview.unitName).toBe("feet");
    const p1 = preview.polygons.find((p) => p.plotNumber === "1")!;
    const p2 = preview.polygons.find((p) => p.plotNumber === "2")!;
    expect(p1.deviationFlag).toBe(true);
    expect(p1.deviationPct).toBeGreaterThan(3);
    expect(p2.deviationFlag).toBe(false);
    expect(preview.features).toHaveLength(1);

    await expect(applyDxfGeometry(ceo, ventureId, { assetId: asset.id })).rejects.toMatchObject({ status: 422 });
    const anil = await ctxFor(db, "anil@demo.local");
    await expect(applyDxfGeometry(anil, ventureId, { assetId: asset.id, acceptDeviations: true })).rejects.toMatchObject({ status: 403 });

    const res = await applyDxfGeometry(ceo, ventureId, { assetId: asset.id, acceptDeviations: true, normalizeOrigin: true });
    expect(res.applied).toBe(3);
    const [p2Id] = await plotIds(db, ventureId, ["2"]);
    const [g] = await db.query<{ source: string; mesh_id: string; polygon: [number, number][] }>("select source, mesh_id, polygon from plot_geometry where plot_id = $1", [p2Id]);
    expect(g.source).toBe("dxf");
    expect(g.mesh_id).toBe("PLOT_002"); // existing mapping kept
    expect(g.polygon[0][0]).toBeCloseTo(30 * 0.3048, 3);
    const audit = await db.query<{ metadata: { deviations: unknown[] } }>("select metadata from audit_logs where action = 'plot.geometry_imported' and entity_id = $1", [ventureId]);
    expect(audit).toHaveLength(1);
    expect(audit[0].metadata.deviations).toHaveLength(1);
  });
});

describe("3D mesh mapping", () => {
  it("enforces unique mesh ids, supports swaps and auto-maps by convention", async () => {
    const ceo = await ctxFor(db, "ceo@demo.local");
    const [p7, p8] = await plotIds(db, ventureId, ["7", "8"]);
    await expect(updateMeshMapping(ceo, ventureId, { items: [{ plotId: p7, meshId: "PLOT_009" }] })).rejects.toMatchObject({ status: 409 });
    await expect(updateMeshMapping(ceo, ventureId, { items: [{ plotId: p7, meshId: "X" }, { plotId: p8, meshId: "X" }] })).rejects.toMatchObject({ status: 409 });
    await updateMeshMapping(ceo, ventureId, { items: [{ plotId: p7, meshId: "PLOT_008" }, { plotId: p8, meshId: "PLOT_007" }] });
    const swapped = await db.query<{ plot_id: string; mesh_id: string }>("select plot_id, mesh_id from plot_geometry where plot_id = any($1::uuid[])", [[p7, p8]]);
    expect(swapped.find((r) => r.plot_id === p7)!.mesh_id).toBe("PLOT_008");
    const res = await autoMapMeshIds(ceo, ventureId, { overwrite: true });
    expect(res.updated).toBeGreaterThanOrEqual(3); // 7, 8 and the new plot 999
    const [g7] = await db.query<{ mesh_id: string }>("select mesh_id from plot_geometry where plot_id = $1", [p7]);
    expect(g7.mesh_id).toBe("PLOT_007");
  });
});
