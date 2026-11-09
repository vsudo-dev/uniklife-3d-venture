import { requirePageContext } from "@/lib/auth/server";
import { getMapSettings } from "@/lib/services/maps";
import { PageHeader } from "@/components/ui";
import { IntegrationNav } from "@/components/integrations/integration-nav";
import { MapsSettings } from "@/components/integrations/maps-settings";
import { MapsKnowledge } from "@/components/integrations/maps-knowledge";

export const metadata = { title: "Google Maps" };

export default async function MapsIntegrationPage() {
  const ctx = await requirePageContext("integration.manage");
  const settings = await getMapSettings(ctx);
  return (
    <>
      <PageHeader title="Google Maps" subtitle="Show customer site visits on Google Maps, or use the built-in stationary GIS fence." />
      <IntegrationNav />
      <MapsSettings settings={settings} />
      <div className="mt-6"><MapsKnowledge /></div>
    </>
  );
}
