import { IntegrationNav } from "@/components/integrations/integration-nav";
import { requirePageContext } from "@/lib/auth/server";
import { listWhatsappAccounts, recentWhatsappEvents, whatsappSetup } from "@/lib/services/whatsapp";
import { PageHeader } from "@/components/ui";
import { WhatsappConnect } from "@/components/integrations/whatsapp-connect";
import { WhatsappKnowledge } from "@/components/integrations/whatsapp-knowledge";

export const metadata = { title: "WhatsApp Business (WABA)" };

export default async function WhatsappPage() {
  const ctx = await requirePageContext("integration.manage");
  const [accounts, events] = await Promise.all([listWhatsappAccounts(ctx), recentWhatsappEvents(ctx)]);
  return (
    <>
      <PageHeader title="WhatsApp" subtitle="Connect your business number directly to Meta." /><IntegrationNav /><WhatsappKnowledge />
      <div className="mt-6" /><WhatsappConnect setup={whatsappSetup()} accounts={accounts.map((a) => ({ ...a, connected_at: String(a.connected_at) }))} events={events.map((e) => ({ ...e, created_at: String(e.created_at) }))} />

    </>
  );
}
