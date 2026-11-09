import Link from "next/link";
import { requirePageContext } from "@/lib/auth/server";
import { listPayments } from "@/lib/services/payments";
import { Badge, Card, EmptyState, Notice, PageHeader, Stat, StatusBadge, cx } from "@/components/ui";
import { dateTime, inr } from "@/lib/format";

export const metadata = { title: "Payments" };

const STATUSES = ["", "verified", "pending", "failed", "refunded"];
const KINDS = [
  { key: "", label: "Real & simulated" },
  { key: "real", label: "Real only" },
  { key: "simulated", label: "Simulated only" },
];
const LIMIT = 500;

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePageContext("payment.view");
  const sp = await searchParams;
  const status = STATUSES.includes(sp.status ?? "") ? (sp.status ?? "") : "";
  const kind = KINDS.some((k) => k.key === sp.kind) ? (sp.kind ?? "") : "";
  const all = await listPayments(ctx, { status: status || undefined });
  const rows = all.filter((p) => (kind === "real" ? !p.is_simulated : kind === "simulated" ? !!p.is_simulated : true));

  // Totals are computed from the server rows; simulated money is NEVER added to real collections.
  const sum = (pred: (p: Record<string, unknown>) => boolean) => Math.round(all.filter(pred).reduce((s, p) => s + Number(p.amount), 0) * 100) / 100;
  const verifiedReal = sum((p) => p.status === "verified" && !p.is_simulated);
  const verifiedSim = sum((p) => p.status === "verified" && !!p.is_simulated);
  const failed = sum((p) => p.status === "failed");
  const pending = sum((p) => p.status === "pending");
  const truncated = all.length >= LIMIT;

  const href = (over: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const merged = { status: status || null, kind: kind || null, ...over };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return `/payments${s ? `?${s}` : ""}`;
  };

  return (
    <>
      <PageHeader
        eyebrow="Finance"
        title="Payments"
        subtitle={ctx.networkEmployeeIds === null ? "All payment transactions in your organization." : "Payments on bookings by you and your team."}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Verified — real" value={inr(verifiedReal, { compact: true })} hint="Gateway-verified or staff-verified offline payments" accent="gold" />
        <Stat label="Verified — simulated" value={inr(verifiedSim, { compact: true })} hint="Mock provider · no money received" />
        <Stat label="Pending checkouts" value={inr(pending, { compact: true })} hint="Not yet verified" />
        <Stat label="Failed" value={inr(failed, { compact: true })} hint="Declined, superseded or expired" />
      </div>
      {status && <p className="mt-2 text-xs text-muted">Totals reflect the “{status}” filter.</p>}
      {truncated && <p className="mt-2 text-xs text-warning">Showing the latest {LIMIT} transactions; totals cover these rows only.</p>}
      {verifiedSim > 0 && (
        <div className="mt-4">
          <Notice tone="info" title="Simulated payments are kept separate">
            Transactions from the mock provider are flagged SIMULATED. They confirm test bookings but are never counted as real collections.
          </Notice>
        </div>
      )}

      <Card className="mt-6">
        <div className="flex flex-col gap-3 border-b border-border px-4 py-3 md:flex-row md:items-center md:justify-between">
          <nav className="-mx-1 flex gap-1 overflow-x-auto" aria-label="Filter by status">
            {STATUSES.map((s) => (
              <Link key={s || "all"} href={href({ status: s || null })} aria-current={status === s ? "page" : undefined}
                className={cx("whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-semibold capitalize", status === s ? "bg-primary text-primary-contrast" : "text-muted hover:bg-surface-2")}>
                {s || "All"}
              </Link>
            ))}
          </nav>
          <nav className="-mx-1 flex gap-1 overflow-x-auto" aria-label="Real or simulated">
            {KINDS.map((k) => (
              <Link key={k.key || "both"} href={href({ kind: k.key || null })} aria-current={kind === k.key ? "page" : undefined}
                className={cx("whitespace-nowrap rounded-lg border px-3 py-1.5 text-xs font-semibold", kind === k.key ? "border-gold bg-gold-soft text-gold-strong" : "border-border text-muted")}>
                {k.label}
              </Link>
            ))}
          </nav>
        </div>
        {rows.length === 0 ? (
          <EmptyState title="No payments">Payments appear here once a checkout is started or an offline payment is recorded.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr><th>Date</th><th>Booking</th><th>Customer</th><th>Provider</th><th>Purpose</th><th className="text-right">Amount</th><th>Status</th></tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={String(p.id)}>
                    <td className="whitespace-nowrap text-xs">{dateTime(p.created_at as string)}{p.verified_at ? <div className="text-muted">verified {dateTime(p.verified_at as string)}</div> : null}</td>
                    <td><Link href={`/bookings/${p.booking_id}`} className="font-semibold text-primary hover:underline">{String(p.booking_number)}</Link></td>
                    <td className="text-sm">{String(p.customer_name)}</td>
                    <td className="text-xs">
                      <div className="font-semibold capitalize">{String(p.provider)}</div>
                      <div className="font-mono text-muted">{String(p.provider_reference)}</div>
                    </td>
                    <td className="text-xs capitalize">{String(p.purpose).replace(/_/g, " ")}</td>
                    <td className="whitespace-nowrap text-right font-semibold">{inr(p.amount as string)}</td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        <StatusBadge status={String(p.status)} />
                        {p.is_simulated ? <Badge tone="info">simulated</Badge> : <Badge tone="gold">real</Badge>}
                      </div>
                      {p.failure_reason ? <div className="mt-0.5 text-xs text-danger">{String(p.failure_reason)}</div> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
