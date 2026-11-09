import { z } from "zod";
import type { Queryable } from "@/lib/db/types";
import { isPgError, num, numOrNull } from "@/lib/db/types";
import type { AuthContext } from "@/lib/auth/context";
import { assertPermission, assertStaff, can, canAccessVenture, ventureScopeSql } from "@/lib/auth/context";
import { badRequest, conflict, notFound, unprocessable } from "@/lib/errors";
import { writeAudit } from "@/lib/audit";
import { parseCsv, toCsv } from "@/lib/csv";
import { parseDxf, DxfParseError } from "@/lib/cad/dxf";
import { buildImportPreview, meshIdForPlot, naturalCompare, AREA_DEVIATION_THRESHOLD, type ImportPreview } from "@/lib/cad/import";
import { bbox, round3, type Pt } from "@/lib/cad/geometry";
import { canSeeBooking } from "./bookings";
import { readDxfAssetText } from "./assets";
import { db, isUuid, withTx } from "./common";
import { PROPERTY_TYPES, type PropertyType } from "@/lib/viewer-settings";

export const PLOT_PROPERTY_TYPE_IDS = PROPERTY_TYPES.map((p) => p.id) as [PropertyType, ...PropertyType[]];

export const PLOT_STATUSES = ["available", "held", "reserved", "booked", "sold", "blocked"] as const;
export const FACINGS = ["N", "S", "E", "W", "NE", "NW", "SE", "SW"] as const;
/** Statuses owned by the booking engine — inventory tools never change them. */
export const ENGINE_STATUSES = ["held", "reserved", "booked", "sold"];

// ---------------------------------------------------------------------------
// Scope helpers
// ---------------------------------------------------------------------------
function assertInventoryViewer(ctx: AuthContext) {
  assertStaff(ctx);
  assertPermission(ctx, "venture.view");
}

async function loadScopedVenture(ctx: AuthContext, q: Queryable, ventureId: string) {
  if (!isUuid(ventureId)) throw notFound("Venture");
  const [v] = await q.query<{ id: string; name: string; code: string; model_asset_id: string | null; viewer_mode: string; is_demo: boolean }>(
    "select id, name, code, model_asset_id, viewer_mode, is_demo from ventures where organization_id = $1 and id = $2",
    [ctx.organizationId, ventureId],
  );
  if (!v || !canAccessVenture(ctx, v.id)) throw notFound("Venture");
  return v;
}

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (m) => "\\" + m);

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------
const optNum = z.preprocess((v) => (v === "" || v === null || v === undefined ? undefined : v), z.coerce.number().nonnegative().optional());
const optStrQ = z.preprocess((v) => (v === "" || v === null ? undefined : v), z.string().trim().max(64).optional());

export const PLOT_SORTS = ["plot_number", "phase", "area", "facing", "road", "price", "total", "status"] as const;

export const plotFilterSchema = z.object({
  ventureId: z.preprocess((v) => (v === "" || v === null ? undefined : v), z.string().uuid().optional()),
  phase: optStrQ,
  status: z.preprocess((v) => (v === "" || v === null ? undefined : v), z.enum(PLOT_STATUSES).optional()),
  facing: z.preprocess((v) => (v === "" || v === null ? undefined : v), z.enum(FACINGS).optional()),
  minArea: optNum,
  maxArea: optNum,
  minPrice: optNum,
  maxPrice: optNum,
  corner: z.preprocess((v) => (v === "" || v === null ? undefined : v), z.enum(["yes", "no"]).optional()),
  /** Effective property type (the plot's own, else the venture's). */
  propertyType: z.preprocess((v) => (v === "" || v === null ? undefined : v), z.enum(PLOT_PROPERTY_TYPE_IDS).optional()),
  q: optStrQ,
  sort: z.preprocess((v) => (v === "" || v === null ? undefined : v), z.enum(PLOT_SORTS).default("plot_number")),
  dir: z.preprocess((v) => (v === "" || v === null ? undefined : v), z.enum(["asc", "desc"]).default("asc")),
  page: z.preprocess((v) => (v === "" || v === null ? undefined : v), z.coerce.number().int().min(1).default(1)),
  pageSize: z.preprocess((v) => (v === "" || v === null ? undefined : v), z.coerce.number().int().min(5).max(200).default(50)),
});
export type PlotFilters = z.infer<typeof plotFilterSchema>;

export interface PlotListRow {
  id: string;
  venture_id: string;
  venture_name: string;
  venture_code: string;
  plot_number: string;
  phase_code: string | null;
  phase_name: string | null;
  area_sq_yards: number;
  length_ft: number | null;
  width_ft: number | null;
  north_ft?:number|null; south_ft?:number|null; east_ft?:number|null; west_ft?:number|null;
  dimensions_text: string | null;
  facing: string | null;
  road_width_ft: number | null;
  is_corner: boolean;
  base_price_per_sq_yard: number;
  total_base_price: number;
  status: string;
  blocked_reason: string | null;
  is_mortgaged?: boolean;
  mortgage_reference?: string | null;
  version: number;
  mesh_id: string | null;
  /** Plot's own property type; null = inherits the venture's. */
  property_type: PropertyType | null;
  /** Plot's own property type, else the venture's. */
  effective_property_type: PropertyType;
  has_active_hold: boolean;
  has_live_booking: boolean;
  /** Only populated when the caller may see the live booking (booking.view + network/venture visibility). */
  current_customer: string | null;
  current_booking_id: string | null;
  current_booking_number: string | null;
}

const SORT_SQL: Record<(typeof PLOT_SORTS)[number], string> = {
  plot_number: "length(p.plot_number) {d}, p.plot_number {d}",
  phase: "ph.code {d} nulls last, length(p.plot_number), p.plot_number",
  area: "p.area_sq_yards {d}, length(p.plot_number), p.plot_number",
  facing: "p.facing {d} nulls last, length(p.plot_number), p.plot_number",
  road: "p.road_width_ft {d} nulls last, length(p.plot_number), p.plot_number",
  price: "p.base_price_per_sq_yard {d}, length(p.plot_number), p.plot_number",
  total: "p.total_base_price {d}, length(p.plot_number), p.plot_number",
  status: "p.status {d}, length(p.plot_number), p.plot_number",
};

function buildPlotWhere(ctx: AuthContext, f: Partial<PlotFilters>, params: unknown[]): string {
  const where = ["p.organization_id = $1", "exists(select 1 from ventures active_v where active_v.id=p.venture_id and active_v.deleted_at is null)"];
  params.push(ctx.organizationId);
  where.push(ventureScopeSql(ctx, "p.venture_id", params));
  const add = (sql: string, v: unknown) => {
    params.push(v);
    where.push(sql.replace("?", `$${params.length}`));
  };
  if (f.ventureId) add("p.venture_id = ?", f.ventureId);
  if (f.phase) add("upper(ph.code) = upper(?)", f.phase);
  if (f.status) add("p.status = ?", f.status);
  if (f.facing) add("p.facing = ?", f.facing);
  if (f.minArea !== undefined) add("p.area_sq_yards >= ?", f.minArea);
  if (f.maxArea !== undefined) add("p.area_sq_yards <= ?", f.maxArea);
  if (f.minPrice !== undefined) add("p.total_base_price >= ?", f.minPrice);
  if (f.maxPrice !== undefined) add("p.total_base_price <= ?", f.maxPrice);
  if (f.propertyType) add("coalesce(p.property_type, (select vv.property_type from ventures vv where vv.id = p.venture_id)) = ?", f.propertyType);
  if (f.corner) where.push(f.corner === "yes" ? "p.is_corner" : "not p.is_corner");
  if (f.q) add("lower(p.plot_number) like ? escape '\\'", `%${likeEscape(f.q.toLowerCase())}%`);
  return where.join(" and ");
}

