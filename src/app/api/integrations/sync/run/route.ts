import { authed,json,rateLimit } from "@/lib/api";
import { assertPermission } from "@/lib/auth/context";
import { runSyncCycle } from "@/lib/integration/sync-worker";
export const maxDuration=60;
export const POST=authed(async(_req,ctx)=>{assertPermission(ctx,"integration.manage");rateLimit(`sync:${ctx.organizationId}`,2,60000);return json(await runSyncCycle(ctx.organizationId,"manual"));});
