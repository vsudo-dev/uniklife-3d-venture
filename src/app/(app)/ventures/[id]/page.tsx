import { DeleteVenture } from "@/components/ventures/delete-venture";
import Link from "next/link";
import Image from "next/image";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import { getBranding, requirePageContext } from "@/lib/auth/server";
import { can } from "@/lib/auth/context";
import { getVenture, getViewerData } from "@/lib/services/ventures";
import { Card, CardHeader, LinkButton, PageHeader, StatusBadge } from "@/components/ui";
import { VentureViewer } from "@/components/viewer/venture-viewer";

export const metadata = { title: "Venture" };

export default async function VentureDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePageContext();
  const [{ venture: v }, viewer, branding] = await Promise.all([getVenture(ctx, id), getViewerData(ctx, id), getBranding()]);
  const isCustomer = ctx.role === "customer";
  return (
    <>
      <PageHeader
        eyebrow={<Link href="/ventures" className="hover:underline">Ventures</Link>}
        title={String(v.name)}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={String(v.status)} />
            <span>{String(v.location_text ?? "")}</span>
            {v.approval_reference ? (
              v.approval_verified ? (
                <span className="inline-flex items-center gap-1 text-success" title={`Approval ref. ${String(v.approval_reference)} (verified by staff)`}>
                  <ShieldCheck size={14} /><span className="sm:hidden">Approval verified</span><span className="hidden sm:inline">Approval ref. {String(v.approval_reference)} (verified by staff)</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-warning" title={`Approval ref. ${String(v.approval_reference)} — user-provided, not yet verified`}>
                  <ShieldAlert size={14} /><span className="sm:hidden">Approval unverified</span><span className="hidden sm:inline">Approval ref. {String(v.approval_reference)} — user-provided, not yet verified</span>
                </span>
              )
            ) : null}
          </span>
        }
        actions={
          !isCustomer && (
            <>
              <LinkButton href={`/plots?venture=${id}`} variant="outline" className="max-sm:hidden">Plot inventory</LinkButton>
              {can(ctx, "venture.update") && <LinkButton href={`/ventures/${id}/edit`} variant="outline" className="max-sm:hidden">Edit venture</LinkButton>}
              {can(ctx,"venture.delete") && <DeleteVenture id={id} name={String(v.name)}/> }
            </>
          )
        }
      />
      {viewer.venture.layoutImage && <Card className="mb-4 p-4 text-sm"><strong>Imported PDF layout · {viewer.plots.length} plots</strong><p className="mt-1 text-muted">Tap a plot to inspect its inventory. Use + / − to zoom and drag a road/background area to move the plan. Outlines are approximate image navigation overlays; unconfirmed boundary measurements need survey review. Prices are not supplied in the source PDF.</p>{Boolean(v.layout_pdf_asset_id) && <a className="mt-2 inline-block font-semibold text-primary underline" href={`/api/ventures/${id}/assets/${v.layout_pdf_asset_id}`} target="_blank" rel="noreferrer">Open original layout PDF</a>}</Card>}
      {!viewer.venture.layoutImage && v.cover_image_asset_id && <Card className="mb-6 overflow-hidden">
        <CardHeader title="Venture layout reference" subtitle="Uploaded image. Interactive plot inventory is shown separately below." action={<a href={`/api/ventures/${id}/assets/${v.cover_image_asset_id}`} target="_blank" rel="noreferrer" className="text-sm font-semibold text-primary underline">Open full size</a>} />
        <div className="bg-white p-2 sm:p-4"><Image src={`/api/ventures/${id}/assets/${v.cover_image_asset_id}`} alt={`Uploaded layout reference for ${v.name}`} width={1600} height={900} unoptimized className="h-auto max-h-[80vh] w-full object-contain" /></div>
      </Card>}
      <VentureViewer
        initial={viewer}
        bookHref={isCustomer ? "/portal/book" : "/bookings/new"}
        siteVisitHref={isCustomer ? "/portal/site-visit" : "/site-visits/new"}
        brand={{ appName: branding.appName, logoUrl: branding.logoUrl, logoWidth: branding.logoWidth, logoHeight: branding.logoHeight }}
      />
    </>
  );
}
