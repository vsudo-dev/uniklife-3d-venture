import { z } from "zod";
import type { Queryable } from "@/lib/db/types";
import { constraintName, isPgError, num, numOrNull } from "@/lib/db/types";
import type { AuthContext } from "@/lib/auth/context";
import { assertPermission, can, canAccessVenture, isStaff } from "@/lib/auth/context";
import { badRequest, conflict, notFound } from "@/lib/errors";
import { writeAudit } from "@/lib/audit";
import { parseViewerSettings, PROPERTY_TYPES, viewerSettingsSchema, type PropertyType, type ViewerSettings } from "@/lib/viewer-settings";
import { db, withTx } from "./common";

export const PROPERTY_TYPE_IDS = PROPERTY_TYPES.map((p) => p.id) as [PropertyType, ...PropertyType[]];
const asPropertyType = (v: unknown): PropertyType =>
  (PROPERTY_TYPE_IDS as readonly string[]).includes(String(v)) ? (v as PropertyType) : "open_plot";

export interface VentureSummary {
  id: string;
  name: string;
  code: string;
  slug: string;
  city: string | null;
  state: string | null;
  location_text: string | null;
  status: string;
  is_published: boolean;
  is_demo: boolean;
  cover_image_asset_id: string | null;
  launch_date: string | null;
  total_plots: number;
  available: number;
  held: number;
  reserved: number;
  booked: number;
  sold: number;
  blocked: number;
  min_price: string | null;
  max_price: string | null;
}

export async function listVentures(ctx: AuthContext): Promise<VentureSummary[]> {
  const q = await db();
  const params: unknown[] = [ctx.organizationId];
  const where = ["v.organization_id = $1", "v.deleted_at is null"];
  if (ctx.role === "customer") where.push("v.is_published = true");
  else {
    assertPermission(ctx, "venture.view");
    if (ctx.ventureIds !== null) {
      params.push(ctx.ventureIds);
      where.push(`v.id = any($${params.length}::uuid[])`);
    }
  }
  return q.query<VentureSummary>(
    `select v.id, v.name, v.code, v.slug, v.city, v.state, v.location_text, v.status, v.is_published, v.is_demo, v.cover_image_asset_id,
            to_char(v.launch_date, 'YYYY-MM-DD') as launch_date,
            count(p.id)::int as total_plots,
            count(p.id) filter (where p.status = 'available')::int as available,
            count(p.id) filter (where p.status = 'held')::int as held,
            count(p.id) filter (where p.status = 'reserved')::int as reserved,
            count(p.id) filter (where p.status = 'booked')::int as booked,
            count(p.id) filter (where p.status = 'sold')::int as sold,
            count(p.id) filter (where p.status = 'blocked')::int as blocked,
            min(p.total_base_price) as min_price, max(p.total_base_price) as max_price
       from ventures v left join plots p on p.venture_id = v.id
      where ${where.join(" and ")}
      group by v.id order by v.created_at desc`,
    params,
  );
}

async function loadVentureRow(ctx: AuthContext, q: Queryable, id: string) {
  const [v] = await q.query<Record<string, unknown>>("select * from ventures where organization_id = $1 and id = $2 and deleted_at is null", [ctx.organizationId, id]);
  if (!v) throw notFound("Venture");
  if (ctx.role === "customer" ? !v.is_published : !canAccessVenture(ctx, id)) throw notFound("Venture");
  if (ctx.role !== "customer") assertPermission(ctx, "venture.view");
  return v;
}

export async function getVenture(ctx: AuthContext, id: string) {
  const q = await db();
  const v = await loadVentureRow(ctx, q, id);
  const assets = isStaff(ctx)
    ? await q.query<Record<string, unknown>>(
        "select id, kind, file_name, mime_type, size_bytes, created_at from venture_assets where venture_id = $1 order by created_at desc",
        [id],
      )
    : await q.query<Record<string, unknown>>(
        "select id, kind, file_name, mime_type, size_bytes, created_at from venture_assets where venture_id = $1 and kind in ('image','layout_pdf','model_glb') order by created_at desc",
        [id],
      );
  const phases = await q.query<{ id: string; name: string; code: string }>("select id, name, code from venture_phases where venture_id = $1 order by sort_order", [id]);
  return { venture: v, assets, phases };
}

