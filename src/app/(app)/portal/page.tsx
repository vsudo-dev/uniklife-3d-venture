import Link from "next/link";
import { ArrowRight, Box, CalendarDays, Globe, Inbox, Mail, MapPin, Phone } from "lucide-react";
import { requirePageContext, getBranding } from "@/lib/auth/server";
import { listVentures } from "@/lib/services/ventures";
import { listBookings } from "@/lib/services/bookings";
import { listMyEnquiries } from "@/lib/services/enquiries";
import { listSiteVisits } from "@/lib/services/site-visits";
import { Badge, Card, CardHeader, EmptyState, LinkButton, Notice, StatusBadge } from "@/components/ui";
import { CustomerVisitCancel } from "@/components/site-visits/visit-actions";
import { dateTime, inr, relative } from "@/lib/format";

export const metadata = { title: "My portal" };

function paymentLabel(b: Record<string, unknown>): { text: string; tone: "success" | "warning" | "info" | "neutral" } {
  const verified = Number(b.verified_amount ?? 0);
  const advance = Number(b.booking_amount ?? 0);
  const net = Number(b.net_amount ?? 0);
  if (b.status === "cancelled" || b.status === "expired") return { text: verified > 0 ? "Refund review" : "No payment", tone: "neutral" };
  if (verified >= net && net > 0) return { text: "Fully paid", tone: "success" };
  if (verified >= advance && advance > 0) return { text: "Advance paid", tone: "success" };
  if (verified > 0) return { text: "Partly paid", tone: "info" };
  return { text: "Advance due", tone: "warning" };
}

