import { authed,body,json } from "@/lib/api";
import { agentSchema,createAgent } from "@/lib/services/agents";
export const POST=authed(async(req,ctx)=>json(await createAgent(ctx,await body(req,agentSchema)),201));
