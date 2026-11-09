import { Download, ShieldCheck } from "lucide-react";
import { requirePageContext } from "@/lib/auth/server";
import { can } from "@/lib/auth/context";
import { commissionSummary, listEntries } from "@/lib/services/commissions";
import { Card, Notice, PageHeader, Stat } from "@/components/ui";
import { CommissionsNav, TabLinks, downloadClass } from "@/components/commissions/commissions-nav";
import { LedgerTable } from "@/components/commissions/ledger-table";
import { EntryApprovals, type ApprovalEntry } from "@/components/commissions/entry-approvals";
import { inr } from "@/lib/format";

export const metadata = { title: "Commissions" };

const STATUS_FILTERS = ["", "calculated", "approved", "settled", "paid", "rejected", "reversed"];

export default async function CommissionsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePageContext("staff");
  const sp = await searchParams;
  const canApprove = can(ctx, "commission.approve");
  const tab = sp.tab === "team" ? "team" : sp.tab === "approvals" && canApprove ? "approvals" : "mine";
  const status = STATUS_FILTERS.includes(sp.status ?? "") ? sp.status || undefined : undefined;

  const [summary, mine, team, queue] = await Promise.all([
    commissionSummary(ctx),
    tab === "mine" ? listEntries(ctx, { scope: "mine", status }) : Promise.resolve([]),
    tab === "team" ? listEntries(ctx, { scope: "team", status }) : Promise.resolve([]),
    canApprove ? listEntries(ctx, { scope: "all", status: "calculated" }) : Promise.resolve([]),
  ]);
  const lifetime = summary.pending + summary.approved + summary.settled + summary.paid;

  const approvals: ApprovalEntry[] = queue.map((e) => ({
    id: String(e.id), bookingId: String(e.booking_id), bookingNumber: String(e.booking_number), plots: (e.plot_numbers as string[]) ?? [],
    employeeId: String(e.employee_id), employeeCode: String(e.employee_code), fullName: String(e.full_name), role: String(e.beneficiary_role),
    level: Number(e.employee_level), payableRate: Number(e.payable_rate),
    basis: e.basis === "percentage" ? "percentage" : "per_sq_yard",
    payableRatePercent: e.payable_rate_percent == null ? null : Number(e.payable_rate_percent),
    baseAmount: e.base_amount == null ? null : Number(e.base_amount), area: Number(e.area_sq_yards), amount: Number(e.amount), planVersion: Number(e.plan_version),
  }));

  const tabs = [
    { key: "mine", href: "/commissions", label: "My ledger" },
    { key: "team", href: "/commissions?tab=team", label: "My team" },
    ...(canApprove ? [{ key: "approvals", href: "/commissions?tab=approvals", label: "Approvals queue", count: approvals.length }] : []),
  ];

  return (
    <>
      <PageHeader
        eyebrow="Finance"
        title="Commissions"
        subtitle="Per-square-yard commissions calculated from confirmed bookings under the approved plan version in force at confirmation."
        actions={ctx.employee ? <a href="/api/commissions/statement" className={downloadClass} download><Download size={16} aria-hidden /> My statement (XLSX)</a> : undefined}
      />
      <CommissionsNav active="ledger" canPlans={can(ctx, "commission.plan_manage")} canSettlements={canApprove} />

      <section className="premium-hero relative mb-6 overflow-hidden rounded-2xl p-5 text-white shadow-[var(--shadow)] sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.18em] text-[#f3dc8a]">Lifetime commission</div>
            <div className="mt-1 text-3xl font-extrabold tracking-tight sm:text-4xl"><span className="gold-text">{inr(lifetime)}</span></div>
            <div className="mt-1 text-sm text-white/70">
              {ctx.employee ? <>Employee ID {ctx.employee.code}{ctx.employee.commissionLevel ? ` · Level ${ctx.employee.commissionLevel}` : " · not on the commission ladder"}</> : "No employee record is linked to your account."}
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2 text-xs text-white/80 ring-1 ring-white/15">
            <ShieldCheck size={16} className="text-[#f3dc8a]" aria-hidden />
            You see only your own and your downline&apos;s entries — never an upline&apos;s rates or earnings.
          </div>
        </div>
      </section>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Pending approval" value={inr(summary.pending)} hint="Calculated, awaiting approver" />
        <Stat label="Approved" value={inr(summary.approved)} hint="Ready for the next settlement" accent="primary" />
        <Stat label="In settlement" value={inr(summary.settled)} hint="Awaiting finance payment" />
        <Stat label="Paid" value={inr(summary.paid)} hint="Confirmed by an authorized person" accent="gold" />
      </div>

      <Card className="overflow-hidden">
        <TabLinks tabs={tabs} active={tab} />
        {tab !== "approvals" && (
          <form className="flex flex-wrap items-end gap-2 border-b border-border px-5 py-3" action="/commissions">
            {tab === "team" && <input type="hidden" name="tab" value="team" />}
            <div>
              <label className="label" htmlFor="status">Status</label>
              <select id="status" name="status" defaultValue={status ?? ""} className="input min-w-[160px]">
                {STATUS_FILTERS.map((f) => <option key={f} value={f}>{f ? f : "All statuses"}</option>)}
              </select>
            </div>
            <button className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white">Apply</button>
          </form>
        )}
        {tab === "mine" && (
          <LedgerTable rows={mine} empty={{ title: "No commission entries yet", body: "Entries are created automatically when a booking credited to you (or your downline) is confirmed." }} />
        )}
        {tab === "team" && (
          <>
            <div className="px-5 pt-4"><Notice tone="info">Entries of employees who report to you, directly or indirectly. Your own entries are under “My ledger”.</Notice></div>
            <LedgerTable rows={team} showEmployee empty={{ title: "No team entries", body: "Nobody in your downline has commission entries yet." }} />
          </>
        )}
        {tab === "approvals" && <EntryApprovals entries={approvals} myEmployeeId={ctx.employee?.id ?? null} />}
      </Card>

      {ctx.employee && (
        <Card className="mt-6 p-5">
          <h2 className="font-bold">Download a statement for a period</h2>
          <form action="/api/commissions/statement" method="get" className="mt-3 flex flex-wrap items-end gap-3">
            <div><label className="label" htmlFor="from">From</label><input id="from" name="from" type="date" className="input" /></div>
            <div><label className="label" htmlFor="to">To</label><input id="to" name="to" type="date" className="input" /></div>
            <button className={downloadClass}><Download size={16} aria-hidden /> Download XLSX</button>
          </form>
        </Card>
      )}
    </>
  );
}