async function queryPlots(ctx: AuthContext, q: Queryable, f: Partial<PlotFilters>, limit: number, offset: number) {
  const params: unknown[] = [];
  const where = buildPlotWhere(ctx, f, params);
  const showCustomer = can(ctx, "booking.view");
  const sort = SORT_SQL[f.sort ?? "plot_number"].replace(/\{d\}/g, f.dir === "desc" ? "desc" : "asc");
  const [{ total }] = await q.query<{ total: number }>(
    `select count(*)::int as total from plots p left join venture_phases ph on ph.id = p.phase_id where ${where}`,
    params,
  );
  params.push(limit, offset);
  const rows = await q.query<Record<string, unknown>>(
    `select p.id, p.venture_id, v.name as venture_name, v.code as venture_code, p.plot_number, ph.code as phase_code, ph.name as phase_name,
            p.area_sq_yards, p.length_ft, p.width_ft, p.north_ft, p.south_ft, p.east_ft, p.west_ft, p.dimensions_text, p.facing, p.road_width_ft, p.is_corner,
            p.base_price_per_sq_yard, p.total_base_price, p.status, p.blocked_reason, p.is_mortgaged, p.mortgage_reference, p.version, g.mesh_id,
            p.property_type, v.property_type as venture_property_type,
            exists (select 1 from reservations r where r.plot_id = p.id and r.status = 'active') as has_active_hold,
            lb.booking_id is not null as has_live_booking
            ${showCustomer ? ", lb.booking_id, lb.booking_number, lb.customer_id, lb.requested_by, lb.credited_employee_id, lb.booking_venture_id, lb.booking_org, lb.customer_name" : ""}
       from plots p
       join ventures v on v.id = p.venture_id
       left join venture_phases ph on ph.id = p.phase_id
       left join plot_geometry g on g.plot_id = p.id
       left join lateral (
         select b.id as booking_id, b.booking_number, b.customer_id, b.requested_by, b.credited_employee_id, b.venture_id as booking_venture_id,
                b.organization_id as booking_org, c.full_name as customer_name
           from booking_plots bp join bookings b on b.id = bp.booking_id join customers c on c.id = b.customer_id
          where bp.plot_id = p.id and bp.is_live limit 1
       ) lb on true
      where ${where}
      order by ${f.ventureId ? "" : "v.name, "}${sort}
      limit $${params.length - 1} offset $${params.length}`,
    params,
  );
  const mapped: PlotListRow[] = rows.map((r) => {
    let customer: string | null = null;
    let bookingId: string | null = null;
    let bookingNumber: string | null = null;
    if (showCustomer && r.booking_id) {
      const visible = canSeeBooking(ctx, {
        organization_id: r.booking_org, customer_id: r.customer_id, venture_id: r.booking_venture_id,
        requested_by: r.requested_by, credited_employee_id: r.credited_employee_id,
      });
      if (visible) {
        customer = String(r.customer_name);
        bookingId = String(r.booking_id);
        bookingNumber = String(r.booking_number);
      }
    }
    return {
      id: String(r.id), venture_id: String(r.venture_id), venture_name: String(r.venture_name), venture_code: String(r.venture_code),
      plot_number: String(r.plot_number), phase_code: (r.phase_code as string) ?? null, phase_name: (r.phase_name as string) ?? null,
      area_sq_yards: num(r.area_sq_yards), length_ft: numOrNull(r.length_ft), width_ft: numOrNull(r.width_ft),
      north_ft:numOrNull(r.north_ft),south_ft:numOrNull(r.south_ft),east_ft:numOrNull(r.east_ft),west_ft:numOrNull(r.west_ft),
      dimensions_text: (r.dimensions_text as string) ?? null, facing: (r.facing as string) ?? null, road_width_ft: numOrNull(r.road_width_ft),
      is_corner: Boolean(r.is_corner), base_price_per_sq_yard: num(r.base_price_per_sq_yard), total_base_price: num(r.total_base_price),
      is_mortgaged: Boolean(r.is_mortgaged), mortgage_reference: (r.mortgage_reference as string) ?? null,
      status: String(r.status), blocked_reason: (r.blocked_reason as string) ?? null, version: num(r.version), mesh_id: (r.mesh_id as string) ?? null,
      property_type: (r.property_type as PropertyType) ?? null,
      effective_property_type: ((r.property_type as PropertyType) ?? (r.venture_property_type as PropertyType)) || "open_plot",
      has_active_hold: Boolean(r.has_active_hold), has_live_booking: Boolean(r.has_live_booking),
      current_customer: customer, current_booking_id: bookingId, current_booking_number: bookingNumber,
    };
  });
  return { rows: mapped, total };
}

export async function listPlots(ctx: AuthContext, filters: Partial<PlotFilters> = {}) {
  assertInventoryViewer(ctx);
  const f = plotFilterSchema.parse(filters);
  const q = await db();
  const { rows, total } = await queryPlots(ctx, q, f, f.pageSize, (f.page - 1) * f.pageSize);
  const params:unknown[]=[];
  const where=buildPlotWhere(ctx,f,params);
  const [summary]=await q.query<{mortgaged:number;unpriced:number;available:number}>(`select count(*) filter(where p.is_mortgaged)::int as mortgaged, count(*) filter(where p.base_price_per_sq_yard<=0)::int as unpriced, count(*) filter(where p.status='available' and not p.is_mortgaged and p.base_price_per_sq_yard>0)::int as available from plots p left join venture_phases ph on ph.id=p.phase_id where ${where}`,params);
  return { rows, total, summary, page: f.page, pageSize: f.pageSize, pages: Math.max(1, Math.ceil(total / f.pageSize)), filters: f };
}

/** Ventures and phases the caller may filter by. */
export async function plotFilterOptions(ctx: AuthContext, ventureId?: string | null) {
  assertInventoryViewer(ctx);
  const q = await db();
  const params: unknown[] = [ctx.organizationId];
  const scope = ventureScopeSql(ctx, "v.id", params);
  const ventures = await q.query<{ id: string; name: string; code: string }>(
    `select v.id, v.name, v.code from ventures v where v.organization_id = $1 and v.deleted_at is null and ${scope} order by v.name`,
    params,
  );
  let phases: { id: string; code: string; name: string }[] = [];
  if (ventureId && ventures.some((v) => v.id === ventureId)) {
    phases = await q.query("select id, code, name from venture_phases where organization_id = $1 and venture_id = $2 order by sort_order, code", [ctx.organizationId, ventureId]);
  } else {
    const p2: unknown[] = [ctx.organizationId];
    const s2 = ventureScopeSql(ctx, "venture_id", p2);
    phases = await q.query(`select min(id::text) as id, code, min(name) as name from venture_phases where organization_id = $1 and ${s2} group by code order by code`, p2);
  }
  return { ventures, phases };
}

// ---------------------------------------------------------------------------
// Details
// ---------------------------------------------------------------------------
async function loadPlotRow(ctx: AuthContext, q: Queryable, plotId: string, forUpdate = false) {
  if (!isUuid(plotId)) throw notFound("Plot");
  const [p] = await q.query<Record<string, unknown>>(
    `select * from plots where organization_id = $1 and id = $2 and exists(select 1 from ventures av where av.id=plots.venture_id and av.deleted_at is null)${forUpdate ? " for update" : ""}`,
    [ctx.organizationId, plotId],
  );
  if (!p || !canAccessVenture(ctx, String(p.venture_id))) throw notFound("Plot");
  return p;
}

