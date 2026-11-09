import DiscountsPage from "../../discounts/page";
import Link from "next/link";
import { History, Layers, Lock } from "lucide-react";
import { requirePageContext } from "@/lib/auth/server";
import { can } from "@/lib/auth/context";
import { getCommissionSettings, listPlans, listPlanVentures } from "@/lib/services/commissions";
import { scopeKey, type CommissionBasis } from "@/lib/commissions/engine";
import { Badge, Card, CardHeader, EmptyState, Notice, PageHeader, StatusBadge, cx } from "@/components/ui";
import { CommissionsNav } from "@/components/commissions/commissions-nav";
import { NewVersionButton } from "@/components/commissions/new-version-button";
import { PlanWorkspace, type WorkspacePlan } from "@/components/commissions/plan-workspace";
import { Simulator } from "@/components/commissions/simulator";
import { ApprovalSettingsCard } from "@/components/commissions/approval-settings";
import { scopeLabel, type PlanSummary, type VentureOption } from "@/components/commissions/types";
import { dateTime } from "@/lib/format";

export const metadata = { title: "Commission plans" };

const ACTION_LABEL: Record<string, string> = {
  created: "Draft created", updated: "Draft edited", submitted: "Submitted for approval", approved: "Approved & activated", rejected: "Rejected", superseded: "Superseded",
};

type Row = Record<string, unknown>;
const venturesOf = (p: Row) => ((p.ventures as { id: string; name: string }[] | null) ?? []);
const labelOf = (p: Row) => scopeLabel(String(p.property_type ?? "any"), venturesOf(p).map((v) => v.name));
const basisOf = (p: Row) => (String(p.basis ?? "per_sq_yard") as CommissionBasis);

