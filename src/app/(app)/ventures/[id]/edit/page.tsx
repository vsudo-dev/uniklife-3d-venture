import { DeleteVenture } from "@/components/ventures/delete-venture";
import Link from "next/link";
import { Box } from "lucide-react";
import { getBranding, requirePageContext } from "@/lib/auth/server";
import { can } from "@/lib/auth/context";
import { getVentureForEdit } from "@/lib/services/ventures";
import { BRAND_THEMES } from "@/lib/viewer-settings";
import { LinkButton, PageHeader } from "@/components/ui";
import { VentureForm, type VentureFormValues } from "@/components/ventures/venture-form";
import { ApprovalVerification } from "@/components/ventures/approval-verification";
import { VentureEditTabs } from "@/components/ventures/venture-edit-tabs";
import { ViewerSettingsForm } from "@/components/ventures/viewer-settings-form";

export const metadata = { title: "Edit venture" };

const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));

export default async function EditVenturePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePageContext("venture.update");
  const [{ venture: v, verifiedByName, plotCount, launchDate, settings, propertyType }, branding] = await Promise.all([getVentureForEdit(ctx, id), getBranding()]);
  const initial: VentureFormValues = {
    name: s(v.name), code: s(v.code), slug: s(v.slug), description: s(v.description), locationText: s(v.location_text), city: s(v.city),
    state: s(v.state), latitude: v.latitude === null ? "" : String(Number(v.latitude)), longitude: v.longitude === null ? "" : String(Number(v.longitude)),
    surveyNumbers: s(v.survey_numbers), approvalAuthority: s(v.approval_authority), approvalReference: s(v.approval_reference),
    totalLandArea: v.total_land_area === null ? "" : String(Number(v.total_land_area)), landAreaUnit: v.land_area_unit as VentureFormValues["landAreaUnit"],
    declaredTotalPlots: s(v.declared_total_plots), roadsDescription: s(v.roads_description), amenities: (v.amenities as string[]) ?? [],
    launchDate: launchDate ?? "",
    status: v.status as VentureFormValues["status"], isPublished: Boolean(v.is_published), holdMinutes: s(v.hold_minutes),
    bookingAmountPercent: v.booking_amount_percent === null ? "" : String(Number(v.booking_amount_percent)), viewerMode: v.viewer_mode as VentureFormValues["viewerMode"],
    propertyType, geofenceRadiusM: s(v.geofence_radius_m ?? 300),
  };
  const orgThemeName = BRAND_THEMES.find((t) => t.id === branding.theme)?.name ?? null;
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        eyebrow={<Link href={`/ventures/${id}`} className="hover:underline">{String(v.name)}</Link>}
        title="Edit venture"
        subtitle={`${plotCount} plots in inventory`}
        actions={
          <>
            <LinkButton href={`/ventures/${id}`} variant="outline"><Box size={16} aria-hidden /> Preview in 3D</LinkButton>
            <LinkButton href={`/ventures/${id}/assets`} variant="outline">Assets, CAD & 3D</LinkButton>
            {can(ctx, "venture.view") && <LinkButton href={`/plots?venture=${id}`} variant="outline">Plot inventory</LinkButton>}
          </>
        }
      />
      {can(ctx,"venture.delete") && <div className="mb-5"><DeleteVenture id={id} name={String(v.name)} /></div>}
      <VentureEditTabs ventureId={id} active="details" />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <VentureForm mode="edit" ventureId={id} initial={initial} isDemo={Boolean(v.is_demo)} />
        <div className="space-y-5 lg:sticky lg:top-4 lg:self-start">
          <ApprovalVerification
            ventureId={id}
            authority={(v.approval_authority as string) ?? null}
            reference={(v.approval_reference as string) ?? null}
            verified={Boolean(v.approval_verified)}
            verifiedBy={verifiedByName}
            verifiedAt={v.approval_verified_at ? new Date(v.approval_verified_at as string).toISOString() : null}
          />
        </div>
      </div>
      <div className="mt-6">
        <ViewerSettingsForm ventureId={id} initial={settings} orgThemeName={orgThemeName} />
      </div>
    </div>
  );
}