export async function getPlot(ctx: AuthContext, plotId: string) {
  assertInventoryViewer(ctx);
  const q = await db();
  await loadPlotRow(ctx, q, plotId);
  const [plot] = await q.query<Record<string, unknown>>(
    `select p.*, v.name as venture_name, v.code as venture_code, v.is_demo as venture_is_demo, v.property_type as venture_property_type,
            coalesce(p.property_type, v.property_type) as effective_property_type, ph.code as phase_code, ph.name as phase_name,
            g.mesh_id, g.polygon, g.centroid_x, g.centroid_y, g.source as geometry_source, g.updated_at as geometry_updated_at,
            exists (select 1 from reservations r where r.plot_id = p.id and r.status = 'active') as has_active_hold,
            exists (select 1 from booking_plots bp where bp.plot_id = p.id and bp.is_live) as has_live_booking,
            exists (select 1 from booking_plots bp where bp.plot_id = p.id) as has_booking_history
       from plots p join ventures v on v.id = p.venture_id
       left join venture_phases ph on ph.id = p.phase_id left join plot_geometry g on g.plot_id = p.id
      where p.organization_id = $1 and p.id = $2`,
    [ctx.organizationId, plotId],
  );
  const prices = await q.query<Record<string, unknown>>(
    `select pp.id, pp.price_per_sq_yard, pp.effective_from, pp.reason, u.full_name as created_by_name
       from plot_prices pp left join app_users u on u.id = pp.created_by
      where pp.organization_id = $1 and pp.plot_id = $2 order by pp.effective_from desc, pp.created_at desc limit 100`,
    [ctx.organizationId, plotId],
  );
  const statusHistory = await q.query<Record<string, unknown>>(
    `select h.id, h.from_status, h.to_status, h.reason, h.created_at, h.booking_id, u.full_name as actor_name
       from plot_status_history h left join app_users u on u.id = h.actor_user_id
      where h.organization_id = $1 and h.plot_id = $2 order by h.created_at desc limit 200`,
    [ctx.organizationId, plotId],
  );
  let bookings: Record<string, unknown>[] = [];
  if (can(ctx, "booking.view")) {
    const raw = await q.query<Record<string, unknown>>(
      `select b.id, b.organization_id, b.venture_id, b.customer_id, b.requested_by, b.credited_employee_id, b.booking_number, b.status, b.created_at,
              bp.price_per_sq_yard, bp.net_amount, bp.area_sq_yards, c.full_name as customer_name
         from booking_plots bp join bookings b on b.id = bp.booking_id join customers c on c.id = b.customer_id
        where bp.organization_id = $1 and bp.plot_id = $2 order by b.created_at desc`,
      [ctx.organizationId, plotId],
    );
    bookings = raw.filter((b) => canSeeBooking(ctx, b)).map((b) => ({
      id: b.id, booking_number: b.booking_number, status: b.status, created_at: b.created_at, customer_name: b.customer_name,
      price_per_sq_yard: b.price_per_sq_yard, net_amount: b.net_amount, area_sq_yards: b.area_sq_yards,
    }));
  }
  const ep: unknown[] = [ctx.organizationId, plotId];
  let enquiryScope = "true";
  if (ctx.networkEmployeeIds !== null) {
    ep.push(ctx.networkEmployeeIds, ctx.user.id);
    enquiryScope = "(e.assigned_employee_id = any($3::uuid[]) or e.created_by = $4)";
  }
  const [{ n: enquiryCount }] = can(ctx, "enquiry.view")
    ? await q.query<{ n: number }>(`select count(*)::int as n from enquiries e where e.organization_id = $1 and e.plot_id = $2 and ${enquiryScope}`, ep)
    : [{ n: 0 }];
  const phases = await q.query<{ id: string; code: string; name: string }>(
    "select id, code, name from venture_phases where organization_id = $1 and venture_id = $2 order by sort_order, code",
    [ctx.organizationId, plot.venture_id],
  );
  return { plot, prices, statusHistory, bookings, enquiryCount, phases };
}

// ---------------------------------------------------------------------------
// Edit
// ---------------------------------------------------------------------------
const nullableNum = (schema: z.ZodNumber) => z.preprocess((v) => (v === "" || v === undefined ? null : v), z.union([z.null(), z.coerce.number().pipe(schema)]));
const optText = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));

export const plotUpdateSchema = z.object({
  version: z.coerce.number().int().min(1),
  plotNumber: z.string().trim().min(1).max(32),
  phaseId: z.preprocess((v) => (v === "" ? null : v), z.string().uuid().nullable()),
  areaSqYards: z.coerce.number().positive().max(10_000_000),
  lengthFt: nullableNum(z.number().positive().max(100000)),
  widthFt: nullableNum(z.number().positive().max(100000)),
  dimensionsText: optText(120),
  facing: z.preprocess((v) => (v === "" ? null : v), z.enum(FACINGS).nullable()),
  roadWidthFt: nullableNum(z.number().positive().max(10000)),
  isCorner: z.boolean(),
  basePricePerSqYard: z.coerce.number().min(0).max(1e10),
  priceReason: optText(300),
  notes: optText(2000),
  /** null / "" = inherit the venture's property type; omitted = unchanged. */
  propertyType: z.preprocess((v) => (v === "" ? null : v), z.enum(PLOT_PROPERTY_TYPE_IDS).nullable()).optional(),
});

export async function updatePlot(ctx: AuthContext, plotId: string, input: z.infer<typeof plotUpdateSchema>) {
  assertPermission(ctx, "plot.manage");
  return withTx(async (q) => {
    const before = await loadPlotRow(ctx, q, plotId, true);
    if (num(before.version) !== input.version) throw conflict("This plot was changed by someone else — reload and try again");
    if (input.plotNumber !== before.plot_number) {
      const [{ n }] = await q.query<{ n: number }>("select count(*)::int as n from booking_plots where plot_id = $1", [plotId]);
      if (n > 0) throw conflict("The plot number cannot change once the plot has booking history");
    }
    if (input.phaseId) {
      const [ph] = await q.query("select 1 from venture_phases where organization_id = $1 and venture_id = $2 and id = $3", [ctx.organizationId, before.venture_id, input.phaseId]);
      if (!ph) throw badRequest("Phase does not belong to this venture");
    }
    const priceChanged = num(before.base_price_per_sq_yard) !== input.basePricePerSqYard;
    if (priceChanged && (!input.priceReason || input.priceReason.length < 3)) throw badRequest("A reason is required when changing the price");
    const [after] = await q
      .query<Record<string, unknown>>(
        `update plots set plot_number = $3, phase_id = $4, area_sq_yards = $5, length_ft = $6, width_ft = $7, dimensions_text = $8, facing = $9,
                road_width_ft = $10, is_corner = $11, base_price_per_sq_yard = $12, notes = $13,
                property_type = case when $14::boolean then $15::text else property_type end, version = version + 1
          where organization_id = $1 and id = $2 returning *`,
        [ctx.organizationId, plotId, input.plotNumber, input.phaseId, input.areaSqYards, input.lengthFt, input.widthFt,
          input.dimensionsText ?? (input.widthFt && input.lengthFt ? `${input.widthFt} ft × ${input.lengthFt} ft` : null),
          input.facing, input.roadWidthFt, input.isCorner, input.basePricePerSqYard, input.notes,
          input.propertyType !== undefined, input.propertyType ?? null],
      )
      .catch((e) => {
        if (isPgError(e, "23505")) throw conflict("Another plot in this venture already uses that plot number");
        throw e;
      });
    if (priceChanged) {
      await q.query("insert into plot_prices (organization_id, plot_id, price_per_sq_yard, reason, created_by) values ($1,$2,$3,$4,$5)",
        [ctx.organizationId, plotId, input.basePricePerSqYard, input.priceReason, ctx.user.id]);
    }
    await writeAudit(q, ctx, { action: "plot.updated", entityType: "plot", entityId: plotId, summary: `Plot ${after.plot_number} updated`, before, after });
    return after;
  });
}

// ---------------------------------------------------------------------------
// Bulk actions: block / unblock / price
// ---------------------------------------------------------------------------
export const bulkBlockSchema = z.object({
  plotIds: z.array(z.string().uuid()).min(1).max(500),
  reason: z.string().trim().min(5, "Reason must be at least 5 characters").max(500),
});

export const mortgageSchema = z.object({
  version:z.number().int().positive(), isMortgaged:z.boolean(),
  reference:z.string().trim().max(300), reason:z.string().trim().min(5).max(500),
});

