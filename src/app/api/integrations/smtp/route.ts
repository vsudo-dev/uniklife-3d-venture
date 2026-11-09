import { z } from "zod";
import { authed,body,json } from "@/lib/api";
import { saveSmtp,smtpSchema,verifySmtp } from "@/lib/integration/delivery";
const schema=z.discriminatedUnion("action",[smtpSchema.extend({action:z.literal("save")}),z.object({action:z.literal("verify")})]);
export const POST=authed(async(req,ctx)=>{const input=await body(req,schema);return json(input.action==="save"?await saveSmtp(ctx,input):await verifySmtp(ctx));});
