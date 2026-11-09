import Link from "next/link";
import { requirePageContext } from "@/lib/auth/server";
import { can } from "@/lib/auth/context";
import { listActiveHolds, listBookings } from "@/lib/services/bookings";
import { Badge, Card, CardHeader, EmptyState, LinkButton, PageHeader, StatusBadge } from "@/components/ui";
import { dateTime, inr, num, relative } from "@/lib/format";

export const metadata = { title: "Bookings" };

const FILTERS = ["", "payment_pending", "confirmed", "completed", "cancelled", "expired"];

export default async function BookingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePageContext();
  const sp = await searchParams;
  const [bookings, holds] = await Promise.all([listBookings(ctx, { status: sp.status || undefined, q: sp.q || undefined }), listActiveHolds(ctx)]);
  const base = ctx.role === "customer" ? "/portal/bookings" : "/bookings";
  return (
    <>
      <PageHeader
        eyebrow="Sales"
        title={ctx.role === "customer" ? "My bookings" : "Bookings"}
        subtitle={ctx.networkEmployeeIds !== null && ctx.role !== "customer" ? "Showing bookings credited to you and your team." : undefined}
        actions={can(ctx, "booking.create") ? <LinkButton href="/ventures" variant="gold">New booking from 3D viewer</LinkButton> : undefined}
      />

      {holds.length > 0 && (
        <Card className="mb-6">
          <CardHeader title="Active temporary holds" subtitle="Plots held while a booking is being completed. Holds expire automatically." />
          <ul className="divide-y divide-border">
            {holds.map((h) => (
              <li key={String(h.hold_group_id)} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                <span><strong>Plots {(h.plot_numbers as string[]).join(", ")}</strong> · {String(h.venture_name)} · {String(h.customer_name)}{h.credited_employee_code ? ` · ${h.credited_employee_code}` : ""}</span>
                <span className="flex items-center gap-2">
                  {h.has_booking ? <Badge tone="info">booking pending payment</Badge> : <Badge tone="warning">expires {relative(h.expires_at as Date)}</Badge>}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <form className="mb-3 grid grid-cols-[1fr_auto] gap-2 sm:mb-4 sm:flex sm:flex-wrap" action="/bookings">
        <input name="q" defaultValue={sp.q} placeholder="Search booking, customer, phone or plot" className="input col-span-2 sm:max-w-xs" aria-label="Search bookings" />
        <select name="status" defaultValue={sp.status ?? ""} className="input sm:max-w-[200px]" aria-label="Filter by status">
          {FILTERS.map((f) => <option key={f} value={f}>{f ? f.replace("_", " ") : "All statuses"}</option>)}
        </select>
        <button className="rounded-xl bg-primary px-4 text-sm font-semibold text-white">Filter</button>
      </form>

      {/* Phones: compact cards */}
      {bookings.length > 0 && (
        <ul className="space-y-2 sm:hidden" data-testid="booking-cards">
          {bookings.map((b) => {
            const verified = Number(b.verified_amount ?? 0);
            const adv = Number(b.booking_amount ?? 0);
            return (
              <li key={String(b.id)}>
                <Link href={`${base}/${b.id}`} className="card block p-3 active:bg-surface-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-primary">{String(b.booking_number)}</span>
                    <StatusBadge status={String(b.status)} />
                  </div>
                  <div className="mt-1 truncate text-sm font-semibold">{String(b.customer_name)}</div>
                  <div className="truncate text-xs text-muted">Plots {(b.plot_numbers as string[]).join(", ")} · {num(b.total_area_sq_yards as string)} sq yd</div>
                  <div className="mt-2 flex items-center justify-between gap-2 text-xs">
                    <span className="font-bold">{inr(b.net_amount as string, { compact: true })}</span>
                    {verified >= adv && adv > 0 ? <Badge tone="success">advance {b.has_simulated_payment ? "verified (sim)" : "verified"}</Badge> : verified > 0 ? <Badge tone="warning">partial</Badge> : <Badge>advance pending</Badge>}
                  </div>
                  {b.review_reason ? <div className="mt-1"><Badge tone="danger">needs review</Badge></div> : null}
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <Card className={bookings.length ? "hidden overflow-hidden sm:block" : "overflow-hidden"}>
        {bookings.length === 0 ? (
          <EmptyState title="No bookings found" />
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr><th>Booking</th><th>Customer</th><th>Plots</th><th>Area</th><th className="text-right">Net price</th><th className="text-right">Advance</th><th>Payment</th><th>Status</th>{ctx.role !== "customer" && <th>Selling employee</th>}<th>Created</th></tr>
              </thead>
              <tbody>
                {bookings.map((b) => {
                  const verified = Number(b.verified_amount ?? 0);
                  const adv = Number(b.booking_amount ?? 0);
                  return (
                    <tr key={String(b.id)}>
                      <td><Link href={`${base}/${b.id}`} className="font-semibold text-primary hover:underline">{String(b.booking_number)}</Link>{b.review_reason ? <div className="mt-0.5"><Badge tone="danger">needs review</Badge></div> : null}</td>
                      <td>{String(b.customer_name)}<div className="text-xs text-muted">{String(b.customer_phone ?? "")}</div></td>
                      <td>{(b.plot_numbers as string[]).join(", ")}<div className="text-xs text-muted">{String(b.venture_name)}</div></td>
                      <td>{num(b.total_area_sq_yards as string)}</td>
                      <td className="text-right font-semibold">{inr(b.net_amount as string)}</td>
                      <td className="text-right">{inr(adv)}</td>
                      <td>{verified >= adv && adv > 0 ? <Badge tone="success">{b.has_simulated_payment ? "verified (simulated)" : "verified"}</Badge> : verified > 0 ? <Badge tone="warning">partial</Badge> : <Badge>pending</Badge>}</td>
                      <td><StatusBadge status={String(b.status)} /></td>
                      {ctx.role !== "customer" && <td className="text-xs">{b.credited_employee_code ? `${b.credited_employee_code} · ${b.credited_employee_name}` : "—"}</td>}
                      <td className="whitespace-nowrap text-xs text-muted">{dateTime(b.created_at as Date)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
