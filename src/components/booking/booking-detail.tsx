import { Download } from "lucide-react";
import { Badge, Card, CardHeader, Notice, StatusBadge } from "@/components/ui";
import { dateTime, inr, num } from "@/lib/format";

type Row = Record<string, unknown>;

export function BookingDetail({ data, isCustomer, actions }: {
  data: { booking: Row; plots: Row[]; payments: Row[]; attributionHistory: Row[]; verifiedAmount: number; outstanding: number };
  isCustomer: boolean;
  actions?: React.ReactNode;
}) {
  const b = data.booking;
  const snap = (b.confirmed_pricing_snapshot ?? b.pricing_snapshot) as { discounts?: { name: string; code: string | null; amount: number }[] } | null;
  const attribution = b.attribution_snapshot as { seller?: { employee_code: string; name: string; designation: string | null } | null; reporting_manager?: { employee_code: string; name: string } | null; created_by_name?: string; chain?: { depth: number; employee_code: string; name: string; designation: string | null; level: number | null }[] } | undefined;
  const simulated = data.payments.some((p) => p.status === "verified" && p.is_simulated);
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <div className="space-y-5">
        {b.review_reason && !isCustomer ? <Notice tone="danger" title="Confirmation blocked — staff review required">{String(b.review_reason)}</Notice> : null}
        {b.status === "payment_pending" && (
          <Notice tone="warning" title="Awaiting verified advance payment">
            The plots are reserved until {dateTime(b.payment_due_at as string)}. The booking is confirmed automatically once the payment is verified by the server.
          </Notice>
        )}
        {simulated && <Notice tone="info" title="Simulated payment">Payments on this booking were made with the mock provider for testing. No money was received.</Notice>}
        {b.venture_is_demo ? <Notice tone="gold">Demonstration venture — sample data, not a real or legally approved layout.</Notice> : null}

        <Card>
          <CardHeader title="Plots" subtitle={`${String(b.venture_name)} · ${b.plot_count} plot(s) · ${num(b.total_area_sq_yards as string)} sq yd combined`} />
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>Plot</th><th>Area (sq yd)</th><th>Rate / sq yd</th><th className="text-right">Base</th><th className="text-right">Discount</th><th className="text-right">Net</th></tr></thead>
              <tbody>
                {data.plots.map((p) => (
                  <tr key={String(p.plot_id)}>
                    <td className="font-semibold">Plot {String(p.plot_number)}</td><td>{num(p.area_sq_yards as string)}</td><td>{inr(p.price_per_sq_yard as string)}</td>
                    <td className="text-right">{inr(p.base_amount as string)}</td><td className="text-right text-success">-{inr(p.discount_amount as string)}</td><td className="text-right font-semibold">{inr(p.net_amount as string)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <CardHeader title="Payments" subtitle="Only server-verified payments count toward confirmation." />
          {data.payments.length === 0 ? (
            <div className="px-5 py-4 text-sm text-muted">No payments yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead><tr><th>Date</th><th>Provider</th><th>Reference</th><th className="text-right">Amount</th><th>Status</th></tr></thead>
                <tbody>
                  {data.payments.map((p) => (
                    <tr key={String(p.id)}>
                      <td className="text-xs">{dateTime(p.created_at as string)}</td>
                      <td>{String(p.provider)}{p.is_simulated ? <Badge tone="info" className="ml-1">simulated</Badge> : null}</td>
                      <td className="font-mono text-xs">{String(p.provider_reference)}</td>
                      <td className="text-right">{inr(p.amount as string)}</td>
                      <td><StatusBadge status={String(p.status)} />{p.failure_reason ? <div className="text-xs text-danger">{String(p.failure_reason)}</div> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {!isCustomer && attribution && (
          <Card>
            <CardHeader title="Sales attribution" subtitle={b.attribution_locked ? "Locked — commissions approved" : "Captured at booking time"} />
            <div className="grid gap-4 p-5 text-sm sm:grid-cols-3">
              <div><div className="text-xs text-muted">Selling employee</div><div className="font-semibold">{attribution.seller ? `${attribution.seller.employee_code} · ${attribution.seller.name}` : "—"}</div><div className="text-xs text-muted">{attribution.seller?.designation}</div></div>
              <div><div className="text-xs text-muted">Reporting manager</div><div className="font-semibold">{attribution.reporting_manager ? `${attribution.reporting_manager.employee_code} · ${attribution.reporting_manager.name}` : "—"}</div></div>
              <div><div className="text-xs text-muted">Created by (authenticated user)</div><div className="font-semibold">{attribution.created_by_name ?? String(b.requested_by_name ?? "—")}</div></div>
            </div>
            {attribution.chain && attribution.chain.length > 1 && (
              <div className="border-t border-border px-5 py-3">
                <div className="mb-2 text-xs font-semibold text-muted">Upline hierarchy snapshot (visible to you)</div>
                <ol className="flex flex-wrap gap-2 text-xs">
                  {attribution.chain.map((m) => (
                    <li key={m.employee_code} className="rounded-full bg-surface-2 px-2.5 py-1"><strong>{m.employee_code}</strong> {m.name}{m.level ? ` · L${m.level}` : ""}</li>
                  ))}
                </ol>
              </div>
            )}
            {data.attributionHistory.length > 0 && (
              <div className="border-t border-border px-5 py-3 text-xs">
                <div className="mb-1 font-semibold text-muted">Attribution changes</div>
                {data.attributionHistory.map((h, i) => (
                  <div key={i}>{dateTime(h.created_at as string)} · {String(h.from_code ?? "—")} → {String(h.to_code)} by {String(h.changed_by_name)}: {String(h.reason)}</div>
                ))}
              </div>
            )}
          </Card>
        )}
      </div>

      <aside className="space-y-4">
        <Card className="p-5 shadow-[var(--glow)]">
          <div className="flex items-center justify-between"><h2 className="text-lg font-extrabold">{String(b.booking_number)}</h2><StatusBadge status={String(b.status)} /></div>
          <div className="mt-1 text-sm text-muted">{String(b.customer_name)} · {String(b.customer_phone ?? "")}</div>
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-muted">Base price</dt><dd>{inr(b.base_amount as string)}</dd></div>
            {snap?.discounts?.map((d) => <div key={d.name} className="flex justify-between text-xs"><dt className="text-muted">{d.name}{d.code ? ` (${d.code})` : ""}</dt><dd className="text-success">-{inr(d.amount)}</dd></div>)}
            <div className="flex justify-between"><dt className="text-muted">Discounts</dt><dd className="text-success">-{inr(b.discount_amount as string)}</dd></div>
            <div className="flex justify-between border-t border-border pt-2 font-bold"><dt>Net price</dt><dd>{inr(b.net_amount as string)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Advance</dt><dd className="font-semibold">{inr(b.booking_amount as string)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Verified payments</dt><dd className="font-semibold text-success">{inr(data.verifiedAmount)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Outstanding</dt><dd className="font-semibold">{inr(data.outstanding)}</dd></div>
          </dl>
          <div className="mt-4 space-y-1 text-xs text-muted">
            <div>Created {dateTime(b.created_at as string)}</div>
            {b.confirmed_at ? <div>Confirmed {dateTime(b.confirmed_at as string)} via {String(b.confirmation_source ?? "").replace(/_/g, " ")}</div> : null}
            {b.cancel_reason ? <div>Reason: {String(b.cancel_reason)}</div> : null}
          </div>
          <a href={`/api/bookings/${b.id}/acknowledgement`} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-border px-4 py-2 text-sm font-semibold hover:border-gold">
            <Download size={16} />Download acknowledgement (PDF)
          </a>
        </Card>
        {actions}
      </aside>
    </div>
  );
}
