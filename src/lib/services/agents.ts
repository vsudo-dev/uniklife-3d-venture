import { z } from "zod";
import { getDb } from "@/lib/db";
import { assertPermission,type AuthContext } from "@/lib/auth/context";
import { notFound } from "@/lib/errors";
import { writeAudit } from "@/lib/audit";
export const agentSchema=z.object({fullName:z.string().trim().min(2).max(160),phone:z.string().trim().regex(/^\+?\d{7,15}$/).nullable().optional(),email:z.string().email().nullable().optional(),linkedEmployeeId:z.string().uuid().nullable().optional(),reportingAgentId:z.string().uuid().nullable().optional(),commissionLevel:z.number().int().min(1).max(8).default(8)});
export interface AgentRow{id:string;agent_code:string;full_name:string;phone:string|null;email:string|null;linked_employee_id:string|null;employee_code:string|null;commission_level:number;status:string}
export async function listAgents(ctx:AuthContext){assertPermission(ctx,"staff.manage");return(await getDb()).query<AgentRow>("select a.*,e.employee_code from agents a left join employees e on e.id=a.linked_employee_id and e.organization_id=a.organization_id where a.organization_id=$1 order by a.agent_code",[ctx.organizationId]);}
export async function createAgent(ctx:AuthContext,input:z.infer<typeof agentSchema>){assertPermission(ctx,"staff.manage");const d=agentSchema.parse(input),db=await getDb();return db.transaction(async tx=>{
 if(d.linkedEmployeeId){const [e]=await tx.query("select id from employees where organization_id=$1 and id=$2",[ctx.organizationId,d.linkedEmployeeId]);if(!e)throw notFound("Employee");}
 if(d.reportingAgentId){const [a]=await tx.query("select id from agents where organization_id=$1 and id=$2",[ctx.organizationId,d.reportingAgentId]);if(!a)throw notFound("Reporting agent");}
 const [{number}]=await tx.query<{number:number}>("update organizations set next_agent_number=next_agent_number+1 where id=$1 returning next_agent_number-1 as number",[ctx.organizationId]);
 const code=`AGT-${String(number).padStart(5,"0")}`;
 const [row]=await tx.query<{id:string;agent_code:string}>("insert into agents(organization_id,agent_code,full_name,phone,email,linked_employee_id,reporting_agent_id,commission_level) values($1,$2,$3,$4,$5,$6,$7,$8) returning id,agent_code",[ctx.organizationId,code,d.fullName,d.phone??null,d.email??null,d.linkedEmployeeId??null,d.reportingAgentId??null,d.commissionLevel]);
 await writeAudit(tx,ctx,{action:"agent.created",entityType:"agent",entityId:row.id,summary:`Created agent ${code}`,metadata:{linked_employee_id:d.linkedEmployeeId??null}});return row;
});}
