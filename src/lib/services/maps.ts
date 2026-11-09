import { z } from "zod";
import type { AuthContext } from "@/lib/auth/context";
import { assertPermission } from "@/lib/auth/context";
import { writeAudit } from "@/lib/audit";
import { badRequest } from "@/lib/errors";
import { env } from "@/lib/env";
import { num } from "@/lib/db/types";
import { db } from "./common";

export const MAP_MODES = ["gis_fence", "google_maps"] as const;
export type MapMode = (typeof MAP_MODES)[number];

/** What the browser needs to draw a site-visit map. `apiKey` is only returned in Google mode. */
export interface MapRuntime { mode: MapMode; apiKey: string | null }

export async function getMapRuntime(ctx: AuthContext): Promise<MapRuntime> {
  const q = await db();
  const [o] = await q.query<{ site_visit_map_mode: string }>("select site_visit_map_mode from organizations where id = $1", [ctx.organizationId]);
  const mode: MapMode = o?.site_visit_map_mode === "google_maps" ? "google_maps" : "gis_fence";
  return { mode, apiKey: mode === "google_maps" && env.GOOGLE_MAPS_API_KEY ? env.GOOGLE_MAPS_API_KEY : null };
}

export interface MapSettingsView {
  mode: MapMode;
  keyConfigured: boolean;
  /** Key for the test map (only handed to users who can manage integrations). */
  testKey: string | null;
  ventures: { id: string; name: string; lat: number | null; lng: number | null; radiusM: number }[];
}

export async function getMapSettings(ctx: AuthContext): Promise<MapSettingsView> {
  assertPermission(ctx, "integration.manage");
  const q = await db();
  const { mode } = await getMapRuntime(ctx);
  const rows = await q.query<{ id: string; name: string; latitude: string | null; longitude: string | null; geofence_radius_m: number | string | null }>(
    "select id, name, latitude, longitude, geofence_radius_m from ventures where organization_id = $1 and deleted_at is null order by (latitude is null), name limit 50", [ctx.organizationId]);
  return {
    mode,
    keyConfigured: !!env.GOOGLE_MAPS_API_KEY,
    testKey: env.GOOGLE_MAPS_API_KEY ?? null,
    ventures: rows.map((v) => ({ id: v.id, name: v.name, lat: v.latitude == null ? null : num(v.latitude), lng: v.longitude == null ? null : num(v.longitude), radiusM: num(v.geofence_radius_m ?? 300) || 300 })),
  };
}

export const mapModeSchema = z.object({ mode: z.enum(MAP_MODES) });

export async function setMapMode(ctx: AuthContext, input: z.infer<typeof mapModeSchema>) {
  assertPermission(ctx, "integration.manage");
  if (input.mode === "google_maps" && !env.GOOGLE_MAPS_API_KEY) throw badRequest("Add GOOGLE_MAPS_API_KEY on the server first, then choose Google Maps.");
  const q = await db();
  const before = (await getMapRuntime(ctx)).mode;
  await q.query("update organizations set site_visit_map_mode = $2 where id = $1", [ctx.organizationId, input.mode]);
  await writeAudit(q, ctx, { action: "integration.maps_mode_changed", entityType: "integration", summary: `Site-visit map mode: ${before} → ${input.mode}`, before: { mode: before }, after: { mode: input.mode } });
  return { mode: input.mode };
}
