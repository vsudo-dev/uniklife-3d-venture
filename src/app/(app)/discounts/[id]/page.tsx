import Link from "next/link";
import { notFound as nfPage } from "next/navigation";
import { Pencil } from "lucide-react";
import { requirePageContext } from "@/lib/auth/server";
import { can } from "@/lib/auth/context";
import { canSelfApproveDiscount } from "@/lib/auth/permissions";
import { discountDashboard, discountFormOptions, discountReferenceLabels, getDiscount } from "@/lib/services/discounts";
import { isUuid } from "@/lib/services/common";
import { Badge, Card, CardHeader, LinkButton, Notice, PageHeader, StatusBadge } from "@/components/ui";
import { DiscountForm } from "@/components/discounts/discount-form";
import { DiscountActions } from "@/components/discounts/discount-actions";
import { discountRowToForm } from "@/components/discounts/discount-values";
import { dateTime, inr } from "@/lib/format";

export const metadata = { title: "Discount" };

const ACTION_LABEL: Record<string, string> = {
  submitted: "Submitted for approval", approved: "Approved / activated", rejected: "Rejected", paused: "Paused", reactivated: "Reactivated", archived: "Archived",
};
const ACTION_DOT: Record<string, string> = {
  submitted: "bg-warning", approved: "bg-success", rejected: "bg-danger", paused: "bg-muted", reactivated: "bg-primary", archived: "bg-muted",
};

