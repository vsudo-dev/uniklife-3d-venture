import "server-only";
import { num } from "@/lib/db/types";
import type { AuthContext } from "@/lib/auth/context";
import { assertPermission } from "@/lib/auth/context";
import { getDb } from "@/lib/db";

/**
 * Top ventures and plots for the sales dashboard, using the SAME scope rules as
 * salesMetrics (venture assignment + network for non-org-wide roles).
 * TODO(shared): move into src/lib/services/dashboard.ts (owned by another workstream).
 */
export async function salesLeaders(ctx: AuthContext, opts: { ventureId?: string } = {}) {
  assertPermission(ctx, "dashboard.view");
  const q = await getDb();
  const params: unknown[] = [ctx.organizationId];
  const where = ["b.organization_id = $1", "b.status in ('confirmed','completed')"];
  if (ctx.ventureIds !== null) {
    params.push(ctx.ventureIds);
    where.push(`b.venture_id = any($${params.length}::uuid[])`);
  }
  if (ctx.networkEmployeeIds !== null) {
    params.push(ctx.networkEmployeeIds, ctx.user.id);
    where.push(`(b.credited_employee_id = any($${params.length - 1}::uuid[]) or b.requested_by = $${params.length})`);
  }
  if (opts.ventureId) {
    params.push(opts.ventureId);
    where.push(`b.venture_id = $${params.length}`);
  }
  const w = where.join(" and ");
  const ventures = await q.query<{ venture_id: string; venture_name: string; bookings: number; plots: number; area: string; value: string; discounts: string }>(
    `select b.venture_id, v.name as venture_name, count(distinct b.id)::int as bookings, coalesce(sum(b.plot_count),0)::int as plots,
            coalesce(sum(b.total_area_sq_yards),0) as area, coalesce(sum(b.net_amount),0) as value, coalesce(sum(b.discount_amount),0) as discounts
       from bookings b join ventures v on v.id = b.venture_id
      where ${w} group by b.venture_id, v.name order by sum(b.net_amount) desc limit 10`,
    params,
  );
  const plots = await q.query<{ plot_id: string; plot_number: string; venture_name: string; area_sq_yards: string; net_amount: string; booking_id: string; booking_number: string; status: string }>(
    `select bp.plot_id, bp.plot_number, v.name as venture_name, bp.area_sq_yards, bp.net_amount, b.id as booking_id, b.booking_number, b.status
       from booking_plots bp join bookings b on b.id = bp.booking_id join ventures v on v.id = b.venture_id
      where ${w} order by bp.net_amount desc limit 10`,
    params,
  );
  return {
    ventures: ventures.map((r) => ({ ...r, area: num(r.area), value: num(r.value), discounts: num(r.discounts) })),
    plots: plots.map((r) => ({ ...r, area_sq_yards: num(r.area_sq_yards), net_amount: num(r.net_amount) })),
  };
}
