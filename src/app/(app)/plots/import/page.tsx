import Link from "next/link";
import { requirePageContext } from "@/lib/auth/server";
import { plotFilterOptions } from "@/lib/services/plots";
import { listAssets } from "@/lib/services/assets";
import { aiExtractionAvailable } from "@/lib/inventory/pdf-ai";
import { Card, EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { CsvImport } from "@/components/plots/csv-import";

export const metadata = { title: "Import plots" };

export default async function PlotImportPage({ searchParams }: { searchParams: Promise<{ venture?: string }> }) {
  const ctx = await requirePageContext("plot.manage");
  const { venture } = await searchParams;
  const { ventures } = await plotFilterOptions(ctx, null);
  const selected = ventures.find((v) => v.id === venture) ?? null;
  const pdfs = selected ? (await listAssets(ctx, selected.id)).filter((a) => a.kind === "layout_pdf").map((a) => ({ id: a.id, name: a.file_name })) : [];
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        eyebrow={<Link href={selected ? `/plots?venture=${selected.id}` : "/plots"} className="hover:underline">Plot inventory</Link>}
        title="Upload PDF / CSV inventory"
        subtitle="Preview and validate before anything is written. Imports are audited."
        actions={
          <>
            {selected && <a href={`/api/plots/export?venture=${selected.id}`} className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 py-2 text-sm font-semibold hover:border-gold">Export current CSV</a>}
            <LinkButton href={selected ? `/plots?venture=${selected.id}` : "/plots"} variant="outline">Back to inventory</LinkButton>
          </>
        }
      />
      <form action="/plots/import" className="card mb-5 flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-[240px] flex-1">
          <label className="label" htmlFor="imp-venture">Venture</label>
          <select id="imp-venture" name="venture" defaultValue={selected?.id ?? ""} className="input">
            <option value="" disabled>Choose a venture…</option>
            {ventures.map((v) => <option key={v.id} value={v.id}>{v.name} ({v.code})</option>)}
          </select>
        </div>
        <button className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white">Select</button>
      </form>
      {selected ? (
        <CsvImport key={selected.id} ventureId={selected.id} ventureName={selected.name} pdfs={pdfs} aiAvailable={aiExtractionAvailable()} />
      ) : (
        <Card><EmptyState title="Choose a venture to import into" /></Card>
      )}
    </div>
  );
}