export default async function PortalPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePageContext("customer");
  const sp = await searchParams;
  const [branding, ventures, bookings, enquiries, visits] = await Promise.all([
    getBranding(),
    listVentures(ctx),
    ctx.customerId ? listBookings(ctx, { limit: 50 }) : Promise.resolve([]),
    listMyEnquiries(ctx),
    ctx.customerId ? listSiteVisits(ctx, {}) : Promise.resolve([]),
  ]);
  const firstName = ctx.user.fullName.split(" ")[0];
  const upcomingVisits = [...visits].sort((a, b) => new Date(b.scheduled_at as string).getTime() - new Date(a.scheduled_at as string).getTime()).slice(0, 6);

  return (
    <>
      <section className="premium-hero relative mb-6 overflow-hidden rounded-2xl p-6 text-white sm:p-8">
        <div className="relative z-10 max-w-2xl">
          <div className="text-xs font-bold uppercase tracking-[0.22em] text-[#e9cf73]">{branding.companyName}</div>
          <h1 className="mt-2 text-2xl font-extrabold sm:text-3xl">Welcome, {firstName}</h1>
          <p className="mt-2 text-sm text-white/75">Explore ventures in 3D, book plots securely and keep track of your payments and visits.</p>
          <div className="mt-5 flex flex-wrap gap-2">
            <LinkButton href="/ventures" variant="gold"><Box size={16} />Explore in 3D</LinkButton>
            <Link href="/portal/site-visit" className="inline-flex items-center gap-2 rounded-xl border border-white/30 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10"><CalendarDays size={16} />Request a site visit</Link>
          </div>
        </div>
      </section>

      {sp.visit === "requested" && <div className="mb-4"><Notice tone="success" title="Site visit requested">Our sales team will confirm the time with you shortly.</Notice></div>}
      {!ctx.customerId && <div className="mb-4"><Notice tone="warning" title="Profile incomplete">Your customer profile isn&apos;t linked yet. Please contact the sales team before booking.</Notice></div>}

      <section aria-labelledby="ventures-h">
        <h2 id="ventures-h" className="mb-3 text-lg font-extrabold">Ventures</h2>
        {ventures.length === 0 ? (
          <Card><EmptyState title="No ventures published yet">Please check back soon.</EmptyState></Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {ventures.map((v) => (
              <Link key={v.id} href={`/ventures/${v.id}`} className="card group overflow-hidden transition hover:shadow-[var(--glow)]">
                <div className="h-2 bg-gradient-to-r from-primary via-gold to-gold-strong" aria-hidden />
                <div className="p-5">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-bold leading-snug">{v.name}</h3>
                    {v.is_demo ? <Badge tone="gold">demo</Badge> : <StatusBadge status={v.status} />}
                  </div>
                  <div className="mt-1 flex items-center gap-1 text-xs text-muted"><MapPin size={12} />{[v.location_text, v.city].filter(Boolean).join(", ") || "Location on request"}</div>
                  <div className="mt-4 flex items-end justify-between">
                    <div>
                      <div className="text-2xl font-extrabold text-success">{v.available}</div>
                      <div className="text-xs text-muted">of {v.total_plots} plots available</div>
                    </div>
                    {v.min_price && <div className="text-right text-xs text-muted">from <span className="block text-sm font-bold text-text">{inr(v.min_price, { compact: true })}</span></div>}
                  </div>
                  <div className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-primary">View in 3D<ArrowRight size={14} className="transition group-hover:translate-x-0.5" /></div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="My bookings" subtitle="Payment status is verified by the server" />
          {bookings.length === 0 ? (
            <EmptyState title="No bookings yet" action={<LinkButton href="/ventures" variant="outline">Choose plots</LinkButton>}>Select plots in the 3D viewer and choose “Proceed to booking”.</EmptyState>
          ) : (
            <ul className="divide-y divide-border">
              {bookings.map((b) => {
                const pay = paymentLabel(b);
                return (
                  <li key={String(b.id)}>
                    <Link href={`/portal/bookings/${b.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-surface-2">
                      <div className="min-w-0">
                        <div className="font-semibold">{String(b.booking_number)} · {String(b.venture_name)}</div>
                        <div className="truncate text-xs text-muted">Plots {(b.plot_numbers as string[]).join(", ")} · {relative(b.created_at as Date)}</div>
                        {b.status === "payment_pending" && <div className="text-xs text-warning">Pay by {dateTime(b.payment_due_at as string)}</div>}
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-sm font-bold">{inr(b.net_amount as string)}</div>
                        <div className="mt-0.5 flex flex-wrap justify-end gap-1"><StatusBadge status={String(b.status)} /><Badge tone={pay.tone}>{pay.text}</Badge></div>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="font-bold">Contact sales</h2>
          <p className="mt-1 text-sm text-muted">{branding.companyName}</p>
          <ul className="mt-4 space-y-2 text-sm">
            {branding.contactPhone && <li><a href={`tel:${branding.contactPhone}`} className="inline-flex items-center gap-2 font-semibold text-primary hover:underline"><Phone size={14} />{branding.contactPhone}</a></li>}
            {branding.contactEmail && <li><a href={`mailto:${branding.contactEmail}`} className="inline-flex items-center gap-2 font-semibold text-primary hover:underline"><Mail size={14} />{branding.contactEmail}</a></li>}
            {branding.website && <li><a href={branding.website.startsWith("http") ? branding.website : `https://${branding.website}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 font-semibold text-primary hover:underline"><Globe size={14} />{branding.website}</a></li>}
            {!branding.contactPhone && !branding.contactEmail && !branding.website && <li className="text-muted">Use the enquiry button on any plot in the 3D viewer and our team will reach out.</li>}
          </ul>
          <LinkButton href="/portal/site-visit" variant="outline" className="mt-5 w-full"><CalendarDays size={16} />Request a site visit</LinkButton>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="My site visits" action={<Link href="/portal/site-visit" className="text-sm font-semibold text-primary">Request</Link>} />
          {upcomingVisits.length === 0 ? (
            <EmptyState title="No site visits yet">Request a visit and we&apos;ll confirm a time with you.</EmptyState>
          ) : (
            <ul className="divide-y divide-border">
              {upcomingVisits.map((v) => (
                <li key={String(v.id)} className="flex items-start justify-between gap-3 px-5 py-3 text-sm">
                  <div className="min-w-0">
                    <div className="font-semibold">{String(v.venture_name)}</div>
                    <div className="text-xs text-muted">{dateTime(v.scheduled_at as string)}{(v.plot_numbers as string[]).length ? ` · Plots ${(v.plot_numbers as string[]).join(", ")}` : ""}</div>
                    {v.employee_name ? <div className="text-xs text-muted">With {String(v.employee_name)}</div> : null}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <StatusBadge status={String(v.status)} />
                    {["requested", "scheduled"].includes(String(v.status)) && <CustomerVisitCancel id={String(v.id)} />}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="My enquiries" />
          {enquiries.length === 0 ? (
            <EmptyState title="No enquiries yet">Tap a plot in the 3D viewer and choose “Enquire” to ask a question.</EmptyState>
          ) : (
            <ul className="divide-y divide-border">
              {enquiries.map((e) => (
                <li key={e.id} className="flex items-start justify-between gap-3 px-5 py-3 text-sm">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 font-semibold"><Inbox size={14} className="text-gold" />{e.venture_name}{e.plot_number ? ` · Plot ${e.plot_number}` : ""}</div>
                    {e.message && <p className="mt-0.5 line-clamp-2 text-xs text-muted">{e.message}</p>}
                    <div className="text-[0.7rem] text-muted">{relative(e.created_at)}</div>
                  </div>
                  <StatusBadge status={e.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
