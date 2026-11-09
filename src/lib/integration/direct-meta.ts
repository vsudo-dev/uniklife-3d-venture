import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { assertPermission, type AuthContext } from "@/lib/auth/context";
import { badRequest, notFound } from "@/lib/errors";
import { createNotification } from "@/lib/services/notifications";
import { writeAudit } from "@/lib/audit";
import { sanitizeText } from "./sanitize";

export const metaPageTokenName = (orgId: string) => `META_PAGE_TOKEN_${orgId.replace(/-/g, "").toUpperCase()}`;
export const metaFormSchema = z.object({ pageId: z.string().regex(/^\d{5,30}$/), formId: z.string().regex(/^\d{5,30}$/), ventureId: z.string().uuid(), enabled: z.boolean().default(true) });
export interface MetaForm { id: string; organization_id: string; venture_id: string; page_id: string; form_id: string; enabled: boolean; poll_since: string; poll_cursor: string | null; poll_window_since: string | null; poll_window_end: string | null; last_polled_at: string | null; last_error: string | null }
export async function listMetaForms(ctx: AuthContext) {
  assertPermission(ctx, "integration.manage");
  return (await getDb()).query<MetaForm>("select * from meta_lead_forms where organization_id = $1 order by created_at", [ctx.organizationId]);
}
export async function saveMetaForm(ctx: AuthContext, input: z.infer<typeof metaFormSchema>) {
  assertPermission(ctx, "integration.manage");
  const d = metaFormSchema.parse(input), db = await getDb();
  return db.transaction(async tx => {
    const [v] = await tx.query("select id from ventures where organization_id=$1 and id=$2", [ctx.organizationId,d.ventureId]);
    if (!v) throw notFound("Venture");
    const [existing] = await tx.query<{organization_id:string}>("select organization_id from meta_lead_forms where form_id=$1",[d.formId]);
    if (existing && existing.organization_id !== ctx.organizationId) throw badRequest("This form is already connected.");
    const [row] = await tx.query<{id:string}>(`insert into meta_lead_forms(organization_id,venture_id,page_id,form_id,enabled) values($1,$2,$3,$4,$5)
      on conflict(form_id) do update set venture_id=excluded.venture_id,page_id=excluded.page_id,enabled=excluded.enabled
      where meta_lead_forms.organization_id=excluded.organization_id returning id`, [ctx.organizationId,d.ventureId,d.pageId,d.formId,d.enabled]);
    if (!row) throw badRequest("Could not save this form.");
    await writeAudit(tx,ctx,{action:"meta.form_saved",entityType:"integration_connection",entityId:row.id,summary:"Saved direct Meta Lead Ads form mapping"});
    return row;
  });
}
export function verifyLeadChallenge(token: string | null) {
  const expected=process.env.META_LEAD_VERIFY_TOKEN;
  if (!token || !expected || expected.length<16) return false;
  return timingSafeEqual(createHash("sha256").update(token).digest(),createHash("sha256").update(expected).digest());
}
export async function queueMetaWebhook(payload: unknown) {
  const schema=z.object({object:z.literal("page"),entry:z.array(z.object({id:z.string(),changes:z.array(z.object({field:z.string(),value:z.object({leadgen_id:z.string().regex(/^\d+$/),form_id:z.string().regex(/^\d+$/),page_id:z.string().optional()}).passthrough()})).optional()}))});
  const parsed=schema.safeParse(payload);
  if (!parsed.success) return 0;
  const db=await getDb(); let queued=0;
  for(const entry of parsed.data.entry) for(const change of entry.changes??[]) {
    if(change.field!=="leadgen")continue;
    const [form]=await db.query<MetaForm>("select * from meta_lead_forms where page_id=$1 and form_id=$2 and enabled=true",[entry.id,change.value.form_id]);
    if(!form || (change.value.page_id && change.value.page_id!==form.page_id))continue;
    const rows=await db.query("insert into meta_leads(organization_id,form_connection_id,lead_id) values($1,$2,$3) on conflict(lead_id) do nothing returning id",[form.organization_id,form.id,change.value.leadgen_id]);queued+=rows.length;
  }
  return queued;
}
export interface GraphLead { id:string; form_id?:string; created_time?:string; field_data?:Array<{name:string;values:string[]}> }
export type MetaFetch = (path:string,token:string,params?:Record<string,string>)=>Promise<unknown>;
export const fetchMeta:MetaFetch = async(path,token,params={}) => {
  const url=new URL(`https://graph.facebook.com/${env.META_GRAPH_VERSION}/${path}`);
  for(const [k,v]of Object.entries(params))url.searchParams.set(k,v);
  const r=await fetch(url,{headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000),cache:"no-store"});
  if(!r.ok)throw new Error(`Meta request failed (HTTP ${r.status}). Check Page access and leads_retrieval permission.`);
  return r.json();
};
/** Store only opaque paging cursors; never persist Meta's next URL, which may contain a token. */
export async function pollMetaForm(form:MetaForm,request:MetaFetch=fetchMeta,reconcile=false) {
  const token=process.env[metaPageTokenName(form.organization_id)];
  if(!token)throw new Error(`Set ${metaPageTokenName(form.organization_id)} on the worker.`);
  const started=new Date();
  const since=new Date(form.poll_since).getTime();
  const floor=form.poll_window_since?Math.floor(new Date(form.poll_window_since).getTime()/1000):Math.max(0,Math.floor(since/1000)-(reconcile?86400:120));
  const end=form.poll_window_end?new Date(form.poll_window_end):started;
  const params:Record<string,string>={fields:"id,created_time,form_id",limit:"100",filtering:JSON.stringify([{field:"time_created",operator:"GREATER_THAN",value:floor},{field:"time_created",operator:"LESS_THAN",value:Math.floor(end.getTime()/1000)}])};
  if(form.poll_cursor)params.after=form.poll_cursor;
  const response=await request(`${form.form_id}/leads`,token,params) as {data?:GraphLead[];paging?:{cursors?:{after?:string};next?:string}};
  if(!Array.isArray(response.data))throw new Error("Meta returned an invalid leads response.");
  const db=await getDb();let queued=0;
  await db.transaction(async tx=>{
    for(const lead of response.data!) {
      if(!/^\d+$/.test(lead.id) || (lead.form_id && lead.form_id!==form.form_id))continue;
      const rows=await tx.query("insert into meta_leads(organization_id,form_connection_id,lead_id) values($1,$2,$3) on conflict(lead_id) do nothing returning id",[form.organization_id,form.id,lead.id]);queued+=rows.length;
    }
    const cursor=response.paging?.next?response.paging.cursors?.after:null;
    if(response.paging?.next && !cursor)throw new Error("Meta paging cursor is missing. Checkpoint retained.");
    await tx.query("update meta_lead_forms set poll_cursor=$2,poll_since=case when $2::text is null then $3 else poll_since end,poll_window_since=$4,poll_window_end=$5,last_polled_at=now(),last_error=null,poll_failures=0,next_poll_at=now()+interval '15 seconds' where id=$1",[form.id,cursor??null,end,cursor?new Date(floor*1000):null,cursor?end:null]);
  });
  return queued;
}
export function leadFields(lead:GraphLead) {
  const fields=Object.fromEntries((lead.field_data??[]).map(f=>[f.name,f.values?.[0]??""]));
  return {name:(fields.full_name||[fields.first_name,fields.last_name].filter(Boolean).join(" ")||"Meta lead").slice(0,120),phone:(fields.phone_number||fields.phone||"").replace(/[^+\d]/g,"").slice(0,20),email:fields.email?.slice(0,200)||null};
}
/** Lease + transactional deduplication: duplicate webhooks/polls never create duplicate enquiries. */
export async function importMetaLeads(organizationId:string,request:MetaFetch=fetchMeta) {
  const db=await getDb();let imported=0,failed=0;
  const rows=await db.transaction(tx=>tx.query<{id:string;lead_id:string;form_connection_id:string}>(`update meta_leads set status='processing',attempts=attempts+1,next_attempt_at=now()+interval '5 minutes'
    where id in(select id from meta_leads where organization_id=$1 and status in('pending','failed','processing') and next_attempt_at<=now() and attempts<8 order by created_at limit 50 for update skip locked) returning id,lead_id,form_connection_id`,[organizationId]));
  for(const item of rows)try {
    const [form]=await db.query<MetaForm>("select * from meta_lead_forms where id=$1 and organization_id=$2 and enabled=true",[item.form_connection_id,organizationId]);
    if(!form)throw new Error("Form disabled or missing.");
    const token=process.env[metaPageTokenName(organizationId)];if(!token)throw new Error("Page token is missing on worker.");
    const lead=await request(item.lead_id,token,{fields:"id,created_time,form_id,field_data"}) as GraphLead;
    if(lead.id!==item.lead_id || lead.form_id!==form.form_id)throw new Error("Meta lead does not match the mapped form.");
    const data=leadFields(lead);
    if(!/^\+?\d{7,15}$/.test(data.phone)) {
      await db.query("update meta_leads set status='needs_review',last_error='Lead has no valid phone number. Review it in Meta.' where id=$1",[item.id]);failed++;continue;
    }
    await db.transaction(async tx=>{
      const [locked]=await tx.query<{enquiry_id:string|null}>("select enquiry_id from meta_leads where id=$1 for update",[item.id]);
      if(locked.enquiry_id)return;
      const [enquiry]=await tx.query<{id:string}>(`insert into enquiries(organization_id,venture_id,name,phone,email,message,source)
        values($1,$2,$3,$4,$5,$6,'web') returning id`,[organizationId,form.venture_id,data.name,data.phone,data.email,`Direct Meta Lead Ads · ${item.lead_id}`]);
      await tx.query("update meta_leads set enquiry_id=$2,status='imported',imported_at=now(),last_error=null where id=$1",[item.id,enquiry.id]);
      const managers=await tx.query<{user_id:string}>("select user_id from organization_members where organization_id=$1 and status='active' and role in('org_admin','sales_manager')",[organizationId]);
      for(const manager of managers)await createNotification(tx,{organizationId,recipientUserId:manager.user_id,type:"system",title:"New lead received",body:`A new Meta lead has arrived: ${data.name}.`,link:`/enquiries?focus=${enquiry.id}`,dedupeKey:`meta:${item.lead_id}:${manager.user_id}`});
      await writeAudit(tx,{system:true,organizationId},{action:"meta.lead_imported",entityType:"enquiry",entityId:enquiry.id,summary:"New enquiry received directly from Meta",metadata:{lead_id:item.lead_id,form_id:form.form_id}});
      imported++;
    });
  }catch(error){failed++;await db.query("update meta_leads set status='failed',last_error=$2,next_attempt_at=now()+interval '5 minutes' where id=$1",[item.id,sanitizeText(error,{max:250})]);}
  return {imported,failed};
}
