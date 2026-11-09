import { requirePageContext } from "@/lib/auth/server";
import { getDb } from "@/lib/db";
import { calculateIncentive,defaultIncentive,incentiveSchema } from "@/lib/commissions/incentives";
import { Card,CardHeader } from "@/components/ui";
import { IncentiveEditor } from "./incentive-editor";
export async function PeopleIncentives({audience}:{audience:"employee"|"agent"}){
 const ctx=await requirePageContext("commission.plan_manage"),db=await getDb();
 const [stored]=await db.query<{config:unknown}>("select config from incentive_policies where organization_id=$1 and audience=$2",[ctx.organizationId,audience]);
 const parsed=incentiveSchema.safeParse(stored?.config);const policy=parsed.success?parsed.data:defaultIncentive(audience);
 const rows=audience==="employee"?await db.query<{employee_code:string;full_name:string;commission_level:number|null;commission_eligible:boolean;sales:string[]}>(`select e.employee_code,e.full_name,e.commission_level,e.commission_eligible,
 coalesce(json_agg(bp.net_amount order by b.confirmed_at,b.id,bp.id) filter(where bp.id is not null),'[]') as sales
 from employees e left join bookings b on b.credited_employee_id=e.id and b.organization_id=e.organization_id and b.status in('confirmed','completed')
 and b.confirmed_at >= (date_trunc('month',now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')
 and b.confirmed_at < ((date_trunc('month',now() at time zone 'Asia/Kolkata')+interval '1 month') at time zone 'Asia/Kolkata')
 left join booking_plots bp on bp.booking_id=b.id and bp.organization_id=e.organization_id
 where e.organization_id=$1 group by e.id order by e.employee_code`,[ctx.organizationId]):[];
 return <div className="space-y-5"><IncentiveEditor initial={policy}/>{audience==="employee"?<Card><CardHeader title="This month’s employee incentive estimates" subtitle="Actual confirmed/completed plot sales in India calendar time. Estimates before tax and payout approval; cancelled bookings do not qualify."/><div className="overflow-auto"><table className="table"><thead><tr><th>Employee</th><th>Plots</th><th>Level</th><th>Estimated incentive</th></tr></thead><tbody>{rows.map(r=>{const sales=Array.isArray(r.sales)?r.sales:[];const amount=r.commission_level&&r.commission_eligible?calculateIncentive(policy,r.commission_level,sales.map(n=>({netPaise:Math.round(Number(n)*100)}))).payoutPaise:0;return <tr key={r.employee_code}><td>{r.employee_code} · {r.full_name}</td><td>{sales.length}</td><td>{r.commission_level??"Unassigned"}</td><td>₹{(amount/100).toLocaleString("en-IN")}</td></tr>;})}</tbody></table></div></Card>:<Card className="p-5 text-sm text-muted">Agent rates start at zero until you enter them. These agent calculation policies are separate from the existing employee-based commission ledger. Agent sale attribution and payout approval must be connected before this policy can produce payable entries. Linking an AGT ID to an EMP ID does not grant login permissions or automatically create a second payout.</Card>}</div>;
}
