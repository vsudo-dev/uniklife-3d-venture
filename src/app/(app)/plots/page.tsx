import Link from "next/link";
import { OrgSwitcher } from "@/components/admin/settings-forms";
import { switchableOrganizations } from "@/lib/services/organizations";
import { ArrowDown, ArrowUp, Download, Upload } from "lucide-react";
import { requirePageContext } from "@/lib/auth/server";
import { can } from "@/lib/auth/context";
import { FACINGS, listPlots, PLOT_STATUSES, plotFilterOptions, plotFilterSchema, type PlotFilters } from "@/lib/services/plots";
import { Card, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { PlotTable } from "@/components/plots/plot-table";
import { PropertyTypeFilterField } from "@/components/plots/property-type-filter";
import { MobileCollapse } from "@/components/mobile-collapse";
import { FACING_LABEL, PLOT_STATUS_LABEL } from "@/lib/format";

export const metadata = { title: "Plot inventory" };

type SP = Record<string, string | undefined>;

function qs(base: SP, patch: SP): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...base, ...patch })) if (v !== undefined && v !== "") p.set(k, v);
  const s = p.toString();
  return s ? `/plots?${s}` : "/plots";
}

export default async function PlotsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requirePageContext("venture.view");
  const sp = await searchParams;
  const parsed = plotFilterSchema.safeParse({
    ventureId: sp.venture, phase: sp.phase, status: sp.status, facing: sp.facing, minArea: sp.minArea, maxArea: sp.maxArea,
    minPrice: sp.minPrice, maxPrice: sp.maxPrice, corner: sp.corner, q: sp.q, sort: sp.sort, dir: sp.dir, page: sp.page, pageSize: sp.pageSize,
    propertyType: sp.propertyType,
  });
  const filters: Partial<PlotFilters> = parsed.success ? parsed.data : {};
  const [data, options] = await Promise.all([listPlots(ctx, filters), plotFilterOptions(ctx, filters.ventureId)]);
  const organizations=await switchableOrganizations(ctx);
  const canManage = can(ctx, "plot.manage");
  const showCustomer = can(ctx, "booking.view");
  const current: SP = {
    venture: sp.venture, phase: sp.phase, status: sp.status, facing: sp.facing, minArea: sp.minArea, maxArea: sp.maxArea,
    minPrice: sp.minPrice, maxPrice: sp.maxPrice, corner: sp.corner, q: sp.q, sort: sp.sort, dir: sp.dir, pageSize: sp.pageSize,
    propertyType: sp.propertyType,
  };
  const exportParams = new URLSearchParams();
  for (const [k, v] of Object.entries(current)) if (v && !["sort", "dir", "pageSize"].includes(k)) exportParams.set(k, v);
  const exportQs = exportParams.toString();

  const sortTh = (key: PlotFilters["sort"], label: string, right = false) => {
    const active = data.filters.sort === key;
    const nextDir = active && data.filters.dir === "asc" ? "desc" : "asc";
    return (
      <th className={right ? "text-right" : undefined} aria-sort={active ? (data.filters.dir === "asc" ? "ascending" : "descending") : undefined}>
        <Link href={qs(current, { sort: key, dir: nextDir, page: undefined })} className="inline-flex items-center gap-1 hover:text-text">
          {label}
          {active && (data.filters.dir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
        </Link>
      </th>
    );
  };
  const header = (
    <>
      {sortTh("plot_number", "Plot")}
      {sortTh("phase", "Phase")}
      {sortTh("area", "Area (sq yd)", true)}
      <th>Dimensions</th>
      {sortTh("facing", "Facing")}
      {sortTh("road", "Road", true)}
      {sortTh("price", "₹ / sq yd", true)}
      {sortTh("total", "Total", true)}
      {sortTh("status", "Status")}
    </>
  );

  return (
    <>
      <PageHeader
        eyebrow="Inventory"
        title="Plot inventory"
        subtitle="Live status and list prices across your ventures. Statuses held/reserved/booked/sold are owned by the booking engine."
        actions={
          <>
            <a href={`/api/plots/export${exportQs ? `?${exportQs}` : ""}`} className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 py-2 text-sm font-semibold hover:border-gold">
              <Download size={16} /> Export CSV
            </a>
            {canManage && (
              <LinkButton href={filters.ventureId ? `/plots/import?venture=${filters.ventureId}` : "/plots/import"} variant="outline">
                <Upload size={16} /> Upload PDF / CSV
              </LinkButton>
            )}
          </>
        }
      />

      {organizations.length > 1 && <div className="mb-4"><OrgSwitcher current={ctx.organizationId} options={organizations} returnTo="/plots" /></div>}
      <MobileCollapse label="Filter plots" activeCount={["venture", "phase", "status", "facing", "minArea", "maxArea", "minPrice", "maxPrice", "corner", "q", "propertyType"].filter((k) => sp[k]).length}>
      <form action="/plots" className="card mb-4 grid gap-3 p-3 sm:p-4 sm:grid-cols-2 lg:grid-cols-6" role="search" aria-label="Filter plots">
        <PropertyTypeFilterField defaultValue={sp.propertyType} />
        <div className="lg:col-span-2">
          <label className="label" htmlFor="f-venture">Venture</label>
          <select id="f-venture" name="venture" defaultValue={sp.venture ?? ""} className="input">
            <option value="">All ventures</option>
            {options.ventures.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="f-phase">Phase / block</label>
          <select id="f-phase" name="phase" defaultValue={sp.phase ?? ""} className="input">
            <option value="">All</option>
            {options.phases.map((p) => <option key={p.id} value={p.code}>{p.name} ({p.code})</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="f-status">Status</label>
          <select id="f-status" name="status" defaultValue={sp.status ?? ""} className="input">
            <option value="">All</option>
            {PLOT_STATUSES.map((s) => <option key={s} value={s}>{PLOT_STATUS_LABEL[s] ?? s}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="f-facing">Facing</label>
          <select id="f-facing" name="facing" defaultValue={sp.facing ?? ""} className="input">
            <option value="">All</option>
            {FACINGS.map((f) => <option key={f} value={f}>{FACING_LABEL[f] ?? f}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="f-corner">Corner</label>
          <select id="f-corner" name="corner" defaultValue={sp.corner ?? ""} className="input">
            <option value="">Any</option>
            <option value="yes">Corner only</option>
            <option value="no">Non-corner</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="f-q">Plot number</label>
          <input id="f-q" name="q" defaultValue={sp.q} className="input" placeholder="Search" />
        </div>
        <fieldset className="lg:col-span-2">
          <legend className="label">Area (sq yd)</legend>
          <div className="flex gap-2">
            <input name="minArea" defaultValue={sp.minArea} className="input" inputMode="decimal" placeholder="Min" aria-label="Minimum area" />
            <input name="maxArea" defaultValue={sp.maxArea} className="input" inputMode="decimal" placeholder="Max" aria-label="Maximum area" />
          </div>
        </fieldset>
        <fieldset className="lg:col-span-2">
          <legend className="label">Total price (₹)</legend>
          <div className="flex gap-2">
            <input name="minPrice" defaultValue={sp.minPrice} className="input" inputMode="decimal" placeholder="Min" aria-label="Minimum total price" />
            <input name="maxPrice" defaultValue={sp.maxPrice} className="input" inputMode="decimal" placeholder="Max" aria-label="Maximum total price" />
          </div>
        </fieldset>
        <div className="flex items-end gap-2">
          <button className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white">Apply</button>
          <Link href="/plots" className="px-2 py-2 text-sm text-muted hover:text-text">Reset</Link>
        </div>
        {sp.sort && <input type="hidden" name="sort" value={sp.sort} />}
        {sp.dir && <input type="hidden" name="dir" value={sp.dir} />}
      </form>
      </MobileCollapse>
      {!parsed.success && <p className="mb-3 text-sm text-warning">Some filters were invalid and have been ignored.</p>}

      <div className="mb-4 flex flex-wrap gap-4 rounded-xl border border-border bg-surface p-4 text-sm" aria-label="Inventory totals">
        <span><strong>{data.total}</strong> plots matching filters</span><span><strong>{data.summary.mortgaged}</strong> mortgage blocked</span><span><strong>{data.summary.available}</strong> available with price</span><span><strong>{data.summary.unpriced}</strong> awaiting selling price</span>
      </div>
      <Card className="overflow-hidden">
        {data.rows.length === 0 ? (
          <EmptyState title="No plots match these filters">
            {canManage && filters.ventureId ? <Link href={`/plots/import?venture=${filters.ventureId}`} className="text-primary underline">Import plots from CSV</Link> : null}
          </EmptyState>
        ) : (
          <PlotTable rows={data.rows} header={header} canManage={canManage} canBook={can(ctx,"booking.create")} showCustomer={showCustomer} showVenture={!filters.ventureId} />
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3 text-sm">
          <span className="text-muted">
            {data.total === 0 ? "0 plots" : `${(data.page - 1) * data.pageSize + 1}–${Math.min(data.page * data.pageSize, data.total)} of ${data.total} plots`}
          </span>
          <nav className="flex items-center gap-2" aria-label="Pagination">
            {data.page > 1 ? <Link className="rounded-lg border border-border px-3 py-1 hover:border-gold" href={qs(current, { page: String(data.page - 1) })}>Previous</Link> : <span className="rounded-lg border border-border px-3 py-1 opacity-40">Previous</span>}
            <span>Page {data.page} of {data.pages}</span>
            {data.page < data.pages ? <Link className="rounded-lg border border-border px-3 py-1 hover:border-gold" href={qs(current, { page: String(data.page + 1) })}>Next</Link> : <span className="rounded-lg border border-border px-3 py-1 opacity-40">Next</span>}
          </nav>
        </div>
      </Card>
    </>
  );
}