/** Releasing a mortgage never makes a plot available; the normal priced/unblock review still applies. */
export async function updatePlotMortgage(ctx:AuthContext, plotId:string, raw:z.infer<typeof mortgageSchema>) {
  assertPermission(ctx,"plot.manage");
  const input=mortgageSchema.parse(raw);
  return withTx(async q=>{
    const [p]=await lockPlots(ctx,q,[plotId]);
    if(num(p.version)!==input.version) throw conflict("Plot changed. Reload before saving.");
    if(input.isMortgaged && (ENGINE_STATUSES.includes(String(p.status)) || p.has_active_hold || p.has_live_booking)) throw conflict("A plot with a hold or booking cannot be mortgaged");
    if(p.is_mortgaged && !input.isMortgaged && !input.reference) throw badRequest("A mortgage release document reference is required");
    const blocking=input.isMortgaged && p.status!=="blocked";
    const [after]=await q.query<Record<string,unknown>>(
      `update plots set is_mortgaged=$3,mortgage_reference=$4,status=case when $3 then 'blocked' else status end,
       blocked_reason=case when $3 then 'Mortgage: ' || $5 when is_mortgaged then 'Mortgage released; review selling price and unblock separately' else blocked_reason end,
       version=version+1 where organization_id=$1 and id=$2 returning *`,
      [ctx.organizationId,plotId,input.isMortgaged,input.reference||null,input.reason]);
    if(blocking) await insertStatusHistory(q,ctx,[{id:plotId,from:String(p.status)}],"blocked",input.reason);
    await writeAudit(q,ctx,{action:"plot.mortgage_updated",entityType:"plot",entityId:plotId,summary:input.reason,before:p,after});
    return after;
  });
}

async function lockPlots(ctx: AuthContext, q: Queryable, plotIds: string[]) {
  const ids = [...new Set(plotIds)];
  const rows = await q.query<Record<string, unknown>>(
    `select p.*, exists (select 1 from reservations r where r.plot_id = p.id and r.status = 'active') as has_active_hold,
            exists (select 1 from booking_plots bp where bp.plot_id = p.id and bp.is_live) as has_live_booking
       from plots p where p.organization_id = $1 and p.id = any($2::uuid[]) order by p.id for update of p`,
    [ctx.organizationId, ids],
  );
  if (rows.length !== ids.length || rows.some((r) => !canAccessVenture(ctx, String(r.venture_id)))) throw notFound("Plot");
  return rows;
}

async function insertStatusHistory(q: Queryable, ctx: AuthContext, rows: { id: string; from: string }[], to: string, reason: string) {
  if (!rows.length) return;
  await q.query(
    `insert into plot_status_history (organization_id, plot_id, from_status, to_status, reason, actor_user_id)
     select $1, x.id, x.from_status, $4, $5, $6 from unnest($2::uuid[], $3::text[]) as x(id, from_status)`,
    [ctx.organizationId, rows.map((r) => r.id), rows.map((r) => r.from), to, reason, ctx.user.id],
  );
}

/** Blocks available plots. Refused for any plot with an active hold, a live booking or an engine-owned status. */
export async function blockPlots(ctx: AuthContext, input: z.infer<typeof bulkBlockSchema>) {
  assertPermission(ctx, "plot.manage");
  return withTx(async (q) => {
    const rows = await lockPlots(ctx, q, input.plotIds);
    const bad = rows.filter((r) => r.status !== "available" || r.has_active_hold || r.has_live_booking);
    if (bad.length) {
      throw conflict(
        `Only available plots without an active hold or live booking can be blocked: ${bad.map((r) => `${r.plot_number} (${r.has_live_booking ? "live booking" : r.has_active_hold ? "active hold" : r.status})`).join(", ")}`,
      );
    }
    await q.query("update plots set status = 'blocked', blocked_reason = $3, version = version + 1 where organization_id = $1 and id = any($2::uuid[])",
      [ctx.organizationId, rows.map((r) => r.id), input.reason]);
    await insertStatusHistory(q, ctx, rows.map((r) => ({ id: String(r.id), from: String(r.status) })), "blocked", input.reason);
    await writeAudit(q, ctx, {
      action: "plot.blocked", entityType: "plot", entityId: rows.length === 1 ? String(rows[0].id) : null,
      summary: `Blocked plot(s) ${rows.map((r) => r.plot_number).join(", ")}: ${input.reason}`, metadata: { plot_ids: rows.map((r) => r.id) },
    });
    return { updated: rows.length };
  });
}

export async function unblockPlots(ctx: AuthContext, input: z.infer<typeof bulkBlockSchema>) {
  assertPermission(ctx, "plot.manage");
  return withTx(async (q) => {
    const rows = await lockPlots(ctx, q, input.plotIds);
    if (rows.some(r => r.is_mortgaged)) throw conflict("Release the mortgage with a document reference on the plot details page before unblocking");
    if (rows.some(r => num(r.base_price_per_sq_yard) <= 0)) throw conflict("Set a positive selling price before unblocking");
    const bad = rows.filter((r) => r.status !== "blocked" || r.has_active_hold || r.has_live_booking);
    if (bad.length) throw conflict(`Only blocked plots without an active hold or live booking can be unblocked: ${bad.map((r) => `${r.plot_number} (${r.status})`).join(", ")}`);
    await q.query("update plots set status = 'available', blocked_reason = null, version = version + 1 where organization_id = $1 and id = any($2::uuid[])",
      [ctx.organizationId, rows.map((r) => r.id)]);
    await insertStatusHistory(q, ctx, rows.map((r) => ({ id: String(r.id), from: "blocked" })), "available", input.reason);
    await writeAudit(q, ctx, {
      action: "plot.unblocked", entityType: "plot", entityId: rows.length === 1 ? String(rows[0].id) : null,
      summary: `Unblocked plot(s) ${rows.map((r) => r.plot_number).join(", ")}: ${input.reason}`, metadata: { plot_ids: rows.map((r) => r.id) },
    });
    return { updated: rows.length };
  });
}

export const bulkPriceSchema = z.object({
  plotIds: z.array(z.string().uuid()).min(1).max(1000),
  mode: z.enum(["set", "percent", "delta"]),
  value: z.coerce.number().finite(),
  reason: z.string().trim().min(3, "Reason must be at least 3 characters").max(300),
});

/**
 * Changes the list price per sq yd. Writes plot_prices history + audit. Existing
 * bookings keep their own per-plot price snapshot (booking_plots / pricing_snapshot) and are never touched.
 */
export async function updatePlotPrices(ctx: AuthContext, input: z.infer<typeof bulkPriceSchema>) {
  assertPermission(ctx, "plot.manage");
  if (input.mode === "percent" && (input.value < -90 || input.value > 1000)) throw badRequest("Percentage change must be between -90% and +1000%");
  return withTx(async (q) => {
    const rows = await lockPlots(ctx, q, input.plotIds);
    const changes = rows
      .map((r) => {
        const from = num(r.base_price_per_sq_yard);
        const raw = input.mode === "set" ? input.value : input.mode === "percent" ? from * (1 + input.value / 100) : from + input.value;
        return { id: String(r.id), plotNumber: String(r.plot_number), from, to: Math.round(raw * 100) / 100 };
      })
      .filter((c) => c.to !== c.from);
    const negative = changes.filter((c) => c.to < 0);
    if (negative.length) throw badRequest(`Price would become negative for plot(s) ${negative.map((c) => c.plotNumber).join(", ")}`);
    for (const c of changes) {
      await q.query("update plots set base_price_per_sq_yard = $3, version = version + 1 where organization_id = $1 and id = $2", [ctx.organizationId, c.id, c.to]);
    }
    if (changes.length) {
      await q.query(
        `insert into plot_prices (organization_id, plot_id, price_per_sq_yard, reason, created_by)
         select $1, x.id, x.price, $4, $5 from unnest($2::uuid[], $3::numeric[]) as x(id, price)`,
        [ctx.organizationId, changes.map((c) => c.id), changes.map((c) => c.to), input.reason, ctx.user.id],
      );
      await writeAudit(q, ctx, {
        action: "plot.price_changed", entityType: "plot", entityId: changes.length === 1 ? changes[0].id : null,
        summary: `Price ${input.mode} ${input.value} on ${changes.length} plot(s): ${input.reason}`,
        before: changes.map((c) => ({ plot_id: c.id, plot_number: c.plotNumber, price_per_sq_yard: c.from })),
        after: changes.map((c) => ({ plot_id: c.id, plot_number: c.plotNumber, price_per_sq_yard: c.to })),
      });
    }
    return { updated: changes.length, unchanged: rows.length - changes.length };
  });
}

// ---------------------------------------------------------------------------
// CSV export / import
// ---------------------------------------------------------------------------
export const PLOT_CSV_HEADERS = ["plot_number", "phase", "area_sq_yards", "length_ft", "width_ft", "facing", "road_width_ft", "is_corner", "base_price_per_sq_yard", "property_type", "north_ft", "south_ft", "east_ft", "west_ft", "is_mortgaged", "mortgage_reference"] as const;
const EXPORT_HEADERS = ["venture_code", ...PLOT_CSV_HEADERS, "total_base_price", "status", "blocked_reason", "dimensions", "mesh_id"];