export interface ViewerPlot {
  id: string;
  plotNumber: string;
  isMortgaged?:boolean;
  mortgageReference?:string|null;
  meshId: string | null;
  polygon: [number, number][] | null;
  status: string;
  areaSqYards: number;
  dimensions: string | null;
  facing: string | null;
  roadWidthFt: number | null;
  isCorner: boolean;
  pricePerSqYard: number;
  totalPrice: number;
  phase: string | null;
  /** Plot's own property type (null = inherits the venture's). */
  propertyType: PropertyType | null;
  /** Effective property type (plot override or the venture's). */
  effectivePropertyType: PropertyType;
}

/** Everything the 3D/2D viewer needs. Prices and status are always read live from the DB. */
export async function getViewerData(ctx: AuthContext, ventureId: string) {
  const q = await db();
  const v = await loadVentureRow(ctx, q, ventureId);
  const plots = await q.query<Record<string, unknown>>(
    `select p.id, p.plot_number, p.is_mortgaged, p.mortgage_reference, p.status, p.area_sq_yards, p.dimensions_text, p.facing, p.road_width_ft, p.is_corner,
            p.base_price_per_sq_yard, p.total_base_price, p.property_type, ph.code as phase, g.mesh_id, g.polygon
       from plots p left join plot_geometry g on g.plot_id = p.id left join venture_phases ph on ph.id = p.phase_id
      where p.venture_id = $1 order by length(p.plot_number), p.plot_number`,
    [ventureId],
  );
  const features = await q.query<{ id: string; kind: string; name: string | null; polygon: [number, number][] }>(
    "select id, kind, name, polygon from venture_features where venture_id = $1",
    [ventureId],
  );
  let modelUrl: string | null = null;
  if (v.viewer_mode === "glb" && v.model_asset_id) modelUrl = `/api/ventures/${ventureId}/assets/${v.model_asset_id}`;
  const propertyType = asPropertyType(v.property_type);
  const settings: ViewerSettings = parseViewerSettings(v.viewer_settings);
  const geofence =
    v.latitude !== null && v.latitude !== undefined && v.longitude !== null && v.longitude !== undefined
      ? { lat: num(v.latitude), lng: num(v.longitude), radiusM: num(v.geofence_radius_m ?? 300) }
      : null;
  return {
    venture: {
      id: String(v.id), name: String(v.name), code: String(v.code), isDemo: Boolean(v.is_demo), status: String(v.status),
      viewerMode: String(v.viewer_mode) as "procedural" | "glb", modelUrl, amenities: (v.amenities as string[]) ?? [],
      location: (v.location_text as string) ?? null,
      settings, propertyType, geofence,
      layoutImage:settings.referenceLayout&&v.cover_image_asset_id?{url:`/api/ventures/${ventureId}/assets/${v.cover_image_asset_id}`,...settings.referenceLayout}:null,
    },
    plots: plots.map<ViewerPlot>((p) => ({
      isMortgaged:Boolean(p.is_mortgaged), mortgageReference:(p.mortgage_reference as string) ?? null,
      id: String(p.id), plotNumber: String(p.plot_number), meshId: (p.mesh_id as string) ?? null,
      polygon: (p.polygon as [number, number][]) ?? null, status: String(p.status), areaSqYards: num(p.area_sq_yards),
      dimensions: (p.dimensions_text as string) ?? null, facing: (p.facing as string) ?? null, roadWidthFt: numOrNull(p.road_width_ft),
      isCorner: Boolean(p.is_corner), pricePerSqYard: num(p.base_price_per_sq_yard), totalPrice: num(p.total_base_price),
      phase: (p.phase as string) ?? null,
      propertyType: p.property_type ? asPropertyType(p.property_type) : null,
      effectivePropertyType: p.property_type ? asPropertyType(p.property_type) : propertyType,
    })),
    features,
    canBook: ctx.role === "customer" || can(ctx, "booking.create"),
    canEditPresentation: ctx.role !== "customer" && can(ctx, "venture.update"),
  };
}

const optStr = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));

