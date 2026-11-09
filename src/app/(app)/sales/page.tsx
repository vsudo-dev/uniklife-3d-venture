import Link from "next/link";
import { Info } from "lucide-react";
import { requirePageContext } from "@/lib/auth/server";
import { salesMetrics } from "@/lib/services/dashboard";
import { listVentures } from "@/lib/services/ventures";
import { isUuid } from "@/lib/services/common";
import { Badge, Card, CardHeader, EmptyState, PageHeader, Stat, StatusBadge } from "@/components/ui";
import { BarTrend, StatusBar } from "@/components/charts";
import { inr, num } from "@/lib/format";
import { salesLeaders } from "./leaders";

export const metadata = { title: "Sales dashboard" };

export default async function SalesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePageContext("dashboard.view");
  const sp = await searchParams;
  const ventures = await listVentures(ctx);
  const ventureId = isUuid(sp.venture) && ventures.some((v) => v.id === sp.venture) ? sp.venture : undefined;
  const [m, leaders] = await Promise.all([salesMetrics(ctx, { ventureId }), salesLeaders(ctx, { ventureId })]);
  const inv = m.inventory;
  const trendCount = m.trend.reduce((s, t) => s + t.bookings, 0);
  const trendValue = m.trend.reduce((s, t) => s + t.value, 0);

  return (
    <>
      <PageHeader
        eyebrow={<>Sales · <span className="normal-case tracking-normal">{m.scope === "organization" ? "Organization-wide" : "My team (you and your downline)"}</span></>}
        title="Sales dashboard"
        subtitle={m.scope === "organization" ? `All bookings and payments in ${ctx.organizationName}.` : "Bookings credited to you and everyone reporting to you."}
        actions={
          <form action="/sales" className="flex gap-2">
            <select name="venture" defaultValue={ventureId ?? ""} className="input py-1.5" aria-label="Filter by venture">
              <option value="">All ventures</option>
              {ventures.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
            <button type="submit" className="rounded-xl border border-border px-3 py-1.5 text-sm font-semibold hover:border-gold">Apply</button>
          </form>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <Badge tone={m.scope === "organization" ? "info" : "gold"}>Scope: {m.scope === "organization" ? "organization" : "my team"}</Badge>
        {ventureId && <Badge tone="neutral">Venture: {ventures.find((v) => v.id === ventureId)?.name}</Badge>}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Gross booking value" value={inr(m.grossBookingValue, { compact: true })} hint={`${m.confirmedBookings} confirmed/completed bookings`} accent="gold" />
        <Stat label="Verified payments — real" value={inr(m.verifiedPaymentsReal, { compact: true })} hint="Server-verified, excluding simulated" accent="primary" />
        <Stat label="Verified payments — simulated" value={inr(m.verifiedPaymentsSimulated, { compact: true })} hint="Mock provider · not money received" />
        <Stat label="Outstanding balances" value={inr(m.outstandingBalances, { compact: true })} hint="Confirmed bookings, unpaid portion" />
        <Stat label="Booking requests" value={m.bookingRequests} hint={`${m.pendingBookings} awaiting advance`} />
        <Stat label="Conversion rate" value={`${m.conversionRate}%`} hint="Confirmed ÷ booking requests" />
        <Stat label="Enquiries" value={m.enquiries} hint="In scope" />
        <Stat label="Discounts granted" value={inr(m.discountsGranted, { compact: true })} hint="On confirmed bookings" />
      </div>

      <section className="mt-5 rounded-2xl border border-[color-mix(in_srgb,var(--gold)_45%,transparent)] bg-gold-soft p-4" aria-labelledby="money-note">
        <h2 id="money-note" className="flex items-center gap-2 text-sm font-bold text-gold-strong"><Info size={16} />Reading these numbers</h2>
        <p className="mt-1 text-sm font-semibold">Gross booking value ≠ payment collections ≠ recognized revenue. Revenue recognition is managed in UNIKLIFE.AI Finance and is not computed here.</p>
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-muted">
          <li><strong>Gross booking value</strong> — net price (after discounts) of confirmed and completed bookings.</li>
          <li><strong>Verified payments</strong> — money verified by the payment gateway webhook or recorded by staff from a bank statement. Simulated (mock) payments are shown separately and never included in real collections.</li>
          <li><strong>Outstanding</strong> — net price of confirmed bookings minus verified payments.</li>
        </ul>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-bold">Booking requests — last 30 days</h3>
            <span className="text-xs text-muted">{trendCount} request(s) · {inr(trendValue, { compact: true })} requested value</span>
          </div>
          <BarTrend data={m.trend.map((t) => ({ day: t.day, value: t.value }))} label="Booking request value" format={(n) => inr(n, { compact: true })} />
          <p className="mt-1 text-[0.7rem] text-muted">Includes bookings awaiting payment; excludes cancelled and expired requests.</p>
        </Card>
        <Card className="p-5">
          <h3 className="mb-3 font-bold">Plot status</h3>
          <StatusBar counts={inv} />
          <dl className="mt-4 grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-lg bg-surface-2 p-2"><dt className="text-muted">Ventures</dt><dd className="text-lg font-extrabold">{inv.ventures}</dd></div>
            <div className="rounded-lg bg-surface-2 p-2"><dt className="text-muted">Total plots</dt><dd className="text-lg font-extrabold">{inv.plots}</dd></div>
          </dl>
          <p className="mt-2 text-[0.7rem] text-muted">Inventory counts cover all plots in the ventures you can access.</p>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Top ventures" subtitle="By gross booking value (confirmed & completed)" />
          {leaders.ventures.length === 0 ? (
            <EmptyState title="No confirmed bookings yet" />
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead><tr><th>Venture</th><th className="text-right">Bookings</th><th className="text-right">Plots</th><th className="text-right">Area (sq yd)</th><th className="text-right">Value</th></tr></thead>
                <tbody>
                  {leaders.ventures.map((v) => (
                    <tr key={v.venture_id}>
                      <td><Link href={`/sales?venture=${v.venture_id}`} className="font-semibold text-primary hover:underline">{v.venture_name}</Link></td>
                      <td className="text-right">{v.bookings}</td>
                      <td className="text-right">{v.plots}</td>
                      <td className="text-right">{num(v.area)}</td>
                      <td className="text-right font-semibold">{inr(v.value, { compact: true })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card>
          <CardHeader title="Top plots" subtitle="Highest net value in confirmed & completed bookings" />
          {leaders.plots.length === 0 ? (
            <EmptyState title="No confirmed bookings yet" />
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead><tr><th>Plot</th><th>Booking</th><th className="text-right">Area</th><th className="text-right">Net</th></tr></thead>
                <tbody>
                  {leaders.plots.map((p) => (
                    <tr key={`${p.booking_id}-${p.plot_id}`}>
                      <td><div className="font-semibold">Plot {p.plot_number}</div><div className="text-xs text-muted">{p.venture_name}</div></td>
                      <td><Link href={`/bookings/${p.booking_id}`} className="text-primary hover:underline">{p.booking_number}</Link> <StatusBadge status={p.status} /></td>
                      <td className="text-right">{num(p.area_sq_yards)}</td>
                      <td className="text-right font-semibold">{inr(p.net_amount, { compact: true })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
