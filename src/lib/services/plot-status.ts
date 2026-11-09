import type { AuthContext } from "@/lib/auth/context";
import { assertPermission, canAccessVenture } from "@/lib/auth/context";
import { notFound } from "@/lib/errors";
import { db, withTx } from "./common";
import { expireStale } from "./bookings";

export interface PlotStatusRow {
  id: string;
  status: string;
  version: number;
}

/** Verifies the caller may view this venture (same rules as the viewer). */
export async function assertVentureViewable(ctx: AuthContext, ventureId: string) {
  const q = await db();
  const [v] = await q.query<{ id: string; is_published: boolean }>(
    "select id, is_published from ventures where organization_id = $1 and id = $2",
    [ctx.organizationId, ventureId],
  );
  if (!v) throw notFound("Venture");
  if (ctx.role === "customer" ? !v.is_published : !canAccessVenture(ctx, ventureId)) throw notFound("Venture");
  if (ctx.role !== "customer") assertPermission(ctx, "venture.view");
}

/**
 * Public-safe live status snapshot: plot id, status and version ONLY — no customer,
 * employee, booking or price data ever travels on the live channel.
 */
export async function plotStatusSnapshot(ctx: AuthContext, ventureId: string): Promise<PlotStatusRow[]> {
  const q = await db();
  return q.query<PlotStatusRow>(
    "select id, status, version from plots where organization_id = $1 and venture_id = $2",
    [ctx.organizationId, ventureId],
  );
}

/** Releases expired holds / unpaid bookings for the organization so viewers see them free up promptly. */
export async function sweepExpired(orgId: string) {
  return withTx((q) => expireStale(q, orgId));
}