export async function exportPlotsCsv(ctx: AuthContext, filters: Partial<PlotFilters> = {}): Promise<{ csv: string; fileName: string; count: number }> {
  assertInventoryViewer(ctx);
  const f = plotFilterSchema.parse({ ...filters, page: 1, pageSize: 200 });
  const q = await db();
  const { rows } = await queryPlots(ctx, q, f, 20000, 0);
  const csv = toCsv(EXPORT_HEADERS, rows.map((r) => ({
    is_mortgaged: r.is_mortgaged ? "yes" : "no", mortgage_reference: r.mortgage_reference,
    venture_code: r.venture_code, plot_number: r.plot_number, phase: r.phase_code, area_sq_yards: r.area_sq_yards, length_ft: r.length_ft,
    north_ft:r.north_ft, south_ft:r.south_ft, east_ft:r.east_ft, west_ft:r.west_ft,
    width_ft: r.width_ft, facing: r.facing, road_width_ft: r.road_width_ft, is_corner: r.is_corner ? "yes" : "no",
    base_price_per_sq_yard: r.base_price_per_sq_yard, total_base_price: r.total_base_price, status: r.status, blocked_reason: r.blocked_reason,
    dimensions: r.dimensions_text, mesh_id: r.mesh_id, property_type: r.property_type ?? "",
  })));
  const venture = f.ventureId ? rows[0]?.venture_code ?? "venture" : "all-ventures";
  const fileName = `plots-${venture}-${new Date().toISOString().slice(0, 10)}.csv`.replace(/[^A-Za-z0-9._-]/g, "_");
  return { csv, fileName, count: rows.length };
}

export const csvImportSchema = z.object({
  ventureId: z.string().uuid(),
  csv: z.string().min(1).max(5_000_000),
});

const FACING_ALIASES: Record<string, string> = {
  NORTH: "N", SOUTH: "S", EAST: "E", WEST: "W", "NORTH-EAST": "NE", NORTHEAST: "NE", "NORTH EAST": "NE", "NORTH-WEST": "NW", NORTHWEST: "NW",
  "NORTH WEST": "NW", "SOUTH-EAST": "SE", SOUTHEAST: "SE", "SOUTH EAST": "SE", "SOUTH-WEST": "SW", SOUTHWEST: "SW", "SOUTH WEST": "SW",
};

interface ParsedCsvPlot {
  isMortgaged?: boolean;
  mortgageReference?: string;
  plotNumber: string;
  phase?: string | null;
  areaSqYards?: number;
  lengthFt?: number | null;
  widthFt?: number | null;
  northFt?: number | null; southFt?: number | null; eastFt?: number | null; westFt?: number | null;
  facing?: string | null;
  roadWidthFt?: number | null;
  isCorner?: boolean;
  basePricePerSqYard?: number;
  /** null = clear back to the venture's property type. */
  propertyType?: PropertyType | null;
}

export interface CsvImportRow {
  line: number;
  plotNumber: string;
  action: "create" | "update" | "unchanged" | "error";
  plotId: string | null;
  currentStatus: string | null;
  errors: string[];
  warnings: string[];
  changes: Record<string, { from: unknown; to: unknown }>;
  data: ParsedCsvPlot;
}

export interface CsvImportPreview {
  headers: string[];
  headerErrors: string[];
  rows: CsvImportRow[];
  newPhases: string[];
  summary: { total: number; create: number; update: number; unchanged: number; error: number };
}

function parseNumberCell(raw: string): number | null | "invalid" {
  const s = raw.replace(/[₹,\s]/g, "").replace(/^rs\.?/i, "");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : "invalid";
}

function parseBoolCell(raw: string): boolean | null | "invalid" {
  const s = raw.trim().toLowerCase();
  if (s === "") return null;
  if (["yes", "y", "true", "1"].includes(s)) return true;
  if (["no", "n", "false", "0"].includes(s)) return false;
  return "invalid";
}