export default async function CommissionPlansPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const initialCtx = await requirePageContext("staff");
  const sp = await searchParams;
  const sections=<nav aria-label="Plans and discount sections" className="mb-5 flex flex-wrap gap-2 rounded-xl border border-border p-2">{can(initialCtx,"commission.plan_manage") && <Link href="/commissions/plans" className="rounded-lg px-4 py-2 font-semibold text-primary">Plans &amp; simulator</Link>}<Link href="/commissions/plans?section=discounts" className="rounded-lg px-4 py-2 font-semibold text-primary">Discounts</Link></nav>;
  if(sp.section==="discounts")return <><PageHeader title="Plans & simulator" subtitle="Commission plans, simulations and discounts in one workspace."/>{sections}<DiscountsPage searchParams={searchParams}/></>;
  const ctx = await requirePageContext("commission.plan_manage");
  const [plans, ventureRows, settings] = await Promise.all([listPlans(ctx), listPlanVentures(ctx), getCommissionSettings(ctx)]);
  const ventures: VentureOption[] = ventureRows.map((v) => ({ id: v.id, name: v.name, propertyType: v.property_type }));
  const summaries: PlanSummary[] = plans.map((p) => ({
    id: String(p.id), version: Number(p.version), name: String(p.name), status: String(p.status),
    basis: basisOf(p), levelCount: Number(p.level_count ?? 8), scopeLabel: labelOf(p),
  }));

  // Group versions by scope (ventures + property type); org-wide 'any' first, then more specific scopes.
  const groups = new Map<string, { key: string; label: string; orgWide: boolean; propertyType: string; plans: Row[] }>();
  for (const p of plans) {
    const k = scopeKey(String(p.property_type ?? "any"), (p.venture_ids as string[]) ?? []);
    const g = groups.get(k) ?? { key: k, label: labelOf(p), orgWide: ((p.venture_ids as string[]) ?? []).length === 0, propertyType: String(p.property_type ?? "any"), plans: [] };
    g.plans.push(p);
    groups.set(k, g);
  }
  const specificity = (g: { orgWide: boolean; propertyType: string }) => (g.orgWide ? 0 : 2) + (g.propertyType === "any" ? 0 : 1);
  const groupList = [...groups.values()].sort((a, b) => specificity(a) - specificity(b) || a.label.localeCompare(b.label));

  const selectedRow =
    plans.find((p) => p.id === sp.plan) ?? plans.find((p) => p.status === "draft") ?? plans.find((p) => p.status === "pending_approval") ?? plans.find((p) => p.status === "active") ?? plans[0];

  const selected: WorkspacePlan | null = selectedRow
    ? {
        id: String(selectedRow.id), version: Number(selectedRow.version), status: String(selectedRow.status), name: String(selectedRow.name),
        calculationMethod: selectedRow.calculation_method as WorkspacePlan["calculationMethod"],
        paySellingEmployee: Boolean(selectedRow.pay_selling_employee), ceoSeparateEntitlement: Boolean(selectedRow.ceo_separate_entitlement),
        maxPayableLevels: Number(selectedRow.max_payable_levels), notes: (selectedRow.notes as string | null) ?? null,
        levelCount: Number(selectedRow.level_count ?? 8), basis: basisOf(selectedRow), propertyType: String(selectedRow.property_type ?? "any"),
        ventureIds: (selectedRow.venture_ids as string[]) ?? [], scopeLabel: labelOf(selectedRow),
        submittedBy: (selectedRow.submitted_by as string | null) ?? null,
        levels: ((selectedRow.levels as { level: number; label: string; rate: number | string | null; eligible: boolean }[]) ?? []).map((l) => ({ ...l, rate: Number(l.rate ?? 0) })),
      }
    : null;
  const history = (selectedRow?.approvals as { action: string; note: string | null; actor_name: string | null; created_at: string }[] | null) ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Finance · Configuration"
        title="Commission plans"
        subtitle="Configurable plans per venture and property type: 1–12 levels, ₹ per sq yd or % of sale value. Changes apply only after approval, from an effective date."
        actions={<NewVersionButton label="New plan" />}
      />
      {sections}
      <CommissionsNav active="plans" canPlans canSettlements={can(ctx, "commission.approve")} />

      <div className="mb-6">
        <Notice tone="gold" title="Approved plans are immutable — edits create a new version">
          Once approved, a version&apos;s levels, rates, basis and scope can never be edited — the database enforces this. “Edit plan” creates a new draft version
          with the same scope. Every ledger entry records the plan version it was calculated with, so approving a new version never rewrites history; it applies
          only to bookings confirmed from its effective date.
        </Notice>
      </div>

      <div className="grid gap-6 xl:grid-cols-[340px_1fr]">
        <div className="min-w-0 space-y-6">
          <Card className="overflow-hidden">
            <CardHeader
              title={<span className="inline-flex items-center gap-2"><Layers size={16} className="text-gold" aria-hidden /> Plans by scope</span>}
              subtitle="Each sale uses the most specific approved plan: venture + property type › venture › property type › all ventures."
            />
            {plans.length === 0 ? (
              <EmptyState title="No plans yet">Create the first plan from the proposed defaults with “New plan”.</EmptyState>
            ) : (
              <div className="divide-y divide-border">
                {groupList.map((g) => {
                  const current = g.plans.find((p) => p.status === "active" && !p.effective_to);
                  const latestApproved = g.plans.find((p) => p.status === "active" || p.status === "superseded");
                  const openDraft = g.plans.some((p) => p.status === "draft");
                  return (
                    <section key={g.key} aria-label={g.label}>
                      <div className="flex items-start justify-between gap-2 bg-surface-2 px-5 py-2.5">
                        <div className="min-w-0">
                          <h3 className="text-sm font-bold">{g.label}</h3>
                          <p className="text-xs text-muted">
                            {current
                              ? `Current: v${current.version} · ${Number(current.level_count ?? 8)} levels · ${basisOf(current) === "percentage" ? "% of sale value" : "₹ per sq yd"}`
                              : "No approved version in force"}
                          </p>
                        </div>
                        {latestApproved && <NewVersionButton fromPlanId={String(latestApproved.id)} label="Edit" variant="outline" size="sm" hasOpenDraft={openDraft} />}
                      </div>
                      <ul className="divide-y divide-border">
                        {g.plans.map((p) => {
                          const isSel = selectedRow?.id === p.id;
                          return (
                            <li key={String(p.id)}>
                              <Link
                                href={`/commissions/plans?plan=${p.id}`}
                                aria-current={isSel ? "true" : undefined}
                                className={cx("block px-5 py-3 transition hover:bg-surface-2", isSel && "bg-gold-soft/40 shadow-[inset_3px_0_0_var(--gold)]")}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="flex items-center gap-2">
                                    <span className="font-bold">v{String(p.version)}</span>
                                    <Badge tone="neutral">{Number(p.level_count ?? 8)}L · {basisOf(p) === "percentage" ? "%" : "₹/sq yd"}</Badge>
                                  </span>
                                  <span className="flex items-center gap-1">
                                    {(p.status === "active" || p.status === "superseded") && <Lock size={12} className="text-muted" aria-label="immutable" />}
                                    <StatusBadge status={String(p.status)} />
                                  </span>
                                </div>
                                <div className="truncate text-sm">{String(p.name)}</div>
                                <div className="mt-0.5 text-xs text-muted">
                                  {p.effective_from ? <>From {dateTime(p.effective_from as string)}{p.effective_to ? <> to {dateTime(p.effective_to as string)}</> : " · open-ended"}</> : <>Created {dateTime(p.created_at as string)}{p.created_by_name ? ` by ${p.created_by_name}` : ""}</>}
                                </div>
                                <div className="text-xs text-muted">{p.calculation_method === "differential" ? "Differential" : "Full rate"}{p.approved_by_name ? ` · approved by ${p.approved_by_name}` : ""}</div>
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    </section>
                  );
                })}
              </div>
            )}
          </Card>

          <ApprovalSettingsCard requiresSecondApprover={settings.requiresSecondApprover} canEdit={can(ctx, "org.manage") && can(ctx, "commission.approve")} />

          {selectedRow && (
            <Card>
              <CardHeader title={<span className="inline-flex items-center gap-2"><History size={16} className="text-gold" aria-hidden /> Approval history · v{String(selectedRow.version)}</span>} />
              {history.length === 0 ? (
                <p className="px-5 py-4 text-sm text-muted">No history recorded.</p>
              ) : (
                <ol className="relative space-y-4 px-5 py-4">
                  {history.map((h, i) => (
                    <li key={i} className="relative pl-6">
                      <span className={cx("absolute left-0 top-1.5 h-2.5 w-2.5 rounded-full", h.action === "approved" ? "bg-success" : h.action === "rejected" ? "bg-danger" : "bg-gold")} aria-hidden />
                      {i < history.length - 1 && <span className="absolute left-[4px] top-4 h-[calc(100%+0.5rem)] w-px bg-border" aria-hidden />}
                      <div className="text-sm font-semibold">{ACTION_LABEL[h.action] ?? h.action}</div>
                      <div className="text-xs text-muted">{h.actor_name ?? "System"} · {dateTime(h.created_at)}</div>
                      {h.note && <div className="mt-0.5 text-xs italic text-muted">“{h.note}”</div>}
                    </li>
                  ))}
                </ol>
              )}
            </Card>
          )}
        </div>

        <div className="min-w-0">
          {selected ? (
            <PlanWorkspace
              key={selected.id}
              plan={selected}
              plans={summaries}
              ventures={ventures}
              canApprove={can(ctx, "commission.approve")}
              currentUserId={ctx.user.id}
              requiresSecondApprover={settings.requiresSecondApprover}
            />
          ) : (
            <Simulator plans={summaries} draft={null} />
          )}
        </div>
      </div>
    </>
  );
}
