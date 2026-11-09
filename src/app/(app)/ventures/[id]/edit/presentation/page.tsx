import Link from "next/link";
import { Box } from "lucide-react";
import { getBranding, requirePageContext } from "@/lib/auth/server";
import { getVentureForEdit } from "@/lib/services/ventures";
import { BRAND_THEMES } from "@/lib/viewer-settings";
import { LinkButton, PageHeader } from "@/components/ui";
import { VentureEditTabs } from "@/components/ventures/venture-edit-tabs";
import { ViewerSettingsForm } from "@/components/ventures/viewer-settings-form";

export const metadata = { title: "Viewer & presentation" };

export default async function VenturePresentationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePageContext("venture.update");
  const [{ venture: v, settings }, branding] = await Promise.all([getVentureForEdit(ctx, id), getBranding()]);
  const orgThemeName = BRAND_THEMES.find((t) => t.id === branding.theme)?.name ?? null;
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        eyebrow={<Link href={`/ventures/${id}`} className="hover:underline">{String(v.name)}</Link>}
        title="Viewer & presentation"
        subtitle="Theme, patterns and 3D viewing modes for this venture. Changes apply the next time the 3D view is opened."
        actions={<LinkButton href={`/ventures/${id}`} variant="gold"><Box size={16} aria-hidden /> Preview in 3D</LinkButton>}
      />
      <VentureEditTabs ventureId={id} active="presentation" />
      <ViewerSettingsForm ventureId={id} initial={settings} orgThemeName={orgThemeName} />
    </div>
  );
}
