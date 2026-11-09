import Link from "next/link";
import { Plus } from "lucide-react";
import { requirePageContext } from "@/lib/auth/server";
import { can } from "@/lib/auth/context";
import { discountDashboard, listDiscounts } from "@/lib/services/discounts";
import { Badge, Card, EmptyState, LinkButton, Notice, PageHeader, Stat, StatusBadge, cx } from "@/components/ui";
import { date, inr } from "@/lib/format";

export const metadata = { title: "Discounts" };

const TABS = [
  { key: "", label: "All" },
  { key: "active", label: "Active" },
  { key: "pending_approval", label: "Pending approval" },
  { key: "paused", label: "Paused" },
  { key: "expired", label: "Expired" },
  { key: "rejected", label: "Rejected" },
  { key: "archived", label: "Archived" },
];

const CATEGORY_LABEL: Record<string, string> = {
  general: "General", coupon: "Coupon", venture: "Venture", plot: "Plot", promotional: "Promotion", campaign: "Campaign", customer: "Customer",
};

export default async function DiscountsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePageContext("discount.view");
  const sp = await searchParams;
  const status = TABS.some((t) => t.key === sp.status) ? sp.status : "";
  const query = sp.q?.slice(0, 60) ?? "";
  const [kpi, rows] = await Promise.all([discountDashboard(ctx), listDiscounts(ctx, { status: status || undefined, q: query || undefined })]);
  const now = Date.now();
  const tabCount: Record<string, number> = {
    "": kpi.total, active: kpi.active, pending_approval: kpi.pendingApproval, paused: kpi.paused, expired: kpi.expired, rejected: kpi.rejected, archived: kpi.archived,
  };

  return (
    <>
      <PageHeader
        eyebrow="Finance"
        title="Discounts"
        subtitle="Coupons, venture & plot offers, promotions and customer-specific discounts — validated on the server and re-validated at payment confirmation."
        actions={can(ctx, "discount.create") ? <LinkButton href="/discounts/new" variant="gold"><Plus size={16} />New discount</LinkButton> : undefined}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Active" value={kpi.active} hint="Usable right now" accent="primary" />
        <Stat label="Pending approval" value={kpi.pendingApproval} hint="Awaiting a second approver" />
        <Stat label="Expired" value={kpi.expired} hint="Past their expiry date" />
        <Stat label="Granted (confirmed)" value={inr(kpi.grantedOnConfirmed, { compact: true })} hint="Discounts on confirmed bookings only" accent="gold" />
        <Stat label="Usage" value={kpi.redemptionsConfirmed + kpi.redemptionsReserved} hint={`${kpi.redemptionsConfirmed} confirmed · ${kpi.redemptionsReserved} on pending bookings`} />
      </div>

      <div className="mt-4">
        <Notice tone={kpi.settings.allowStacking ? "info" : "gold"} title={kpi.settings.allowStacking ? "Discount stacking is enabled" : "Discount stacking is disabled (default)"}>
          {kpi.settings.allowStacking
            ? "Multiple discounts may combine on one booking, but only when every discount involved is marked stackable."
            : "Only one discount can be applied per booking. An organization administrator can enable stacking in Settings; even then, only discounts marked stackable combine."}{" "}
          Total discount per booking is capped at {kpi.settings.maxDiscountPercent}% of the base price; percentage discounts above {kpi.settings.approvalThresholdPercent}% need approval.
        </Notice>
      </div>

      <Card className="mt-6">
        <div className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <nav className="-mx-1 flex gap-1 overflow-x-auto pb-1 sm:pb-0" aria-label="Filter by status">
            {TABS.map((t) => (
              <Link key={t.key} href={`/discounts${t.key ? `?status=${t.key}` : ""}${query ? `${t.key ? "&" : "?"}q=${encodeURIComponent(query)}` : ""}`}
                className={cx("whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-semibold", status === t.key ? "bg-primary text-primary-contrast" : "text-muted hover:bg-surface-2")}
                aria-current={status === t.key ? "page" : undefined}>
                {t.label} <span className="ml-1 text-xs opacity-70">{tabCount[t.key]}</span>
              </Link>
            ))}
          </nav>
          <form className="flex gap-2" action="/discounts">
            {status && <input type="hidden" name="status" value={status} />}
            <input name="q" defaultValue={query} className="input py-1.5 sm:w-56" placeholder="Search name or code" aria-label="Search discounts" />
          </form>
        </div>

        {rows.length === 0 ? (
          <EmptyState title="No discounts here">{status ? "Try another filter." : "Create your first discount to offer it on bookings."}</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th><th>Type</th><th className="text-right">Value</th><th>Validity</th><th>Applies to</th><th>Usage</th><th>Approval</th><th>Status</th><th>Created / approved</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => {
                  const expired = d.expires_at && new Date(d.expires_at as string).getTime() <= now;
                  const ventures = (d.applicable_venture_ids as string[]).length;
                  const plots = (d.applicable_plot_ids as string[]).length;
                  const pct = d.value_type === "percentage";
                  return (
                    <tr key={String(d.id)}>
                      <td>
                        <Link href={`/discounts/${d.id}`} className="font-semibold text-primary hover:underline">{String(d.name)}</Link>
                        <div className="text-xs">{d.code ? <span className="font-mono">{String(d.code)}</span> : <span className="text-muted">auto-offered (no code)</span>}</div>
                      </td>
                      <td className="text-xs">
                        <div className="font-semibold">{CATEGORY_LABEL[String(d.category)] ?? String(d.category)}</div>
                        <div className="text-muted">{pct ? "Percentage" : "Fixed"}{d.stackable ? " · stackable" : ""}</div>
                      </td>
                      <td className="text-right">
                        <div className="font-bold">{pct ? `${Number(d.value)}%` : inr(d.value as string)}</div>
                        {d.max_discount_amount ? <div className="text-xs text-muted">max {inr(d.max_discount_amount as string)}</div> : null}
                      </td>
                      <td className="text-xs">
                        <div>{date(d.starts_at as string)} →</div>
                        <div className={expired ? "font-semibold text-danger" : ""}>{d.expires_at ? date(d.expires_at as string) : "no expiry"}</div>
                      </td>
                      <td className="text-xs">
                        {d.customer_name ? <div>Customer: {String(d.customer_name)}</div> : null}
                        {ventures > 0 && <div>{ventures} venture(s)</div>}
                        {plots > 0 && <div>{plots} plot(s)</div>}
                        {!d.customer_name && ventures === 0 && plots === 0 && <span className="text-muted">All ventures</span>}
                      </td>
                      <td className="text-xs">
                        <div className="font-semibold">{Number(d.usage_count)}{d.usage_limit_total ? ` / ${d.usage_limit_total}` : ""}</div>
                        <div className="text-muted">{d.usage_limit_per_customer ? `${d.usage_limit_per_customer} per customer` : "no per-customer limit"}</div>
                        {Number(d.granted_amount) > 0 && <div className="text-success">{inr(d.granted_amount as string, { compact: true })} granted</div>}
                      </td>
                      <td>{d.requires_approval ? <Badge tone="warning">required</Badge> : <Badge>not required</Badge>}</td>
                      <td>
                        <StatusBadge status={String(d.status)} />
                        {expired && d.status !== "archived" ? <Badge tone="neutral" className="ml-1">expired</Badge> : null}
                      </td>
                      <td className="text-xs">
                        <div>{String(d.created_by_name ?? "—")}</div>
                        <div className="text-muted">{d.approved_by_name ? `✓ ${d.approved_by_name}` : "not approved"}</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