export default async function DiscountPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requirePageContext("discount.view");
  if (!isUuid(id)) nfPage();
  const data = await getDiscount(ctx, id).catch(() => null);
  if (!data) nfPage();
  const d = data.discount;
  const [{ settings }, plotLabels, { ventures }] = await Promise.all([
    discountDashboard(ctx),
    discountReferenceLabels(ctx, (d.applicable_plot_ids as string[]) ?? []),
    discountFormOptions(ctx),
  ]);
  const ventureNames = ((d.applicable_venture_ids as string[]) ?? []).map((vid) => ventures.find((v) => v.id === vid)?.name ?? vid);
  const editable = can(ctx, "discount.create") && !["archived", "rejected"].includes(String(d.status));
  const editing = sp.edit === "1" && editable;
  const expired = d.expires_at ? new Date(d.expires_at as string).getTime() <= Date.now() : false;
  const pct = d.value_type === "percentage";
  const fourEyesBlocked = d.created_by === ctx.user.id || d.last_submitted_by === ctx.user.id;

  if (editing) {
    return (
      <>
        <PageHeader eyebrow={<Link href={`/discounts/${id}`} className="hover:underline">{String(d.name)}</Link>} title="Edit discount"
          subtitle={canSelfApproveDiscount(ctx.role) ? "Edits are re-checked against organization limits." : "Edits by your role send the discount back for approval by a different approver."} />
        <DiscountForm mode="edit" discountId={id} initial={discountRowToForm(d)} initialPlotVentureId={plotLabels[0]?.venture_id ?? null} settings={settings} canSelfApprove={canSelfApproveDiscount(ctx.role)} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/discounts" className="hover:underline">Discounts</Link>}
        title={String(d.name)}
        subtitle={d.code ? <>Code <span className="font-mono font-semibold">{String(d.code)}</span> — applied only when entered</> : "Codeless — offered automatically to eligible bookings"}
        actions={editable ? <LinkButton href={`/discounts/${id}?edit=1`} variant="outline"><Pencil size={16} />Edit</LinkButton> : undefined}
      />
      {expired && <div className="mb-4"><Notice tone="warning" title="Expired">This discount expired on {dateTime(d.expires_at as string)} and can no longer be applied to new bookings.</Notice></div>}
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          <Card>
            <CardHeader title="Definition" action={<StatusBadge status={String(d.status)} />} />
            <dl className="grid gap-4 p-5 text-sm sm:grid-cols-2">
              <div><dt className="text-xs text-muted">Value</dt><dd className="text-xl font-extrabold">{pct ? `${Number(d.value)}%` : inr(d.value as string)}</dd><dd className="text-xs text-muted">{pct ? "of each eligible plot's base price" : "fixed, allocated across eligible plots"}</dd></div>
              <div><dt className="text-xs text-muted">Maximum discount</dt><dd className="font-semibold">{d.max_discount_amount ? inr(d.max_discount_amount as string) : "No cap (organization limit still applies)"}</dd></div>
              <div><dt className="text-xs text-muted">Category</dt><dd className="font-semibold capitalize">{String(d.category)}{d.campaign_name ? ` · ${d.campaign_name}` : ""}</dd></div>
              <div><dt className="text-xs text-muted">Validity</dt><dd>{dateTime(d.starts_at as string)} → {d.expires_at ? dateTime(d.expires_at as string) : "no expiry"}</dd></div>
              <div><dt className="text-xs text-muted">Applies to</dt>
                <dd>
                  {d.customer_name ? <div>Customer: <strong>{String(d.customer_name)}</strong></div> : null}
                  {ventureNames.length > 0 && <div>Ventures: {ventureNames.join(", ")}</div>}
                  {plotLabels.length > 0 && <div>Plots: {plotLabels.map((p) => `${p.plot_number}`).join(", ")} <span className="text-xs text-muted">({plotLabels[0].venture_name})</span></div>}
                  {!d.customer_name && ventureNames.length === 0 && plotLabels.length === 0 && <span>All ventures and plots</span>}
                </dd>
              </div>
              <div><dt className="text-xs text-muted">Usage</dt>
                <dd className="font-semibold">{Number(d.usage_count)} used{d.usage_limit_total ? ` of ${d.usage_limit_total}` : ""}</dd>
                <dd className="text-xs text-muted">{d.usage_limit_per_customer ? `${d.usage_limit_per_customer} per customer` : "No per-customer limit"} · {inr(d.granted_amount as string)} granted on confirmed bookings</dd>
              </div>
              <div><dt className="text-xs text-muted">Combining</dt><dd>{d.stackable ? <Badge tone="info">stackable</Badge> : <Badge>not stackable</Badge>} <span className="text-xs text-muted">Org stacking {settings.allowStacking ? "enabled" : "disabled"}</span></dd></div>
              <div><dt className="text-xs text-muted">Approval</dt><dd>{d.requires_approval ? <Badge tone="warning">requires approval</Badge> : <Badge>not required</Badge>}</dd>
                <dd className="mt-1 text-xs text-muted">Created by {String(d.created_by_name ?? "—")}{d.approved_by_name ? ` · approved by ${d.approved_by_name} ${dateTime(d.approved_at as string)}` : ""}</dd></div>
            </dl>
          </Card>

          <Card>
            <CardHeader title="Approval history" subtitle="Every submission, decision and status change is recorded." />
            {data.approvals.length === 0 ? (
              <div className="px-5 py-4 text-sm text-muted">No history yet.</div>
            ) : (
              <ol className="relative space-y-5 px-5 py-5">
                {data.approvals.map((a, i) => (
                  <li key={String(a.id)} className="relative flex gap-3 pl-1">
                    <div className="flex flex-col items-center">
                      <span className={`mt-1.5 h-2.5 w-2.5 rounded-full ${ACTION_DOT[String(a.action)] ?? "bg-muted"}`} aria-hidden />
                      {i < data.approvals.length - 1 && <span className="mt-1 w-px flex-1 bg-border" aria-hidden />}
                    </div>
                    <div className="min-w-0 pb-1">
                      <div className="text-sm font-semibold">{ACTION_LABEL[String(a.action)] ?? String(a.action)}</div>
                      <div className="text-xs text-muted">{String(a.actor_name ?? "System")} · {dateTime(a.created_at as string)}</div>
                      {a.note ? <p className="mt-1 text-sm">{String(a.note)}</p> : null}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
        <aside className="space-y-4">
          <DiscountActions
            discountId={id}
            status={String(d.status)}
            canApprove={can(ctx, "discount.approve")}
            canManage={can(ctx, "discount.create")}
            fourEyesBlocked={fourEyesBlocked}
          />
          <Card className="p-5 text-xs leading-relaxed text-muted">
            <h3 className="mb-1 text-sm font-bold text-text">How this discount is applied</h3>
            <ul className="list-disc space-y-1 pl-4">
              <li>Prices and discounts are computed on the server in paise; per-plot amounts always add up exactly.</li>
              <li>Plot-specific discounts apply only to the eligible plots in a multi-plot booking.</li>
              <li>The organization cap ({settings.maxDiscountPercent}% of base) applies to the combined discount.</li>
              <li>{settings.allowStacking ? "Stacking is enabled: only stackable discounts combine." : "Stacking is disabled: a second discount on the same booking is rejected."}</li>
              <li>At payment confirmation the discount is re-validated; if it was paused, archived or exhausted the booking is held for staff review instead of confirming.</li>
            </ul>
          </Card>
        </aside>
      </div>
    </>
  );
}
