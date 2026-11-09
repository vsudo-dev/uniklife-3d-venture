import Link from "next/link";
import { requirePageContext } from "@/lib/auth/server";
import { AppError } from "@/lib/errors";
import { getVenture } from "@/lib/services/ventures";
import { listAssets } from "@/lib/services/assets";
import { previewDxfImport } from "@/lib/services/plots";
import type { ImportPreview } from "@/lib/cad/import";
import { Card, EmptyState, LinkButton, Notice, PageHeader } from "@/components/ui";
import { DxfImportPreview } from "@/components/ventures/dxf-import-preview";

export const metadata = { title: "DXF geometry import" };

export default async function DxfImportPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ asset?: string }> }) {
  const { id } = await params;
  const { asset } = await searchParams;
  const ctx = await requirePageContext("plot.manage");
  const [{ venture: v }, assets] = await Promise.all([getVenture(ctx, id), listAssets(ctx, id)]);
  const dxfs = assets.filter((a) => a.kind === "cad_dxf");
  const selected = dxfs.find((a) => a.id === asset) ?? null;
  let preview: ImportPreview | null = null;
  let error: string | null = null;
  if (selected) {
    try {
      preview = await previewDxfImport(ctx, id, { assetId: selected.id });
    } catch (e) {
      if (e instanceof AppError && e.status < 500) error = e.message;
      else throw e;
    }
  }
  return (
    <>
      <PageHeader
        eyebrow={<Link href={`/ventures/${id}/assets`} className="hover:underline">{String(v.name)} · Assets</Link>}
        title="DXF geometry import"
        subtitle={selected ? `Preview of ${selected.file_name}` : "Choose an uploaded DXF drawing."}
        actions={<LinkButton href={`/ventures/${id}/assets`} variant="outline">Back to assets</LinkButton>}
      />
      {dxfs.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-2 text-sm">
          {dxfs.map((d) => (
            <Link key={d.id} href={`/ventures/${id}/assets/import?asset=${d.id}`} className={`rounded-full border px-3 py-1 ${d.id === selected?.id ? "border-gold bg-gold-soft font-semibold" : "border-border"}`}>
              {d.file_name}
            </Link>
          ))}
        </div>
      )}
      {!selected ? (
        <Card>
          <EmptyState title={dxfs.length ? "Select a DXF above" : "No DXF uploaded"} action={<LinkButton href={`/ventures/${id}/assets`}>Upload a DXF</LinkButton>}>
            Export the layout from your CAD tool as ASCII DXF (R12 or R2000) with each plot as a closed polyline and its plot number as a TEXT label inside it.
          </EmptyState>
        </Card>
      ) : error ? (
        <Notice tone="danger" title="This DXF could not be read">{error}</Notice>
      ) : preview ? (
        <DxfImportPreview ventureId={id} assetId={selected.id} preview={preview} />
      ) : null}
    </>
  );
}
