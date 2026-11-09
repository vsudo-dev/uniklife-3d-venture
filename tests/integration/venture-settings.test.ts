import { beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import { createTestDb, ctxFor, demoVenture, plotIds } from "../support/db";
import { AppError } from "@/lib/errors";
import { BRAND_THEMES, viewerSettingsSchema } from "@/lib/viewer-settings";
import { loadBranding } from "@/lib/tenant";
import { createVenture, getViewerData, updateVenture, updateViewerSettings, ventureInputSchema } from "@/lib/services/ventures";
import { brandingInputSchema, getBrandingSettings, updateBranding } from "@/lib/services/branding";
import { getOrgSettings, updateOrgSettings } from "@/lib/services/organizations";
import { applyPlotCsvImport, exportPlotsCsv, getPlot, listPlots, previewPlotCsvImport, updatePlot } from "@/lib/services/plots";

let db: Database;
let ventureId: string;
let orgA: string;

beforeAll(async () => {
  db = await createTestDb();
  const v = await demoVenture(db);
  ventureId = v.id;
  orgA = v.organization_id;
});

async function rejection(p: Promise<unknown>) {
  return p.then(() => null, (e) => e as Error);
}

describe("venture viewer settings", () => {
  it("rejects invalid values and persists valid ones with an audit entry", async () => {
    const ceo = await ctxFor(db, "ceo@demo.local");
    for (const bad of [
      { defaultMode: "orbit" },
      { renderStyle: "neon" },
      { tourSpeed: 3 },
      { tourSpeed: 0.1 },
      { sky: "rainbow" },
      { landPattern: "marble" },
      { tapAction: "buy" },
      { themeOverride: "unknown-theme" },
      { showTrees: "yes" },
    ]) {
      const e = await rejection(updateViewerSettings(ceo, ventureId, bad));
      expect(e, JSON.stringify(bad)).toBeTruthy();
      expect(e!.name).toBe("ZodError");
    }
    const [{ viewer_settings: untouched }] = await db.query<{ viewer_settings: unknown }>("select viewer_settings from ventures where id = $1", [ventureId]);
    expect(untouched).toEqual({});

    const saved = await updateViewerSettings(ceo, ventureId, {
      defaultMode: "intelligence", renderStyle: "hologram", tourSpeed: 1.5, sky: "night", landPattern: "blueprint",
      showTrees: false, tapAction: "cart", themeOverride: "emerald",
    });
    expect(saved).toMatchObject({ defaultMode: "intelligence", renderStyle: "hologram", tourSpeed: 1.5, themeOverride: "emerald", autoTransition: true });
    const [{ viewer_settings }] = await db.query<{ viewer_settings: Record<string, unknown> }>("select viewer_settings from ventures where id = $1", [ventureId]);
    expect(viewer_settings).toMatchObject({ defaultMode: "intelligence", sky: "night", landPattern: "blueprint", showTrees: false, tapAction: "cart" });
    const [{ n }] = await db.query<{ n: number }>("select count(*)::int as n from audit_logs where action = 'venture.viewer_settings_updated' and entity_id = $1", [ventureId]);
    expect(n).toBe(1);

    const data = await getViewerData(ceo, ventureId);
    expect(data.venture.settings.renderStyle).toBe("hologram");
    expect(data.venture.settings.themeOverride).toBe("emerald");

    // Back to the organization theme.
    expect((await updateViewerSettings(ceo, ventureId, { ...saved, themeOverride: null })).themeOverride).toBeNull();
  });

  it("does not let a sales executive update viewer settings", async () => {
    const anil = await ctxFor(db, "anil@demo.local");
    const e = await rejection(updateViewerSettings(anil, ventureId, { renderStyle: "hologram" }));
    expect(e).toBeInstanceOf(AppError);
    expect((e as AppError).status).toBe(403);
  });

  it("does not let organization B update organization A's venture", async () => {
    const adminB = await ctxFor(db, "admin@sample-b.local");
    expect(adminB.organizationId).not.toBe(orgA);
    const e = await rejection(updateViewerSettings(adminB, ventureId, { renderStyle: "realistic" }));
    expect(e).toBeInstanceOf(AppError);
    expect((e as AppError).status).toBe(404);
    const [{ viewer_settings }] = await db.query<{ viewer_settings: Record<string, unknown> }>("select viewer_settings from ventures where id = $1", [ventureId]);
    expect(viewer_settings.renderStyle).toBe("hologram");
  });

  it("getViewerData returns parsed defaults, property type and geofence for an empty-settings venture", async () => {
    const ceo = await ctxFor(db, "ceo@demo.local");
    const input = ventureInputSchema.parse({ name: "Defaults Venture", code: "DEF-VEN", slug: "defaults-venture", latitude: 17.4, longitude: 78.5 });
    const row = await createVenture(ceo, input);
    const id = String(row.id);
    expect(row.property_type).toBe("open_plot");
    expect(row.geofence_radius_m).toBe(300);
    const data = await getViewerData(ceo, id);
    expect(data.venture.settings).toEqual(viewerSettingsSchema.parse({}));
    expect(data.venture.propertyType).toBe("open_plot");
    expect(data.venture.geofence).toEqual({ lat: 17.4, lng: 78.5, radiusM: 300 });

    // Garbage in the column still yields safe defaults.
    await db.query("update ventures set viewer_settings = $2::jsonb where id = $1", [id, JSON.stringify({ renderStyle: "nope" })]);
    expect((await getViewerData(ceo, id)).venture.settings).toEqual(viewerSettingsSchema.parse({}));

    // Property type and geofence radius are validated and persisted; omitted on update = unchanged.
    expect(ventureInputSchema.safeParse({ ...input, geofenceRadiusM: 20 }).success).toBe(false);
    expect(ventureInputSchema.safeParse({ ...input, geofenceRadiusM: 6000 }).success).toBe(false);
    expect(ventureInputSchema.safeParse({ ...input, propertyType: "castle" }).success).toBe(false);
    await updateVenture(ceo, id, ventureInputSchema.parse({ ...input, propertyType: "villa_plot", geofenceRadiusM: 750 }));
    let v = await getViewerData(ceo, id);
    expect(v.venture.propertyType).toBe("villa_plot");
    expect(v.venture.geofence?.radiusM).toBe(750);
    await updateVenture(ceo, id, ventureInputSchema.parse({ ...input, latitude: null, longitude: null }));
    v = await getViewerData(ceo, id);
    expect(v.venture.propertyType).toBe("villa_plot");
    expect(v.venture.geofence).toBeNull();
  });
});

describe("organization branding & settings", () => {
  it("accepts all 12 brand themes and rejects unknown ids", async () => {
    expect(BRAND_THEMES).toHaveLength(12);
    const ceo = await ctxFor(db, "ceo@demo.local");
    const before = await getBrandingSettings(ceo);
    const base = { companyName: before.companyName, appName: before.appName, shortName: before.shortName, website: null, contactEmail: null, contactPhone: null };
    for (const t of BRAND_THEMES) {
      await updateBranding(ceo, { ...base, theme: t.id });
      expect((await loadBranding(db, orgA)).theme).toBe(t.id);
    }
    expect(brandingInputSchema.safeParse({ ...base, theme: "neon" }).success).toBe(false);
    const e = await rejection(updateBranding(ceo, { ...base, theme: "neon" as never }));
    expect(e!.name).toBe("ZodError");
    expect((await loadBranding(db, orgA)).theme).toBe("copper");
  });

  it("persists default_color_mode and leaves it unchanged when omitted", async () => {
    const ceo = await ctxFor(db, "ceo@demo.local");
    const b = await getBrandingSettings(ceo);
    const base = { companyName: b.companyName, appName: b.appName, shortName: b.shortName, theme: b.theme, website: null, contactEmail: null, contactPhone: null };
    expect(b.defaultColorMode).toBe("system");
    await updateBranding(ceo, { ...base, defaultColorMode: "night" });
    expect((await getBrandingSettings(ceo)).defaultColorMode).toBe("night");
    expect((await loadBranding(db, orgA)).defaultColorMode).toBe("night");
    await updateBranding(ceo, base);
    expect((await getBrandingSettings(ceo)).defaultColorMode).toBe("night");
    expect(brandingInputSchema.safeParse({ ...base, defaultColorMode: "sepia" }).success).toBe(false);
    // Venture manager lacks branding.manage.
    const vm = await ctxFor(db, "venture.manager@demo.local");
    const e = await rejection(updateBranding(vm, { ...base, defaultColorMode: "dark" }));
    expect((e as AppError).status).toBe(403);
  });

  it("toggles the commission second-approver requirement (org.manage)", async () => {
    const ceo = await ctxFor(db, "ceo@demo.local");
    const s = await getOrgSettings(ceo);
    expect(s.commissionRequiresSecondApprover).toBe(true);
    const { name: _name, ...input } = s;
    await updateOrgSettings(ceo, { ...input, commissionRequiresSecondApprover: false });
    expect((await getOrgSettings(ceo)).commissionRequiresSecondApprover).toBe(false);
    await updateOrgSettings(ceo, { ...input, commissionRequiresSecondApprover: undefined });
    expect((await getOrgSettings(ceo)).commissionRequiresSecondApprover).toBe(false);
    await updateOrgSettings(ceo, { ...input, commissionRequiresSecondApprover: true });
    expect((await getOrgSettings(ceo)).commissionRequiresSecondApprover).toBe(true);
  });
});

describe("plot property type", () => {
  it("null inherits the venture's property type; overrides, filters and CSV round-trip", async () => {
    const ceo = await ctxFor(db, "ceo@demo.local");
    const [p60, p61] = await plotIds(db, ventureId, ["60", "61"]);
    const ventureType = (await getViewerData(ceo, ventureId)).venture.propertyType;
    expect(ventureType).toBe("open_plot");

    // Default: inherit.
    let viewer = await getViewerData(ceo, ventureId);
    let vp = viewer.plots.find((p) => p.id === p60)!;
    expect(vp.propertyType).toBeNull();
    expect(vp.effectivePropertyType).toBe("open_plot");

    // Override, then a regular edit without propertyType keeps it.
    const plot = (await getPlot(ceo, p60)).plot;
    const edit = {
      version: Number(plot.version), plotNumber: String(plot.plot_number), phaseId: (plot.phase_id as string) ?? null, areaSqYards: Number(plot.area_sq_yards),
      lengthFt: null, widthFt: null, dimensionsText: null, facing: null, roadWidthFt: null, isCorner: Boolean(plot.is_corner),
      basePricePerSqYard: Number(plot.base_price_per_sq_yard), priceReason: null, notes: null,
    };
    const after = await updatePlot(ceo, p60, { ...edit, propertyType: "commercial" });
    expect(after.property_type).toBe("commercial");
    const after2 = await updatePlot(ceo, p60, { ...edit, version: Number(after.version) });
    expect(after2.property_type).toBe("commercial");
    viewer = await getViewerData(ceo, ventureId);
    vp = viewer.plots.find((p) => p.id === p60)!;
    expect(vp.effectivePropertyType).toBe("commercial");

    // Inventory filter + column.
    const commercial = await listPlots(ceo, { ventureId, propertyType: "commercial" });
    expect(commercial.rows.map((r) => r.id)).toEqual([p60]);
    const open = await listPlots(ceo, { ventureId, propertyType: "open_plot", pageSize: 200 });
    expect(open.rows.some((r) => r.id === p60)).toBe(false);
    expect(open.rows.find((r) => r.id === p61)).toMatchObject({ property_type: null, effective_property_type: "open_plot" });

    // Changing the venture's type flows to inheriting plots only.
    await db.query("update ventures set property_type = 'farm_land' where id = $1", [ventureId]);
    viewer = await getViewerData(ceo, ventureId);
    expect(viewer.plots.find((p) => p.id === p61)!.effectivePropertyType).toBe("farm_land");
    expect(viewer.plots.find((p) => p.id === p60)!.effectivePropertyType).toBe("commercial");
    await db.query("update ventures set property_type = 'open_plot' where id = $1", [ventureId]);

    // Clear back to inherit.
    const cleared = await updatePlot(ceo, p60, { ...edit, version: Number(after2.version), propertyType: null });
    expect(cleared.property_type).toBeNull();

    // CSV: validated column, "inherit" clears, export includes it.
    const bad = await previewPlotCsvImport(ceo, { ventureId, csv: "plot_number,property_type\n61,castle\n" });
    expect(bad.rows[0].action).toBe("error");
    expect(bad.rows[0].errors.join(" ")).toMatch(/property_type/);
    await applyPlotCsvImport(ceo, { ventureId, csv: "plot_number,property_type\n61,Villa Plot\n60,apartment\n" });
    let rows = await db.query<{ plot_number: string; property_type: string | null }>("select plot_number, property_type from plots where id = any($1::uuid[])", [[p60, p61]]);
    expect(Object.fromEntries(rows.map((r) => [r.plot_number, r.property_type]))).toEqual({ "60": "apartment", "61": "villa_plot" });
    await applyPlotCsvImport(ceo, { ventureId, csv: "plot_number,property_type\n61,inherit\n" });
    rows = await db.query("select plot_number, property_type from plots where id = $1", [p61]);
    expect(rows[0].property_type).toBeNull();
    const exp = await exportPlotsCsv(ceo, { ventureId, propertyType: "apartment" });
    expect(exp.count).toBe(1);
    expect(exp.csv.split(/\r?\n/)[0]).toContain("property_type");
    expect(exp.csv).toContain("apartment");
  });
});
