import Link from "next/link";
import { PlotMortgageForm } from "@/components/plots/plot-mortgage-form";
import { Box } from "lucide-react";
import { requirePageContext } from "@/lib/auth/server";
import { can } from "@/lib/auth/context";
import { getPlot, isEngineStatus } from "@/lib/services/plots";
import { Badge, Card, CardHeader, EmptyState, LinkButton, PageHeader, PlotStatusBadge, StatusBadge } from "@/components/ui";
import { PlotEditForm } from "@/components/plots/plot-edit-form";
import { dateTime, FACING_LABEL, inr, num, PLOT_STATUS_LABEL } from "@/lib/format";

export const metadata = { title: "Plot" };

const n = (v: unknown) => (v === null || v === undefined ? "" : String(Number(v)));

function Attr({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-surface-2 px-3 py-2">
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-0.5 font-semibold">{children}</dd>
    </div>
  );
}

export default async function PlotDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePageContext("venture.view");
  const { plot: p, prices, statusHistory, bookings, enquiryCount, phases } = await getPlot(ctx, id);
  const polygon = (p.polygon as [number, number][] | null) ?? null;
  const status = String(p.status);
  const bookable=status==="available" && !p.is_mortgaged && Number(p.base_price_per_sq_yard)>0;
  const canManage = can(ctx, "plot.manage");
  return (
    <>
      <PageHeader
        eyebrow={<Link href={`/plots?venture=${p.venture_id}`} className="hover:underline">{String(p.venture_name)} · Inventory</Link>}
        title={<span className="flex flex-wrap items-center gap-3">Plot {String(p.plot_number)} <PlotStatusBadge status={status} />{p.venture_is_demo ? <Badge tone="gold">Demo venture</Badge> : null}</span>}
        subtitle={status === "blocked" && p.blocked_reason ? `Blocked: ${String(p.blocked_reason)}` : undefined}
        actions={<>{can(ctx,"booking.create") && bookable && <LinkButton href={`/bookings/new?plots=${id}`} variant="primary">Book this plot</LinkButton>}<LinkButton href={`/ventures/${p.venture_id}`} variant="gold"><Box size={16} /> Open layout</LinkButton></>}
      />

      {!bookable && <p className="mb-4 rounded-xl border border-border p-4 text-sm">{p.is_mortgaged ? "Booking unavailable: active mortgage. Release requires a document reference and review." : Number(p.base_price_per_sq_yard)<=0 ? "Selling price not set. Set a positive rate and unblock the plot before booking." : `Booking unavailable while this plot is ${status}.`}</p>}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        <div className="space-y-5">
          <Card>
            <CardHeader title="Attributes" />
            <dl className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-3">
              <Attr label="Venture">{String(p.venture_code)}</Attr>
              <Attr label="Phase / block">{p.phase_name ? `${p.phase_name} (${p.phase_code})` : "—"}</Attr>
              <Attr label="Status">{PLOT_STATUS_LABEL[status] ?? status}</Attr>
              <Attr label="Mortgage">{p.is_mortgaged ? "Yes — blocked" : "No"}</Attr>
              <Attr label="Mortgage key / reference">{String(p.mortgage_reference || "Not entered")}</Attr>
              <Attr label="Area">{num(p.area_sq_yards as string)} sq yd</Attr>
              <Attr label="Dimensions">{(p.dimensions_text as string) ?? (p.width_ft && p.length_ft ? `${n(p.width_ft)} × ${n(p.length_ft)} ft` : "—")}</Attr>
              <Attr label="Facing">{p.facing ? FACING_LABEL[String(p.facing)] ?? String(p.facing) : "—"}</Attr>
              {(["north","south","east","west"] as const).map(side=><Attr key={side} label={`${side} boundary`}>{p[`${side}_ft`]?`${n(p[`${side}_ft`])} ft`:"Unconfirmed"}</Attr>)}
              <Attr label="Road width">{p.road_width_ft ? `${n(p.road_width_ft)} ft` : "—"}</Attr>
              <Attr label="Corner">{p.is_corner ? "Yes" : "No"}</Attr>
              <Attr label="Enquiries">{enquiryCount}</Attr>
              <Attr label="List price / sq yd">{inr(p.base_price_per_sq_yard as string)}</Attr>
              <Attr label="Total list price">{inr(p.total_base_price as string)}</Attr>
              <Attr label="Active hold / live booking">{p.has_active_hold ? "Hold" : p.has_live_booking ? "Booking" : "None"}</Attr>
            </dl>
            {p.notes ? <p className="border-t border-border px-5 py-3 text-sm text-muted">Notes: {String(p.notes)}</p> : null}
          </Card>

          <Card>
            <CardHeader title="Geometry & 3D mapping" subtitle="Polygon in metres on the layout plane; mesh id = GLB node name." />
            <dl className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-4">
              <Attr label="Mesh id"><code className="text-sm">{(p.mesh_id as string) ?? "—"}</code></Attr>
              <Attr label="Source">{(p.geometry_source as string) ?? "—"}</Attr>
              <Attr label="Vertices">{polygon ? polygon.length : "—"}</Attr>
              <Attr label="Centroid">{p.centroid_x !== null && p.centroid_x !== undefined ? `${n(p.centroid_x)}, ${n(p.centroid_y)}` : "—"}</Attr>
            </dl>
            {p.geometry_source === "dxf" && <p className="px-5 pb-4 text-xs text-warning">Imported from a DXF drawing — verify against the approved survey drawing.</p>}
            {can(ctx, "venture.update") && <p className="px-5 pb-4 text-sm"><Link className="text-primary hover:underline" href={`/ventures/${p.venture_id}/assets`}>Manage CAD import & mesh mapping →</Link></p>}
          </Card>

          <Card className="overflow-hidden">
            <CardHeader title="Booking history" subtitle={can(ctx, "booking.view") ? "Only bookings visible to you are listed." : undefined} />
            {!can(ctx, "booking.view") ? (
              <EmptyState title="You do not have access to bookings" />
            ) : bookings.length === 0 ? (
              <EmptyState title="No visible bookings for this plot" />
            ) : (
              <div className="overflow-x-auto">
                <table className="table">
                  <thead><tr><th>Booking</th><th>Customer</th><th className="text-right">Rate (snapshot)</th><th className="text-right">Net</th><th>Status</th><th>Created</th></tr></thead>
                  <tbody>
                    {bookings.map((b) => (
                      <tr key={String(b.id)}>
                        <td><Link className="font-semibold text-primary hover:underline" href={`/bookings/${b.id}`}>{String(b.booking_number)}</Link></td>
                        <td>{String(b.customer_name)}</td>
                        <td className="text-right">{inr(b.price_per_sq_yard as string)}</td>
                        <td className="text-right">{inr(b.net_amount as string)}</td>
                        <td><StatusBadge status={String(b.status)} /></td>
                        <td className="whitespace-nowrap text-xs text-muted">{dateTime(b.created_at as Date)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {canManage && <div id="mortgage"><PlotMortgageForm key={`mortgage-${p.version}`} plotId={id} version={Number(p.version)} mortgaged={Boolean(p.is_mortgaged)} reference={String(p.mortgage_reference || "")} /></div>}
          {canManage && (
            <PlotEditForm
              key={String(p.version)}
              plotId={id}
              phases={phases}
              engineStatus={isEngineStatus(status) ? (PLOT_STATUS_LABEL[status] ?? status).toLowerCase() : null}
              hasBookings={Boolean(p.has_booking_history)}
              initial={{
                version: Number(p.version), plotNumber: String(p.plot_number), phaseId: (p.phase_id as string) ?? "", areaSqYards: n(p.area_sq_yards),
                lengthFt: n(p.length_ft), widthFt: n(p.width_ft), dimensionsText: (p.dimensions_text as string) ?? "", facing: (p.facing as string) ?? "",
                roadWidthFt: n(p.road_width_ft), isCorner: Boolean(p.is_corner), basePricePerSqYard: n(p.base_price_per_sq_yard), notes: (p.notes as string) ?? "",
              }}
            />
          )}
        </div>

        <div className="space-y-5">
          <Card className="overflow-hidden">
            <CardHeader title="Price history" subtitle="List price per sq yd. Bookings keep their own snapshot." />
            {prices.length === 0 ? <EmptyState title="No price history" /> : (
              <ul className="divide-y divide-border">
                {prices.map((r, i) => (
                  <li key={String(r.id)} className="flex items-start justify-between gap-3 px-5 py-3 text-sm">
                    <div>
                      <div className="font-semibold">{inr(r.price_per_sq_yard as string)}{i === 0 && <Badge tone="gold" className="ml-2">current</Badge>}</div>
                      <div className="text-xs text-muted">{String(r.reason ?? "—")}{r.created_by_name ? ` · ${r.created_by_name}` : ""}</div>
                    </div>
                    <span className="whitespace-nowrap text-xs text-muted">{dateTime(r.effective_from as Date)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card className="overflow-hidden">
            <CardHeader title="Status history" />
            {statusHistory.length === 0 ? <EmptyState title="No status changes recorded" /> : (
              <ol className="divide-y divide-border">
                {statusHistory.map((h) => (
                  <li key={String(h.id)} className="px-5 py-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      {h.from_status ? <PlotStatusBadge status={String(h.from_status)} /> : null}
                      {h.from_status ? <span className="text-muted">→</span> : null}
                      <PlotStatusBadge status={String(h.to_status)} />
                    </div>
                    <div className="mt-1 text-xs text-muted">
                      {String(h.reason ?? "")}{h.actor_name ? ` · ${h.actor_name}` : ""} · {dateTime(h.created_at as Date)}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
