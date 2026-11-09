import { beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import { createTestDb, ctxFor, demoVenture } from "../support/db";
import { getViewerData, getVentureViewerSettings, updateViewerSettings } from "@/lib/services/ventures";
import { viewerSettingsSchema } from "@/lib/viewer-settings";

let db: Database;
let ventureId: string;

beforeAll(async () => {
  db = await createTestDb();
  ventureId = (await demoVenture(db)).id;
});

describe("per-venture camera presets (Aerial Overview opening view)", () => {
  it("defaults to automatic framing and exposes presentation rights only to editors", async () => {
    const ceo = await ctxFor(db, "ceo@demo.local");
    const customer = await ctxFor(db, "customer@demo.local");
    const staffView = await getViewerData(ceo, ventureId);
    expect(staffView.venture.settings?.customAerial ?? null).toBeNull();
    expect(staffView.venture.settings?.defaultMode).toBe("aerial");
    expect(staffView.canEditPresentation).toBe(true);
    expect((await getViewerData(customer, ventureId)).canEditPresentation).toBe(false);
  });

  it("an admin saves a custom opening view; customers then receive it", async () => {
    const ceo = await ctxFor(db, "ceo@demo.local");
    const current = await getVentureViewerSettings(ceo, ventureId);
    const pose = { position: [120.5, 180.25, 210] as [number, number, number], target: [0, 0, 0] as [number, number, number] };
    await updateViewerSettings(ceo, ventureId, { ...current, customAerial: pose });
    const customer = await ctxFor(db, "customer@demo.local");
    expect((await getViewerData(customer, ventureId)).venture.settings?.customAerial).toEqual(pose);
    // Reset to automatic framing.
    await updateViewerSettings(ceo, ventureId, { ...current, customAerial: null });
    expect((await getViewerData(customer, ventureId)).venture.settings?.customAerial).toBeNull();
  });

  it("rejects invalid poses and non-editors", async () => {
    const ceo = await ctxFor(db, "ceo@demo.local");
    const current = await getVentureViewerSettings(ceo, ventureId);
    await expect(updateViewerSettings(ceo, ventureId, { ...current, customAerial: { position: [0, -5, 0], target: [0, 0, 0] } })).rejects.toBeTruthy();
    expect(viewerSettingsSchema.safeParse({ customAerial: { position: [1, 2], target: [0, 0, 0] } }).success).toBe(false);
    const anil = await ctxFor(db, "anil@demo.local");
    await expect(updateViewerSettings(anil, ventureId, current)).rejects.toMatchObject({ status: 403 });
  });
});
