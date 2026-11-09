import { num } from "@/lib/db/types";
import type { AuthContext } from "@/lib/auth/context";
import { assertPermission, assertStaff } from "@/lib/auth/context";
import { db } from "./common";
import { commissionSummary } from "./commissions";
import { unreadCount } from "./notifications";

/** Scope fragments: venture assignment + network (self/descendants) for non-org-wide roles. */
function bookingScope(ctx: AuthContext, params: unknown[], alias = "b") {
  const parts: string[] = [`${alias}.organization_id = $1`];
  if (ctx.ventureIds !== null) {
    params.push(ctx.ventureIds);
    parts.push(`${alias}.venture_id = any($${params.length}::uuid[])`);
  }
  if (ctx.networkEmployeeIds !== null) {
    params.push(ctx.networkEmployeeIds, ctx.user.id);
    parts.push(`(${alias}.credited_employee_id = any($${params.length - 1}::uuid[]) or ${alias}.requested_by = $${params.length})`);
  }
  return parts.join(" and ");
}

export async function salesMetrics(ctx: AuthContext, opts: { ventureId?: string } = {}) {
  assertPermission(ctx, "dashboard.view");
  const q = await db();

  const vParams: unknown[] = [ctx.organizationId];
  const vWhere = ["v.organization_id = $1"];
  if (ctx.ventureIds !== null) {
    vParams.push(ctx.ventureIds);
    vWhere.push(`v.id = any($${vParams.length}::uuid[])`);
  }
  if (opts.ventureId) {
    vParams.push(opts.ventureId);
    vWhere.push(`v.id = $${vParams.length}`);
  }
  const [inv] = await q.query<Record<string, number>>(
    `select count(distinct v.id)::int as ventures, count(p.id)::int as plots,
            count(p.id) filter (where p.status='available')::int as available, count(p.id) filter (where p.status='held')::int as held,
            count(p.id) filter (where p.status='reserved')::int as reserved, count(p.id) filter (where p.status='booked')::int as booked,
            count(p.id) filter (where p.status='sold')::int as sold, count(p.id) filter (where p.status='blocked')::int as blocked
       from ventures v left join plots p on p.venture_id = v.id where ${vWhere.join(" and ")}`,
    vParams,
  );

  const bParams: unknown[] = [ctx.organizationId];
  let bWhere = bookingScope(ctx, bParams);
  if (opts.ventureId) {
    bParams.push(opts.ventureId);
    bWhere += ` and b.venture_id = $${bParams.length}`;
  }
  const [bk] = await q.query<Record<string, string>>(
    `select count(*)::int as requests,
            count(*) filter (where b.status in ('confirmed','completed'))::int as confirmed,
            count(*) filter (where b.status = 'payment_pending')::int as pending,
            coalesce(sum(b.net_amount) filter (where b.status in ('confirmed','completed')),0) as gross_booking_value,
            coalesce(sum(b.discount_amount) filter (where b.status in ('confirmed','completed')),0) as discounts_granted,
            coalesce(sum(b.total_area_sq_yards) filter (where b.status in ('confirmed','completed')),0) as booked_area
       from bookings b where ${bWhere}`,
    bParams,
  );
  const [pay] = await q.query<Record<string, string>>(
    `select coalesce(sum(t.amount) filter (where t.status='verified' and not t.is_simulated),0) as verified_real,
            coalesce(sum(t.amount) filter (where t.status='verified' and t.is_simulated),0) as verified_simulated,
            coalesce(sum(t.amount) filter (where t.status='failed'),0) as failed
       from payment_transactions t join bookings b on b.id = t.booking_id where ${bWhere}`,
    bParams,
  );
  const [out] = await q.query<{ outstanding: string }>(
    `select coalesce(sum(greatest(b.net_amount - coalesce(v.verified,0), 0)),0) as outstanding
       from bookings b left join (select booking_id, sum(amount) as verified from payment_transactions where status='verified' group by booking_id) v on v.booking_id = b.id
      where ${bWhere} and b.status in ('confirmed','completed')`,
    bParams,
  );

  const eParams: unknown[] = [ctx.organizationId];
  const eWhere = ["e.organization_id = $1"];
  if (ctx.ventureIds !== null) {
    eParams.push(ctx.ventureIds);
    eWhere.push(`e.venture_id = any($${eParams.length}::uuid[])`);
  }
  if (ctx.networkEmployeeIds !== null) {
    eParams.push(ctx.networkEmployeeIds);
    eWhere.push(`(e.assigned_employee_id = any($${eParams.length}::uuid[])${ctx.role === "sales_manager" ? " or e.assigned_employee_id is null" : ""})`);
  }
  if (opts.ventureId) {
    eParams.push(opts.ventureId);
    eWhere.push(`e.venture_id = $${eParams.length}`);
  }
  const [enq] = await q.query<{ n: number }>(`select count(*)::int as n from enquiries e where ${eWhere.join(" and ")}`, eParams);

  const trend = await q.query<{ day: string; bookings: number; value: string }>(
    `select to_char(d.day, 'YYYY-MM-DD') as day, count(b.id)::int as bookings, coalesce(sum(b.net_amount),0) as value
       from generate_series((now() at time zone 'Asia/Kolkata')::date - 29, (now() at time zone 'Asia/Kolkata')::date, interval '1 day') as d(day)
       left join bookings b on (b.created_at at time zone 'Asia/Kolkata')::date = d.day::date and ${bWhere} and b.status in ('payment_pending','confirmed','completed')
      group by d.day order by d.day`,
    bParams,
  );

  const requests = num(bk.requests);
  const confirmed = num(bk.confirmed);
  return {
    scope: ctx.networkEmployeeIds === null ? "organization" : "team",
    inventory: inv,
    enquiries: enq.n,
    bookingRequests: requests,
    confirmedBookings: confirmed,
    pendingBookings: num(bk.pending),
    conversionRate: requests > 0 ? Math.round((confirmed / requests) * 1000) / 10 : 0,
    grossBookingValue: num(bk.gross_booking_value),
    discountsGranted: num(bk.discounts_granted),
    bookedArea: num(bk.booked_area),
    verifiedPaymentsReal: num(pay.verified_real),
    verifiedPaymentsSimulated: num(pay.verified_simulated),
    failedPayments: num(pay.failed),
    outstandingBalances: num(out.outstanding),
    trend: trend.map((t) => ({ day: t.day, bookings: t.bookings, value: num(t.value) })),
  };
}