export const ventureInputSchema = z.object({
  name: z.string().trim().min(2).max(160),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9-]{1,31}$/, "Code: 2-32 chars, A-Z 0-9 -"),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,80}$/, "Slug: lowercase letters, digits, hyphens"),
  description: optStr(4000),
  locationText: optStr(300),
  city: optStr(80),
  state: optStr(80),
  latitude: z.coerce.number().min(-90).max(90).optional().nullable(),
  longitude: z.coerce.number().min(-180).max(180).optional().nullable(),
  surveyNumbers: optStr(500),
  approvalAuthority: optStr(200),
  approvalReference: optStr(200),
  totalLandArea: z.coerce.number().positive().optional().nullable(),
  landAreaUnit: z.enum(["acres", "sq_yards", "sq_meters", "hectares"]).default("acres"),
  declaredTotalPlots: z.coerce.number().int().min(0).optional().nullable(),
  roadsDescription: optStr(1000),
  amenities: z.array(z.string().trim().min(1).max(60)).max(40).default([]),
  launchDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable().or(z.literal("").transform(() => null)),
  status: z.enum(["draft", "upcoming", "launched", "sold_out", "on_hold", "archived"]).default("draft"),
  isPublished: z.boolean().default(false),
  holdMinutes: z.coerce.number().int().min(1).max(1440).optional().nullable(),
  bookingAmountPercent: z.coerce.number().gt(0).max(100).optional().nullable(),
  viewerMode: z.enum(["procedural", "glb"]).default("procedural"),
  /** Omitted = 'open_plot' on create, unchanged on update. */
  propertyType: z.enum(PROPERTY_TYPE_IDS).optional(),
  /** Site-visit geofence radius around latitude/longitude. Omitted = 300 m on create, unchanged on update. */
  geofenceRadiusM: z.coerce.number().int("Radius must be a whole number of metres").min(50, "Radius must be at least 50 m").max(5000, "Radius must be at most 5000 m").optional(),
});
export type VentureInput = z.infer<typeof ventureInputSchema>;

function ventureParams(i: VentureInput) {
  return [
    i.name, i.code, i.slug, i.description, i.locationText, i.city, i.state, i.latitude ?? null, i.longitude ?? null, i.surveyNumbers,
    i.approvalAuthority, i.approvalReference, i.totalLandArea ?? null, i.landAreaUnit, i.declaredTotalPlots ?? null, i.roadsDescription,
    i.amenities, i.launchDate ?? null, i.status, i.isPublished, i.holdMinutes ?? null, i.bookingAmountPercent ?? null, i.viewerMode,
    i.propertyType ?? null, i.geofenceRadiusM ?? null,
  ];
}

function mapVentureError(e: unknown): never {
  if (isPgError(e, "23505")) {
    const c = constraintName(e) ?? "";
    if (c.includes("slug")) throw conflict("That URL slug is already in use");
    throw conflict("A venture with this code already exists");
  }
  throw e;
}

export async function createVenture(ctx: AuthContext, input: VentureInput) {
  assertPermission(ctx, "venture.create");
  return withTx(async (q) => {
    const [row] = await q
      .query<Record<string, unknown>>(
        `insert into ventures (organization_id, created_by, name, code, slug, description, location_text, city, state, latitude, longitude,
                               survey_numbers, approval_authority, approval_reference, total_land_area, land_area_unit, declared_total_plots,
                               roads_description, amenities, launch_date, status, is_published, hold_minutes, booking_amount_percent, viewer_mode,
                               property_type, geofence_radius_m)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::text[],$20,$21,$22,$23,$24,$25,
                 coalesce($26::text, 'open_plot'), coalesce($27::int, 300)) returning *`,
        [ctx.organizationId, ctx.user.id, ...ventureParams(input)],
      )
      .catch(mapVentureError);
    await writeAudit(q, ctx, { action: "venture.created", entityType: "venture", entityId: String(row.id), summary: `Created venture ${input.name}`, after: row });
    return row;
  });
}

export async function updateVenture(ctx: AuthContext, id: string, input: VentureInput) {
  assertPermission(ctx, "venture.update");
  return withTx(async (q) => {
    const before = await loadVentureRow(ctx, q, id);
    // Approval references are user-provided; changing them clears any prior verification.
    const approvalChanged = before.approval_reference !== input.approvalReference || before.approval_authority !== input.approvalAuthority;
    const [after] = await q
      .query<Record<string, unknown>>(
        `update ventures set name=$3, code=$4, slug=$5, description=$6, location_text=$7, city=$8, state=$9, latitude=$10, longitude=$11,
                survey_numbers=$12, approval_authority=$13, approval_reference=$14, total_land_area=$15, land_area_unit=$16,
                declared_total_plots=$17, roads_description=$18, amenities=$19::text[], launch_date=$20, status=$21, is_published=$22,
                hold_minutes=$23, booking_amount_percent=$24, viewer_mode=$25,
                property_type = coalesce($26::text, property_type), geofence_radius_m = coalesce($27::int, geofence_radius_m),
                approval_verified = case when $28 then false else approval_verified end,
                approval_verified_by = case when $28 then null else approval_verified_by end,
                approval_verified_at = case when $28 then null else approval_verified_at end
          where organization_id = $1 and id = $2 returning *`,
        [ctx.organizationId, id, ...ventureParams(input), approvalChanged],
      )
      .catch(mapVentureError);
    await writeAudit(q, ctx, { action: "venture.updated", entityType: "venture", entityId: id, before, after });
    return after;
  });
}

