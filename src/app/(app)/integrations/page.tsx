import { requirePageContext } from "@/lib/auth/server";
import { getConnections, LIVE_CONFIRMATION_PHRASE } from "@/lib/services/integration";
import { PageHeader } from "@/components/ui";
import { IntegrationNav } from "@/components/integrations/integration-nav";
import { IntegrationConnections } from "@/components/integrations/integration-connections";
import AuditPage from "../audit/page";
import IntegrationLogsPage from "./logs/page";

export const metadata = { title: "Uniklife AI Integration" };
export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
 const ctx = await requirePageContext("integration.manage");
 const sp = await searchParams;
 const view = sp.tab === "webhook" ? "webhook" : "api";
 const connections = (await getConnections(ctx)).filter(c => c.connection_type === "both" || c.connection_type === view);
 return <><PageHeader title="Uniklife AI Integration" subtitle={view === "api" ? "API system and process: send app events to an external system." : "Webhook: receive updates sent by a connected system."} /><IntegrationNav />
 <IntegrationConnections key={view} view={view} connections={connections} canVerify={ctx.role === "org_admin" || ctx.role === "platform_admin"} phrase={LIVE_CONFIRMATION_PHRASE} />
 <section className="mt-8">{view === "api" ? <AuditPage searchParams={Promise.resolve({ ...sp, embedded: "1", entityType: "integration_connection" })} /> : <IntegrationLogsPage searchParams={Promise.resolve({ ...sp, embedded: "1", tab: "inbound" })} />}</section></>;
}