async function buildCsvPreview(ctx: AuthContext, q: Queryable, ventureId: string, csvText: string, lock: boolean): Promise<CsvImportPreview> {
  const { headers, rows } = parseCsv(csvText);
  const headerErrors: string[] = [];
  const known = new Set<string>(PLOT_CSV_HEADERS);
  if (!headers.includes("plot_number")) headerErrors.push("Missing required column: plot_number");
  const unknown = headers.filter((h) => h && !known.has(h) && !EXPORT_HEADERS.includes(h));
  if (unknown.length) headerErrors.push(`Unknown column(s) ignored: ${unknown.join(", ")}`);
  if (rows.length > 5000) headerErrors.push("A single import may contain at most 5000 rows");
  const fatalHeader = !headers.includes("plot_number") || rows.length > 5000;
  const has = (h: string) => headers.includes(h);

  const existing = await q.query<Record<string, unknown>>(
    `select p.id, p.plot_number, p.status, p.area_sq_yards, p.length_ft, p.width_ft, p.north_ft, p.south_ft, p.east_ft, p.west_ft, p.facing, p.road_width_ft, p.is_corner,
            p.base_price_per_sq_yard, p.property_type, p.is_mortgaged, p.mortgage_reference, ph.code as phase_code
       from plots p left join venture_phases ph on ph.id = p.phase_id
      where p.organization_id = $1 and p.venture_id = $2${lock ? " for update of p" : ""}`,
    [ctx.organizationId, ventureId],
  );
  const byNumber = new Map(existing.map((e) => [String(e.plot_number).toUpperCase(), e]));
  const phases = await q.query<{ code: string }>("select code from venture_phases where organization_id = $1 and venture_id = $2", [ctx.organizationId, ventureId]);
  const phaseCodes = new Set(phases.map((p) => p.code.toUpperCase()));
  const newPhases = new Set<string>();
  const seen = new Map<string, number>();

  const out: CsvImportRow[] = fatalHeader ? [] : rows.map((r, i) => {
    const line = i + 2;
    const errors: string[] = [];
    const warnings: string[] = [];
    const plotNumber = (r.plot_number ?? "").trim();
    const data: ParsedCsvPlot = { plotNumber };
    if (!plotNumber) errors.push("plot_number is required");
    else if (plotNumber.length > 32) errors.push("plot_number is longer than 32 characters");
    else if (/^[=+\-@]/.test(plotNumber)) errors.push("plot_number may not start with = + - @");
    const dupLine = seen.get(plotNumber.toUpperCase());
    if (plotNumber && dupLine) errors.push(`Duplicate of line ${dupLine}`);
    if (plotNumber) seen.set(plotNumber.toUpperCase(), line);

    const numField = (h: string, key: keyof ParsedCsvPlot, opts: { positive?: boolean; min0?: boolean }) => {
      if (!has(h)) return;
      const v = parseNumberCell(r[h] ?? "");
      if (v === "invalid") errors.push(`${h} is not a number`);
      else if (v === null) return;
      else if (opts.positive && v <= 0) errors.push(`${h} must be greater than 0`);
      else if (opts.min0 && v < 0) errors.push(`${h} cannot be negative`);
      else (data as unknown as Record<string, unknown>)[key] = Math.round(v * 100) / 100;
    };
    numField("area_sq_yards", "areaSqYards", { positive: true });
    numField("length_ft", "lengthFt", { positive: true });
    numField("width_ft", "widthFt", { positive: true });
    numField("north_ft", "northFt", {positive:true}); numField("south_ft", "southFt", {positive:true}); numField("east_ft", "eastFt", {positive:true}); numField("west_ft", "westFt", {positive:true});
    numField("road_width_ft", "roadWidthFt", { positive: true });
    numField("base_price_per_sq_yard", "basePricePerSqYard", { min0: true });
    if (has("facing") && (r.facing ?? "").trim()) {
      const f = r.facing.trim().toUpperCase();
      const v = (FACINGS as readonly string[]).includes(f) ? f : FACING_ALIASES[f];
      if (!v) errors.push(`facing "${r.facing}" must be one of ${FACINGS.join(", ")}`);
      else data.facing = v;
    }
    if (has("is_corner")) {
      const b = parseBoolCell(r.is_corner ?? "");
      if (b === "invalid") errors.push("is_corner must be yes/no");
      else if (b !== null) data.isCorner = b;
    }
    if (has("phase") && (r.phase ?? "").trim()) {
      const code = r.phase.trim().toUpperCase();
      if (!/^[A-Z0-9][A-Z0-9 _-]{0,31}$/.test(code)) errors.push("phase code may use letters, digits, space, - and _ (max 32)");
      else {
        data.phase = code;
        if (!phaseCodes.has(code)) newPhases.add(code);
      }
    }

    if (has("property_type") && (r.property_type ?? "").trim()) {
      const t = r.property_type.trim().toLowerCase().replace(/[\s-]+/g, "_");
      if (t === "inherit" || t === "venture" || t === "venture_default") data.propertyType = null;
      else if ((PLOT_PROPERTY_TYPE_IDS as readonly string[]).includes(t)) data.propertyType = t as PropertyType;
      else errors.push(`property_type "${r.property_type}" must be one of ${PLOT_PROPERTY_TYPE_IDS.join(", ")} or "inherit"`);
    }

    if (has("is_mortgaged")) {
      const b=parseBoolCell(r.is_mortgaged ?? "");
      if(b === "invalid") errors.push("is_mortgaged must be yes/no");
      else if(b !== null) data.isMortgaged=b;
    }
    if((r.mortgage_reference ?? "").trim()) {
      data.mortgageReference=r.mortgage_reference.trim();
      if(data.mortgageReference.length>300) errors.push("Mortgage reference must be at most 300 characters");
    }
    const cur = plotNumber ? byNumber.get(plotNumber.toUpperCase()) : undefined;
    if(data.isMortgaged) warnings.push("Mortgage plot: will remain blocked and cannot be booked");
    const changes: CsvImportRow["changes"] = {};
    if (!cur) {
      if (data.areaSqYards === undefined) errors.push("area_sq_yards is required for a new plot");
      if (data.basePricePerSqYard === undefined) errors.push("base_price_per_sq_yard is required for a new plot");
    } else {
      const cmp = (field: string, from: unknown, to: unknown) => {
        if (to === undefined) return;
        const a = typeof from === "string" && typeof to === "number" ? num(from) : from;
        if ((a ?? null) !== (to ?? null)) changes[field] = { from: a ?? null, to };
      };
      if(cur.is_mortgaged && data.isMortgaged === false) errors.push("CSV cannot release a mortgage. Use plot details with a release reference and reason.");
      if(data.isMortgaged && !cur.is_mortgaged && ENGINE_STATUSES.includes(String(cur.status))) errors.push("Cannot mortgage a plot with a hold or booking");
      cmp("is_mortgaged",Boolean(cur.is_mortgaged),data.isMortgaged);
      cmp("mortgage_reference",cur.mortgage_reference,data.mortgageReference);
      cmp("area_sq_yards", cur.area_sq_yards, data.areaSqYards);
      cmp("length_ft", numOrNull(cur.length_ft), data.lengthFt);
      cmp("width_ft", numOrNull(cur.width_ft), data.widthFt);
      cmp("north_ft", numOrNull(cur.north_ft), data.northFt); cmp("south_ft", numOrNull(cur.south_ft), data.southFt); cmp("east_ft", numOrNull(cur.east_ft), data.eastFt); cmp("west_ft", numOrNull(cur.west_ft), data.westFt);
      cmp("road_width_ft", numOrNull(cur.road_width_ft), data.roadWidthFt);
      cmp("base_price_per_sq_yard", num(cur.base_price_per_sq_yard), data.basePricePerSqYard);
      cmp("facing", cur.facing, data.facing);
      cmp("is_corner", Boolean(cur.is_corner), data.isCorner);
      cmp("phase", cur.phase_code ? String(cur.phase_code).toUpperCase() : null, data.phase);
      cmp("property_type", (cur.property_type as string) ?? null, data.propertyType);
      if (ENGINE_STATUSES.includes(String(cur.status)) && Object.keys(changes).length) {
        warnings.push(`Plot is ${cur.status}: its status is preserved and existing booking/hold pricing snapshots are not affected`);
      }
    }
    const action: CsvImportRow["action"] = errors.length ? "error" : !cur ? "create" : Object.keys(changes).length ? "update" : "unchanged";
    return {
      line, plotNumber, action, plotId: cur ? String(cur.id) : null, currentStatus: cur ? String(cur.status) : null, errors, warnings, changes, data,
    };
  });

  const summary = { total: out.length, create: 0, update: 0, unchanged: 0, error: 0 };
  for (const r of out) summary[r.action]++;
  return { headers, headerErrors, rows: out, newPhases: [...newPhases].sort(), summary };
}

export async function previewPlotCsvImport(ctx: AuthContext, input: z.infer<typeof csvImportSchema>) {
  assertPermission(ctx, "plot.manage");
  const q = await db();
  await loadScopedVenture(ctx, q, input.ventureId);
  return buildCsvPreview(ctx, q, input.ventureId, input.csv, false);
}

/**
 * Upserts plots by (venture, plot_number). Never changes plot status (new plots
 * start as available; held/reserved/booked/sold/blocked statuses are left untouched).
 */
