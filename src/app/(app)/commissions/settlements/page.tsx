import { ShieldAlert } from "lucide-react";
import { requirePageContext } from "@/lib/auth/server";
import { can } from "@/lib/auth/context";
import { listEntries, listSettlements } from "@/lib/services/commissions";
import { Notice, PageHeader, Stat } from "@/components/ui";
import { CommissionsNav } from "@/components/commissions/commissions-nav";
import { SettlementsWorkspace, type SettlementView } from "@/components/commissions/settlements-workspace";
import { inr } from "@/lib/format";

export const metadata = { title: "Commission settlements" };

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v ? String(v) : null);

export default async function SettlementsPage() {
  const ctx = await requirePageContext("commission.approve");
  const [rows, approved] = await Promise.all([listSettlements(ctx), listEntries(ctx, { scope: "all", status: "approved" })]);
  const ready = approved.filter((e) => !e.settlement_id);
  const readyTotal = Math.round(ready.reduce((s, e) => s + Number(e.amount), 0) * 100) / 100;

  const settlements: SettlementView[] = rows.map((s) => ({
    id: String(s.id), reference: String(s.reference), periodType: s.period_type as SettlementView["periodType"],
    periodStart: String(s.period_start_text), periodEnd: String(s.period_end_text), status: String(s.status),
    totalAmount: Number(s.total_amount), entryCount: Number(s.entry_count),
    createdBy: (s.created_by as string | null) ?? null, submittedBy: (s.submitted_by as string | null) ?? null,
    createdByName: (s.created_by_name as string | null) ?? null, approvedByName: (s.approved_by_name as string | null) ?? null,
    paidConfirmedByName: (s.paid_confirmed_by_name as string | null) ?? null, paymentSource: (s.payment_confirmation_source as string | null) ?? null,
    paymentReference: (s.payment_reference as string | null) ?? null, paidAt: iso(s.paid_at), cancelledReason: (s.cancelled_reason as string | null) ?? null,
    createdAt: iso(s.created_at) ?? "",
    reconciliations: ((s.reconciliations as Record<string, unknown>[] | null) ?? []).map((r) => ({
      id: String(r.id), status: String(r.status), source: String(r.source), reportedAmount: Number(r.reported_amount),
      externalReference: (r.external_reference as string | null) ?? null, receivedAt: String(r.received_at),
    })),
  }));

  const inFlight = settlements.filter((s) => ["submitted", "approved", "finance_requested"].includes(s.status));
  const paid = settlements.filter((s) => s.status === "paid");

  return (
    <>
      <PageHeader
        eyebrow="Finance"
        title="Settlements & finance"
        subtitle="Weekly (Monday start) or monthly (1st) batches of approved commission entries, approved by a second person and paid through finance."
      />
      <CommissionsNav active="settlements" canPlans={can(ctx, "commission.plan_manage")} canSettlements />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Ready to settle" value={inr(readyTotal)} hint={`${ready.length} approved entries`} accent="primary" />
        <Stat label="In pipeline" value={inr(inFlight.reduce((s, x) => s + x.totalAmount, 0))} hint={`${inFlight.length} settlement(s)`} />
        <Stat label="Paid (confirmed)" value={inr(paid.reduce((s, x) => s + x.totalAmount, 0))} hint={`${paid.length} settlement(s)`} accent="gold" />
        <Stat label="Drafts" value={settlements.filter((s) => s.status === "draft").length} hint="Awaiting submission" />
      </div>

      <div className="mb-6">
        <Notice tone="warning" title="A delivered webhook never marks commissions paid">
          <span className="inline-flex items-start gap-2">
            <ShieldAlert size={16} className="mt-0.5 shrink-0" aria-hidden />
            <span>
              Finance callbacks from UNIKLIFE.AI are stored only as reconciliation records. A settlement becomes <strong>paid</strong> only when an authorized
              person confirms the payment with a reference, or accepts a reconciliation whose amount exactly matches the settlement total. Mismatches can only be rejected.
            </span>
          </span>
        </Notice>
      </div>

      <SettlementsWorkspace
        settlements={settlements}
        ready={{ count: ready.length, total: readyTotal }}
        canSettle={can(ctx, "commission.settle")}
        canApprove={can(ctx, "commission.approve")}
        currentUserId={ctx.user.id}
      />
    </>
  );
}
