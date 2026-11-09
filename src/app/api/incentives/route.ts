import { authed,body,json } from "@/lib/api";
import { assertPermission } from "@/lib/auth/context";
import { getDb } from "@/lib/db";
import { incentiveSchema } from "@/lib/commissions/incentives";
import { writeAudit } from "@/lib/audit";
export const PUT=authed(async(req,ctx)=>{assertPermission(ctx,"commission.plan_manage");const d=await body(req,incentiveSchema),db=await getDb();await db.transaction(async tx=>{await tx.query("insert into incentive_policies(organization_id,audience,config) values($1,$2,$3::jsonb) on conflict(organization_id,audience) do update set config=excluded.config,updated_at=now()",[ctx.organizationId,d.audience,d]);await writeAudit(tx,ctx,{action:"incentive.policy_saved",entityType:"commission_plan",summary:`Saved ${d.audience} incentive calculation policy; no payouts created`,after:d});});return json({ok:true});});