/** Full venture row for the edit form, plus who verified the approval reference (venture.update only). */
export async function getVentureForEdit(ctx: AuthContext, id: string) {
  assertPermission(ctx, "venture.update");
  const q = await db();
  const v = await loadVentureRow(ctx, q, id);
  let verifiedByName: string | null = null;
  if (v.approval_verified_by) {
    const [u] = await q.query<{ full_name: string }>("select full_name from app_users where id = $1", [v.approval_verified_by]);
    verifiedByName = u?.full_name ?? null;
  }
  const [{ plots, launch }] = await q.query<{ plots: number; launch: string | null }>(
    "select (select count(*)::int from plots where venture_id = $1) as plots, (select to_char(launch_date, 'YYYY-MM-DD') from ventures where id = $1) as launch",
    [id],
  );
  return { venture: v, verifiedByName, plotCount: plots, launchDate: launch, settings: parseViewerSettings(v.viewer_settings), propertyType: asPropertyType(v.property_type) };
}

/** Parsed (defaulted) viewer & presentation settings of a venture the caller can see. */
export async function getVentureViewerSettings(ctx: AuthContext, id: string): Promise<ViewerSettings> {
  const q = await db();
  const v = await loadVentureRow(ctx, q, id);
  return parseViewerSettings(v.viewer_settings);
}

/**
 * Replaces the venture's 3D viewer & presentation settings (venture.update).
 * Input is validated with viewerSettingsSchema; missing fields take their defaults.
 */
export async function updateViewerSettings(ctx: AuthContext, id: string, raw: unknown): Promise<ViewerSettings> {
  assertPermission(ctx, "venture.update");
  const settings = viewerSettingsSchema.parse(raw ?? {});
  return withTx(async (q) => {
    const before = await loadVentureRow(ctx, q, id);
    await q.query("update ventures set viewer_settings = $3::jsonb where organization_id = $1 and id = $2", [ctx.organizationId, id, JSON.stringify(settings)]);
    await writeAudit(q, ctx, {
      action: "venture.viewer_settings_updated", entityType: "venture", entityId: id,
      summary: `Viewer & presentation settings updated for ${String(before.name)}`,
      before: { viewer_settings: parseViewerSettings(before.viewer_settings) }, after: { viewer_settings: settings },
    });
    return settings;
  });
}

/** Records that a staff member verified the user-provided approval reference against source documents. */
export async function setApprovalVerification(ctx: AuthContext, id: string, verified: boolean, note: string) {
  assertPermission(ctx, "venture.update");
  if (verified && (!note || note.trim().length < 5)) throw badRequest("Describe how the approval was verified");
  return withTx(async (q) => {
    const v = await loadVentureRow(ctx, q, id);
    if (verified && !v.approval_reference) throw badRequest("No approval reference to verify");
    await q.query(
      "update ventures set approval_verified = $3, approval_verified_by = $4, approval_verified_at = case when $3 then now() else null end where organization_id = $1 and id = $2",
      [ctx.organizationId, id, verified, verified ? ctx.user.id : null],
    );
    await writeAudit(q, ctx, { action: verified ? "venture.approval_verified" : "venture.approval_unverified", entityType: "venture", entityId: id, summary: note });
    return { ok: true };
  });
}

/** Reversible deletion: hide inventory; retain booking, payment and audit history. */
export async function deleteVenture(ctx: AuthContext,id:string){
 assertPermission(ctx,"venture.delete");
 return withTx(async q=>{const [v]=await q.query<{name:string;deleted_at:string|null}>("select name,deleted_at from ventures where id=$1 and organization_id=$2 for update",[id,ctx.organizationId]);if(!v)throw notFound("Venture");if(v.deleted_at)return {deleted:true};await q.query("update ventures set deleted_at=now(),deleted_by=$3,is_published=false,status='archived' where id=$1 and organization_id=$2",[id,ctx.organizationId,ctx.user.id]);await writeAudit(q,ctx,{action:"venture.deleted",entityType:"venture",entityId:id,summary:`Deleted venture ${v.name}; transaction history retained`});return {deleted:true};});
}