export async function applyPlotCsvImport(ctx: AuthContext, input: z.infer<typeof csvImportSchema>) {
  assertPermission(ctx, "plot.manage");
  return withTx(async (q) => {
    await loadScopedVenture(ctx, q, input.ventureId);
    const preview = await buildCsvPreview(ctx, q, input.ventureId, input.csv, true);
    if (preview.headerErrors.some((e) => !e.startsWith("Unknown column"))) throw unprocessable(preview.headerErrors.join("; "));
    const errors = preview.rows.filter((r) => r.action === "error");
    if (errors.length) throw unprocessable(`${errors.length} row(s) have errors — fix them and preview again`, errors.slice(0, 50).map((r) => ({ line: r.line, errors: r.errors })));

    const phaseIds = new Map<string, string>();
    const existingPhases = await q.query<{ id: string; code: string }>("select id, code from venture_phases where organization_id = $1 and venture_id = $2", [ctx.organizationId, input.ventureId]);
    for (const p of existingPhases) phaseIds.set(p.code.toUpperCase(), p.id);
    let order = existingPhases.length;
    for (const code of preview.newPhases) {
      const [ph] = await q.query<{ id: string }>(
        "insert into venture_phases (organization_id, venture_id, name, code, sort_order) values ($1,$2,$3,$4,$5) returning id",
        [ctx.organizationId, input.ventureId, `Phase ${code}`, code, order++],
      );
      phaseIds.set(code, ph.id);
    }

    let created = 0;
    let updated = 0;
    for (const r of preview.rows) {
      const d = r.data;
      if (r.action === "create") {
        const dims = d.widthFt && d.lengthFt ? `${d.widthFt} ft × ${d.lengthFt} ft` : null;
        const [row] = await q.query<{ id: string }>(
          `insert into plots (organization_id, venture_id, phase_id, plot_number, area_sq_yards, length_ft, width_ft, dimensions_text, facing, road_width_ft, is_corner, base_price_per_sq_yard, property_type, is_mortgaged, mortgage_reference, status, blocked_reason)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) returning id`,
          [ctx.organizationId, input.ventureId, d.phase ? phaseIds.get(d.phase) ?? null : null, d.plotNumber, d.areaSqYards, d.lengthFt ?? null, d.widthFt ?? null, dims,
            d.facing ?? null, d.roadWidthFt ?? null, d.isCorner ?? false, d.basePricePerSqYard, d.propertyType ?? null, d.isMortgaged ?? false, d.mortgageReference ?? null, d.isMortgaged ? "blocked" : "available", d.isMortgaged ? "Mortgage marked in inventory import" : null],
        );
        await q.query("update plots set north_ft=$2,south_ft=$3,east_ft=$4,west_ft=$5 where id=$1",[row.id,d.northFt??null,d.southFt??null,d.eastFt??null,d.westFt??null]);
        await q.query("insert into plot_prices (organization_id, plot_id, price_per_sq_yard, reason, created_by) values ($1,$2,$3,'CSV import (new plot)',$4)",
          [ctx.organizationId, row.id, d.basePricePerSqYard, ctx.user.id]);
        await q.query("insert into plot_status_history (organization_id, plot_id, from_status, to_status, reason, actor_user_id) values ($1,$2,null,$4,'Created by CSV import',$3)",
          [ctx.organizationId, row.id, ctx.user.id, d.isMortgaged ? "blocked" : "available"]);
        created++;
      } else if (r.action === "update" && r.plotId) {
        const c = r.changes;
        const sets: string[] = [];
        const params: unknown[] = [ctx.organizationId, r.plotId];
        const set = (col: string, v: unknown) => {
          params.push(v);
          sets.push(`${col} = $${params.length}`);
        };
        if (c.area_sq_yards) set("area_sq_yards", d.areaSqYards);
        if (c.length_ft) set("length_ft", d.lengthFt);
        if (c.width_ft) set("width_ft", d.widthFt);
        if(c.north_ft)set("north_ft",d.northFt); if(c.south_ft)set("south_ft",d.southFt); if(c.east_ft)set("east_ft",d.eastFt); if(c.west_ft)set("west_ft",d.westFt);
        if (c.road_width_ft) set("road_width_ft", d.roadWidthFt);
        if (c.facing) set("facing", d.facing);
        if (c.is_corner) set("is_corner", d.isCorner);
        if (c.phase) set("phase_id", d.phase ? phaseIds.get(d.phase) ?? null : null);
        if (c.base_price_per_sq_yard) set("base_price_per_sq_yard", d.basePricePerSqYard);
        if (c.property_type) set("property_type", d.propertyType ?? null);
        if ((c.length_ft || c.width_ft) && (d.widthFt || d.lengthFt)) {
          params.push(d.widthFt ?? null, d.lengthFt ?? null);
          sets.push(`dimensions_text = trim_scale(coalesce($${params.length - 1}::numeric, width_ft))::text || ' ft × ' || trim_scale(coalesce($${params.length}::numeric, length_ft))::text || ' ft'`);
        }
        if(c.mortgage_reference) set("mortgage_reference",d.mortgageReference);
        if(c.is_mortgaged && d.isMortgaged) {
          set("is_mortgaged",true); set("status","blocked"); set("blocked_reason","Mortgage marked in inventory import");
          await insertStatusHistory(q,ctx,[{id:r.plotId,from:r.currentStatus!}],"blocked","Mortgage marked in inventory import");
        }
        // Engine-owned statuses cannot be changed by CSV.
        await q.query(`update plots set ${sets.join(", ")}, version = version + 1 where organization_id = $1 and id = $2`, params);
        if (c.base_price_per_sq_yard) {
          await q.query("insert into plot_prices (organization_id, plot_id, price_per_sq_yard, reason, created_by) values ($1,$2,$3,'CSV import',$4)",
            [ctx.organizationId, r.plotId, d.basePricePerSqYard, ctx.user.id]);
        }
        updated++;
      }
    }
    await writeAudit(q, ctx, {
      action: "plot.csv_imported", entityType: "venture", entityId: input.ventureId,
      summary: `CSV import: ${created} created, ${updated} updated, ${preview.summary.unchanged} unchanged`,
      metadata: {
        created, updated, unchanged: preview.summary.unchanged, new_phases: preview.newPhases,
        changes: preview.rows.filter((r) => r.action === "update").slice(0, 500).map((r) => ({ plot_number: r.plotNumber, changes: r.changes })),
      },
    });
    return { created, updated, unchanged: preview.summary.unchanged, newPhases: preview.newPhases };
  });
}

// ---------------------------------------------------------------------------
// 3D mesh mapping (GLB node names ↔ plot_geometry.mesh_id)
// ---------------------------------------------------------------------------
export async function getMeshMapping(ctx: AuthContext, ventureId: string) {
  assertInventoryViewer(ctx);
  const q = await db();
  const v = await loadScopedVenture(ctx, q, ventureId);
  const plots = await q.query<Record<string, unknown>>(
    `select p.id, p.plot_number, p.status, g.mesh_id, g.source, g.polygon is not null as has_polygon
       from plots p left join plot_geometry g on g.plot_id = p.id
      where p.organization_id = $1 and p.venture_id = $2`,
    [ctx.organizationId, ventureId],
  );
  const rows = plots
    .map((p) => ({ plotId: String(p.id), plotNumber: String(p.plot_number), status: String(p.status), meshId: (p.mesh_id as string) ?? null, source: (p.source as string) ?? null, hasPolygon: Boolean(p.has_polygon), suggested: meshIdForPlot(String(p.plot_number)) }))
    .sort((a, b) => naturalCompare(a.plotNumber, b.plotNumber));
  return {
    venture: { id: v.id, name: v.name, viewerMode: v.viewer_mode, modelAssetId: v.model_asset_id },
    modelUrl: v.model_asset_id ? `/api/ventures/${v.id}/assets/${v.model_asset_id}` : null,
    plots: rows,
  };
}

const MESH_ID_RE = /^[^\u0000-\u001f\u007f]{1,128}$/;
export const meshMappingSchema = z.object({
  items: z.array(z.object({ plotId: z.string().uuid(), meshId: z.string().trim().min(1).max(128).regex(MESH_ID_RE, "Invalid mesh name") })).min(1).max(5000),
});

async function applyMeshIds(ctx: AuthContext, q: Queryable, ventureId: string, items: { plotId: string; meshId: string }[]) {
  const dupes = new Map<string, number>();
  for (const i of items) dupes.set(i.meshId, (dupes.get(i.meshId) ?? 0) + 1);
  const repeated = [...dupes].filter(([, n]) => n > 1).map(([m]) => m);
  if (repeated.length) throw conflict(`Mesh names must be unique per venture: ${repeated.slice(0, 10).join(", ")}`);
  const plots = await q.query<{ id: string; plot_number: string; mesh_id: string | null; geometry_id: string | null }>(
    `select p.id, p.plot_number, g.mesh_id, g.id as geometry_id from plots p left join plot_geometry g on g.plot_id = p.id
      where p.organization_id = $1 and p.venture_id = $2 for update of p`,
    [ctx.organizationId, ventureId],
  );
  const byId = new Map(plots.map((p) => [p.id, p]));
  if (items.some((i) => !byId.has(i.plotId))) throw notFound("Plot");
  const touched = new Set(items.map((i) => i.plotId));
  const taken = new Map(plots.filter((p) => p.mesh_id && !touched.has(p.id)).map((p) => [p.mesh_id!, p.plot_number]));
  const clash = items.filter((i) => taken.has(i.meshId));
  if (clash.length) throw conflict(`Mesh name(s) already used by other plots: ${clash.slice(0, 10).map((c) => `${c.meshId} (plot ${taken.get(c.meshId)})`).join(", ")}`);
  const changed = items.filter((i) => byId.get(i.plotId)!.mesh_id !== i.meshId);
  if (!changed.length) return { updated: 0 };
  // Two-phase rename so swaps (A↔B) never trip the (venture_id, mesh_id) unique constraint mid-way.
  const existingIds = changed.filter((c) => byId.get(c.plotId)!.geometry_id).map((c) => c.plotId);
  if (existingIds.length) {
    await q.query("update plot_geometry set mesh_id = '__tmp__' || id::text where organization_id = $1 and plot_id = any($2::uuid[])", [ctx.organizationId, existingIds]);
  }
  for (const c of changed) {
    if (byId.get(c.plotId)!.geometry_id) {
      await q.query("update plot_geometry set mesh_id = $3 where organization_id = $1 and plot_id = $2", [ctx.organizationId, c.plotId, c.meshId]);
    } else {
      await q.query("insert into plot_geometry (organization_id, venture_id, plot_id, mesh_id, source) values ($1,$2,$3,$4,'manual')", [ctx.organizationId, ventureId, c.plotId, c.meshId]);
    }
  }
  await writeAudit(q, ctx, {
    action: "plot.mesh_mapping_updated", entityType: "venture", entityId: ventureId, summary: `Updated 3D mesh mapping for ${changed.length} plot(s)`,
    before: changed.map((c) => ({ plot_number: byId.get(c.plotId)!.plot_number, mesh_id: byId.get(c.plotId)!.mesh_id })),
    after: changed.map((c) => ({ plot_number: byId.get(c.plotId)!.plot_number, mesh_id: c.meshId })),
  });
  return { updated: changed.length };
}

