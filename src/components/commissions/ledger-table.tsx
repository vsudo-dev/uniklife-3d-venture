import Link from "next/link";
import { EmptyState, StatusBadge } from "@/components/ui";
import { date, inr, num } from "@/lib/format";

export type LedgerRow = Record<string, unknown>;

const ROLE_LABEL: Record<string, string> = { seller: "Seller", upline: "Upline", ceo_entitlement: "CEO entitlement" };

/**
 * Ledger rows as returned by listEntries. Only shows the beneficiary's own
 * payable rate — never the rates or earnings of anyone above them.
 */
export function LedgerTable({ rows, showEmployee, empty }: { rows: LedgerRow[]; showEmployee?: boolean; empty: { title: string; body?: string } }) {
  if (rows.length === 0) return <EmptyState title={empty.title}>{empty.body}</EmptyState>;
  const total = rows.reduce((s, r) => s + Number(r.amount ?? 0), 0);
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>Booking</th>
            {showEmployee && <th>Employee</th>}
            <th>Role</th>
            <th>Level</th>
            <th className="text-right">Rate</th>
            <th className="text-right">Area (sq yd)</th>
            <th className="text-right">Amount</th>
            <th>Plan</th>
            <th>Status</th>
            <th>Date</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={String(r.id)}>
              <td>
                <Link href={`/bookings/${r.booking_id}`} className="font-semibold text-primary hover:underline">{String(r.booking_number)}</Link>
                <div className="text-xs text-muted">Plots {((r.plot_numbers as string[]) ?? []).join(", ")}</div>
              </td>
              {showEmployee && (
                <td>
                  <div className="font-medium">{String(r.full_name)}</div>
                  <div className="text-xs text-muted">{String(r.employee_code)}</div>
                </td>
              )}
              <td className="whitespace-nowrap">{ROLE_LABEL[String(r.beneficiary_role)] ?? String(r.beneficiary_role)}</td>
              <td><span className="rounded-md bg-gold-soft px-1.5 py-0.5 text-xs font-bold text-gold-strong">L{String(r.employee_level)}</span></td>
              <td className="text-right tabular-nums">
                {r.basis === "percentage" ? (
                  <>
                    {Number(r.payable_rate_percent)}%
                    <div className="text-[0.7rem] text-muted">of {inr(r.base_amount as string)}</div>
                  </>
                ) : (
                  <>{inr(r.payable_rate as string)}<div className="text-[0.7rem] text-muted">per sq yd</div></>
                )}
              </td>
              <td className="text-right tabular-nums">{num(r.area_sq_yards as string)}</td>
              <td className="text-right font-semibold tabular-nums">{inr(r.amount as string)}</td>
              <td className="text-xs text-muted">v{String(r.plan_version)}</td>
              <td>
                <StatusBadge status={String(r.status)} />
                {r.settlement_reference ? <div className="mt-0.5 text-[0.7rem] text-muted">{String(r.settlement_reference)}</div> : null}
              </td>
              <td className="whitespace-nowrap text-xs text-muted">{date((r.confirmed_at ?? r.created_at) as string)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={showEmployee ? 6 : 5} className="border-t border-border px-3 py-3 text-right text-xs font-bold uppercase tracking-wide text-muted">Total ({rows.length} entries)</td>
            <td className="border-t border-border px-3 py-3 text-right font-extrabold tabular-nums">{inr(Math.round(total * 100) / 100)}</td>
            <td colSpan={3} className="border-t border-border" />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
