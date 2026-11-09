import { beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/types";
import { createTestDb, ctxFor } from "../support/db";
import { getMapRuntime, getMapSettings, mapModeSchema, setMapMode } from "@/lib/services/maps";

let db: Database;
beforeAll(async () => { db = await createTestDb(); });

describe("site-visit map mode", () => {
  it("defaults to the stationary GIS fence and never exposes a key in that mode", async () => {
    const ceo = await ctxFor(db, "ceo@demo.local");
    expect(await getMapRuntime(ceo)).toEqual({ mode: "gis_fence", apiKey: null });
    expect((await getMapSettings(ceo)).mode).toBe("gis_fence");
  });

  it("refuses Google Maps while no key is configured on the server", async () => {
    const ceo = await ctxFor(db, "ceo@demo.local");
    await expect(setMapMode(ceo, { mode: "google_maps" })).rejects.toThrow(/GOOGLE_MAPS_API_KEY/);
  });

  it("validates the mode, allows switching to the GIS fence with an audit entry, and is permission-gated", async () => {
    expect(mapModeSchema.safeParse({ mode: "satellite" }).success).toBe(false);
    const ceo = await ctxFor(db, "ceo@demo.local");
    await setMapMode(ceo, { mode: "gis_fence" });
    const audit = await db.query("select id from audit_logs where action = 'integration.maps_mode_changed'");
    expect(audit.length).toBe(1);
    const exec = await ctxFor(db, "anil@demo.local");
    await expect(setMapMode(exec, { mode: "gis_fence" })).rejects.toThrow();
    await expect(getMapSettings(exec)).rejects.toThrow();
  });
});
