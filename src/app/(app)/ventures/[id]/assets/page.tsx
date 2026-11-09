import Link from "next/link";
import { requirePageContext } from "@/lib/auth/server";
import { can } from "@/lib/auth/context";
import { env } from "@/lib/env";
import { getVenture } from "@/lib/services/ventures";
import { listAssets } from "@/lib/services/assets";
import { getMeshMapping } from "@/lib/services/plots";
import { LinkButton, Notice, PageHeader } from "@/components/ui";
import { AssetManager } from "@/components/ventures/asset-manager";
import { MeshMapping } from "@/components/ventures/mesh-mapping";

export const metadata = { title: "Venture assets" };

export default async function VentureAssetsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePageContext("venture.update");
  const [{ venture: v }, assets, mapping] = await Promise.all([getVenture(ctx, id), listAssets(ctx, id), getMeshMapping(ctx, id)]);
  const canManagePlots = can(ctx, "plot.manage");
  return (
    <>
      <PageHeader
        eyebrow={<Link href={`/ventures/${id}`} className="hover:underline">{String(v.name)}</Link>}
        title="Assets, CAD & 3D"
        subtitle="Upload venture images, the layout PDF, CAD drawings and a GLB model; import plot outlines from DXF and map 3D meshes to plots."
        actions={
          <>
            <LinkButton href={`/ventures/${id}/edit`} variant="outline">Edit venture</LinkButton>
            <LinkButton href={`/ventures/${id}`} variant="outline">Open 3D viewer</LinkButton>
          </>
        }
      />
      <div className="mb-5">
        <Notice tone="warning" title="CAD import is an aid, not a survey">
          Plot outlines imported from DXF drawings must be checked against the approved survey drawings. DWG files are archived only —
          DWG cannot be parsed directly; export to DXF (R12/R2000 ASCII) from your CAD tool and upload the DXF.
        </Notice>
      </div>
      <div className="space-y-5">
        <AssetManager
          ventureId={id}
          assets={assets.map((a) => ({ ...a, created_at: new Date(a.created_at).toISOString() }))}
          roles={{ coverImage: (v.cover_image_asset_id as string) ?? null, layoutPdf: (v.layout_pdf_asset_id as string) ?? null, model: (v.model_asset_id as string) ?? null }}
          maxUploadMb={env.MAX_UPLOAD_MB}
          canManagePlots={canManagePlots}
        />
        <MeshMapping ventureId={id} rows={mapping.plots} modelUrl={mapping.modelUrl} viewerMode={mapping.venture.viewerMode} canEdit={canManagePlots} />
      </div>
    </>
  );
}