/** Personal "Home" widgets for staff (mobile home dashboard). */
export async function myHome(ctx: AuthContext) {
  assertStaff(ctx);
  const q = await db();
  const emp = ctx.employee?.id ?? null;
  const [counts] = await q.query<Record<string, number>>(
    `select
       (select count(*)::int from enquiries where organization_id = $1 and assigned_employee_id = $2 and status in ('new','contacted','qualified')) as my_enquiries,
       (select count(*)::int from bookings where organization_id = $1 and (credited_employee_id = $2 or requested_by = $3) and status in ('payment_pending','confirmed','completed')) as my_bookings,
       (select count(*)::int from bookings where organization_id = $1 and (credited_employee_id = $2 or requested_by = $3) and status = 'payment_pending') as my_pending_bookings,
       (select count(*)::int from site_visits where organization_id = $1 and employee_id = $2 and status in ('requested','scheduled') and scheduled_at >= now() - interval '1 day') as my_site_visits,
       (select count(*)::int from follow_up_reminders where organization_id = $1 and recipient_user_id = $3 and status in ('pending','sent')) as my_followups`,
    [ctx.organizationId, emp, ctx.user.id],
  );
  const upcomingVisits = await q.query<Record<string, unknown>>(
    `select s.id, s.visitor_name, s.scheduled_at, s.status, v.name as venture_name from site_visits s join ventures v on v.id = s.venture_id
      where s.organization_id = $1 and s.employee_id = $2 and s.status in ('requested','scheduled') and s.scheduled_at >= now() - interval '1 day'
      order by s.scheduled_at limit 5`,
    [ctx.organizationId, emp],
  );
  const recentBookings = await q.query<Record<string, unknown>>(
    `select b.id, b.booking_number, b.status, b.net_amount, b.created_at, c.full_name as customer_name,
            array(select bp.plot_number from booking_plots bp where bp.booking_id = b.id order by bp.plot_number) as plot_numbers
       from bookings b join customers c on c.id = b.customer_id
      where b.organization_id = $1 and (b.credited_employee_id = $2 or b.requested_by = $3)
      order by b.created_at desc limit 5`,
    [ctx.organizationId, emp, ctx.user.id],
  );
  return {
    counts,
    upcomingVisits,
    recentBookings,
    commissions: await commissionSummary(ctx),
    unread: await unreadCount(ctx),
  };
}