export async function updateMeshMapping(ctx: AuthContext, ventureId: string, input: z.infer<typeof meshMappingSchema>) {
  assertPermission(ctx, "plot.manage");
  return withTx(async (q) => {
    await loadScopedVenture(ctx, q, ventureId);
    return applyMeshIds(ctx, q, ventureId, input.items);
  });
}

/** Sets every plot's mesh_id to the PLOT_<number> convention (PLOT_001 …). */
export async function autoMapMeshIds(ctx: AuthContext, ventureId: string, opts: { overwrite: boolean }) {
  assertPermission(ctx, "plot.manage");
  return withTx(async (q) => {
    await loadScopedVenture(ctx, q, ventureId);
    const plots = await q.query<{ id: string; plot_number: string; mesh_id: string | null }>(
      "select p.id, p.plot_number, g.mesh_id from plots p left join plot_geometry g on g.plot_id = p.id where p.organization_id = $1 and p.venture_id = $2",
      [ctx.organizationId, ventureId],
    );
    const items = plots.filter((p) => opts.overwrite || !p.mesh_id).map((p) => ({ plotId: p.id, meshId: meshIdForPlot(p.plot_number) }));
    if (!items.length) return { updated: 0 };
    return applyMeshIds(ctx, q, ventureId, items);
  });
}

// ---------------------------------------------------------------------------
// DXF geometry import
// ---------------------------------------------------------------------------
export const dxfSourceSchema = z.object({ assetId: z.string().uuid() });
export const dxfApplySchema = dxfSourceSchema.extend({
  acceptDeviations: z.boolean().default(false),
  importFeatures: z.boolean().default(false),
  replaceFeatures: z.boolean().default(true),
  normalizeOrigin: z.boolean().default(true),
});

type DxfSource = { assetId: string } | { text: string };

async function dxfPreviewInternal(ctx: AuthContext, q: Queryable, ventureId: string, source: DxfSource): Promise<ImportPreview> {
  await loadScopedVenture(ctx, q, ventureId);
  const text = "text" in source ? source.text : (await readDxfAssetText(ctx, q, ventureId, source.assetId)).text;
  let parsed;
  try {
    parsed = parseDxf(text);
  } catch (e) {
    if (e instanceof DxfParseError) throw badRequest(e.message);
    throw e;
  }
  const plots = await q.query<{ id: string; plot_number: string; area_sq_yards: string; mesh_id: string | null }>(
    "select p.id, p.plot_number, p.area_sq_yards, g.mesh_id from plots p left join plot_geometry g on g.plot_id = p.id where p.organization_id = $1 and p.venture_id = $2",
    [ctx.organizationId, ventureId],
  );
  return buildImportPreview(parsed, plots.map((p) => ({ id: p.id, plotNumber: p.plot_number, areaSqYards: num(p.area_sq_yards), meshId: p.mesh_id })), { deviationThreshold: AREA_DEVIATION_THRESHOLD });
}

export async function previewDxfImport(ctx: AuthContext, ventureId: string, source: DxfSource) {
  assertPermission(ctx, "plot.manage");
  const q = await db();
  return dxfPreviewInternal(ctx, q, ventureId, source);
}

/**
 * Writes plot_geometry (source 'dxf') for every applicable outline, recomputed
 * server-side from the stored DXF. Imported geometry must be checked against the
 * approved survey drawings — this tool does not establish legal boundaries.
 */
export async function applyDxfGeometry(
  ctx: AuthContext,
  ventureId: string,
  input: DxfSource & { acceptDeviations?: boolean; importFeatures?: boolean; replaceFeatures?: boolean; normalizeOrigin?: boolean },
) {
  assertPermission(ctx, "plot.manage");
  return withTx(async (q) => {
    const preview = await dxfPreviewInternal(ctx, q, ventureId, input);
    const apply = preview.polygons.filter((p) => p.applicable);
    if (!apply.length) throw unprocessable("No outline could be matched to a plot without conflicts — nothing to apply");
    const deviating = apply.filter((p) => p.deviationFlag);
    if (deviating.length && !input.acceptDeviations) {
      throw unprocessable(
        `${deviating.length} plot(s) deviate more than ${AREA_DEVIATION_THRESHOLD * 100}% from the recorded area (${deviating.slice(0, 10).map((d) => d.plotNumber).join(", ")}). Review and confirm to apply anyway.`,
        deviating.map((d) => ({ plot_number: d.plotNumber, dxf_sq_yd: d.areaSqYards, recorded_sq_yd: d.recordedAreaSqYards, deviation_pct: d.deviationPct })),
      );
    }
    const features = input.importFeatures ? preview.features : [];
    let ox = 0;
    let oy = 0;
    if (input.normalizeOrigin ?? true) {
      const b = bbox([...apply.flatMap((p) => p.points), ...features.flatMap((f) => f.points)]);
      ox = b.minX;
      oy = b.minY;
    }
    const shift = (pts: Pt[]) => pts.map(([x, y]) => [round3(x - ox), round3(y - oy)] as Pt);
    const existingMeshes = await q.query<{ plot_id: string; mesh_id: string }>("select plot_id, mesh_id from plot_geometry where organization_id = $1 and venture_id = $2", [ctx.organizationId, ventureId]);
    const usedMesh = new Map(existingMeshes.map((m) => [m.mesh_id, m.plot_id]));
    for (const p of apply) {
      let mesh = meshIdForPlot(p.plotNumber!);
      const owner = usedMesh.get(mesh);
      if (owner && owner !== p.plotId) mesh = `${mesh}_${p.plotId!.slice(0, 8)}`; // existing row keeps its own mesh id below anyway
      await q.query(
        `insert into plot_geometry (organization_id, venture_id, plot_id, mesh_id, polygon, centroid_x, centroid_y, source)
         values ($1,$2,$3,$4,$5::jsonb,$6,$7,'dxf')
         on conflict (plot_id) do update set polygon = excluded.polygon, centroid_x = excluded.centroid_x, centroid_y = excluded.centroid_y, source = 'dxf'`,
        [ctx.organizationId, ventureId, p.plotId, mesh, JSON.stringify(shift(p.points)), round3(p.centroid[0] - ox), round3(p.centroid[1] - oy)],
      );
    }
    if (input.importFeatures && features.length) {
      if (input.replaceFeatures ?? true) await q.query("delete from venture_features where organization_id = $1 and venture_id = $2", [ctx.organizationId, ventureId]);
      for (const f of features) {
        await q.query(
          "insert into venture_features (organization_id, venture_id, kind, name, polygon, properties) values ($1,$2,$3,$4,$5::jsonb,$6::jsonb)",
          [ctx.organizationId, ventureId, f.kind, f.name ?? f.layer, JSON.stringify(shift(f.points)), JSON.stringify({ source: "dxf", layer: f.layer })],
        );
      }
    }
    await writeAudit(q, ctx, {
      action: "plot.geometry_imported", entityType: "venture", entityId: ventureId,
      summary: `Applied DXF geometry to ${apply.length} plot(s)${features.length ? ` and ${features.length} feature(s)` : ""} — must be verified against approved survey drawings`,
      metadata: {
        asset_id: "assetId" in input ? input.assetId : null, units: preview.unitName, match_mode: preview.matchMode, origin_offset_m: [ox, oy],
        applied_plots: apply.map((p) => p.plotNumber), skipped: preview.polygons.filter((p) => !p.applicable).length,
        unmatched_plots: preview.unmatchedPlots.map((p) => p.plotNumber),
        deviations: deviating.map((d) => ({ plot_number: d.plotNumber, dxf_sq_yd: d.areaSqYards, recorded_sq_yd: d.recordedAreaSqYards, deviation_pct: d.deviationPct })),
      },
    });
    return { applied: apply.length, features: features.length, deviationsAccepted: deviating.length, unmatchedPlots: preview.unmatchedPlots.length };
  });
}

export function isEngineStatus(status: string) {
  return ENGINE_STATUSES.includes(status);
}
