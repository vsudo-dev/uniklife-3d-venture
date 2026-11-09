import Link from "next/link";
import { Bell, CalendarDays, ClipboardList, Coins, Inbox, ListTodo } from "lucide-react";
import { requirePageContext } from "@/lib/auth/server";
import { can } from "@/lib/auth/context";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import { myHome, salesMetrics } from "@/lib/services/dashboard";
import { listNotifications } from "@/lib/services/notifications";
import { Card, CardHeader, EmptyState, LinkButton, PageHeader, Stat, StatusBadge } from "@/components/ui";
import { BarTrend, StatusBar } from "@/components/charts";
import { dateTime, inr, relative } from "@/lib/format";

export const metadata = { title: "Home" };

export default async function DashboardPage() {
  const ctx = await requirePageContext("staff");
  const [home, notifications, metrics] = await Promise.all([
    myHome(ctx),
    listNotifications(ctx, { limit: 5 }),
    can(ctx, "dashboard.view") ? salesMetrics(ctx) : Promise.resolve(null),
  ]);
  const tiles = [
    { href: "/enquiries?mine=1", label: "My enquiries", value: home.counts.my_enquiries, Icon: Inbox },
    { href: "/bookings", label: "My bookings", value: home.counts.my_bookings, Icon: ClipboardList, hint: `${home.counts.my_pending_bookings} awaiting advance` },
    { href: "/site-visits", label: "My site visits", value: home.counts.my_site_visits, Icon: CalendarDays },
    { href: "/notifications", label: "Pending follow-ups", value: home.counts.my_followups, Icon: ListTodo },
    { href: "/commissions", label: "My commissions (approved)", value: inr(home.commissions.approved + home.commissions.settled, { compact: true }), Icon: Coins, hint: `${inr(home.commissions.pending, { compact: true })} pending · ${inr(home.commissions.paid, { compact: true })} paid` },
    { href: "/notifications", label: "Notifications", value: home.unread, Icon: Bell, hint: "unread" },
  ];

  return (
    <>
      <PageHeader
        eyebrow={ROLE_LABELS[ctx.role]}
        title={`Welcome, ${ctx.user.fullName.split(" ")[0]}`}
        subtitle={ctx.employee ? `Employee ID ${ctx.employee.code} · ${ctx.organizationName}` : ctx.organizationName}
        actions={
          <>
            <LinkButton href="/ventures" variant="gold">Open 3D venture</LinkButton>
            {can(ctx, "booking.create") && <LinkButton href="/bookings/new" variant="outline">New booking</LinkButton>}
          </>
        }
      />

      <div className="grid grid-cols-3 gap-2 sm:gap-3 md:grid-cols-3 xl:grid-cols-6">
        {tiles.map(({ href, label, value, Icon, hint }) => (
          <Link key={label} href={href} className="card card-holo group min-w-0 p-2.5 sm:p-4">
            <Icon size={16} className="text-gold" aria-hidden />
            <div className="mt-1 truncate text-lg font-extrabold tabular-nums sm:mt-2 sm:text-2xl">{value}</div>
            <div className="line-clamp-2 text-[0.68rem] font-semibold leading-tight text-muted sm:text-xs">{label}</div>
            {hint && <div className="mt-0.5 hidden text-[0.7rem] text-muted sm:block">{hint}</div>}
          </Link>
        ))}
      </div>

      <div className="mt-4 grid gap-4 sm:mt-6 sm:gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="My recent bookings" action={<Link href="/bookings" className="text-sm font-semibold text-primary">View all</Link>} />
          {home.recentBookings.length === 0 ? (
            <EmptyState title="No bookings yet">Open a venture in 3D, select plots and create a booking.</EmptyState>
          ) : (
            <ul className="divide-y divide-border">
              {home.recentBookings.map((b) => (
                <li key={String(b.id)}>
                  <Link href={`/bookings/${b.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-surface-2">
                    <div className="min-w-0">
                      <div className="font-semibold">{String(b.booking_number)} · {String(b.customer_name)}</div>
                      <div className="truncate text-xs text-muted">Plots {(b.plot_numbers as string[]).join(", ")} · {relative(b.created_at as Date)}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-bold">{inr(b.net_amount as string)}</div>
                      <StatusBadge status={String(b.status)} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Notifications" action={<Link href="/notifications" className="text-sm font-semibold text-primary">All</Link>} />
          {notifications.length === 0 ? (
            <EmptyState title="You're all caught up" />
          ) : (
            <ul className="divide-y divide-border">
              {notifications.map((n) => (
                <li key={n.id} className="px-5 py-3">
                  <Link href={n.link ?? "/notifications"} className="block">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      {!n.read_at && <span className="h-2 w-2 rounded-full bg-gold" aria-label="unread" />}
                      {n.title}
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted">{n.body}</p>
                    <div className="mt-1 text-[0.7rem] text-muted">{relative(n.created_at)}</div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {home.upcomingVisits.length > 0 && (
        <Card className="mt-6">
          <CardHeader title="Upcoming site visits" />
          <ul className="divide-y divide-border">
            {home.upcomingVisits.map((v) => (
              <li key={String(v.id)} className="flex items-center justify-between px-5 py-3 text-sm">
                <span><strong>{String(v.visitor_name)}</strong> · {String(v.venture_name)}</span>
                <span className="text-muted">{dateTime(v.scheduled_at as Date)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {metrics && (
        <section className="mt-8">
          <h2 className="mb-3 text-lg font-extrabold">
            {metrics.scope === "organization" ? "Organization overview" : "My team overview"}
          </h2>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Gross booking value" value={inr(metrics.grossBookingValue, { compact: true })} hint="Net price of confirmed bookings (not revenue)" accent="gold" />
            <Stat label="Verified collections" value={inr(metrics.verifiedPaymentsReal, { compact: true })} hint={metrics.verifiedPaymentsSimulated > 0 ? `+ ${inr(metrics.verifiedPaymentsSimulated, { compact: true })} simulated (test)` : "Server-verified payments"} accent="primary" />
            <Stat label="Outstanding balances" value={inr(metrics.outstandingBalances, { compact: true })} hint="Confirmed bookings, unpaid portion" />
            <Stat label="Conversion" value={`${metrics.conversionRate}%`} hint={`${metrics.confirmedBookings} confirmed of ${metrics.bookingRequests} requests`} />
          </div>
          <div className="mt-4 grid gap-4 sm:mt-6 sm:gap-6 lg:grid-cols-3">
            <Card className="p-5 lg:col-span-2">
              <div className="mb-2 flex items-baseline justify-between">
                <h3 className="font-bold">Booking value — last 30 days</h3>
                <span className="text-xs text-muted">Booking requests, by day</span>
              </div>
              <BarTrend data={metrics.trend.map((t) => ({ day: t.day, value: t.value }))} label="Booking value" format={(n) => inr(n, { compact: true })} />
            </Card>
            <Card className="p-5">
              <h3 className="mb-3 font-bold">Plot availability</h3>
              <StatusBar counts={metrics.inventory} />
              <div className="mt-4 text-xs text-muted">{metrics.inventory.plots} plots across {metrics.inventory.ventures} venture(s)</div>
            </Card>
          </div>
        </section>
      )}
    </>
  );
}
