import "server-only";
import { getDb } from "@/lib/db";
import { processOutbox } from "./dispatcher";
import { importMetaLeads,pollMetaForm,type MetaForm } from "./direct-meta";
import { processMessageDeliveries } from "./delivery";
import { processDueReminders } from "@/lib/services/notifications";
import { processPushQueue } from "@/lib/push";
import { sanitizeText } from "./sanitize";

export async function runSyncCycle(organizationId:string,source="worker"){
 const db=await getDb();
 await db.query("update integration_sync_runs set status='failed',finished_at=now(),details=$2::jsonb where organization_id=$1 and status='running' and started_at<now()-interval '10 minutes'",[organizationId,{reason:"Worker lease expired; review provider outcomes before replay."}]);
 const [run]=await db.query<{id:string}>("insert into integration_sync_runs(organization_id,source,status) values($1,$2,'running') on conflict do nothing returning id",[organizationId,source]);
 if(!run)return {skipped:true};
 try{
  const details:Record<string,unknown>={};let hasErrors=false;
  const [prior]=await db.query<{started_at:string}>("select started_at from integration_sync_runs where organization_id=$1 and details->>'reconciliation'='true' and status='completed' order by started_at desc limit 1",[organizationId]);
  const reconcile=!prior || Date.now()-new Date(prior.started_at).getTime()>=900000;
  details.reconciliation=reconcile;
  const forms=await db.query<MetaForm>("select * from meta_lead_forms where organization_id=$1 and enabled=true and next_poll_at<=now()",[organizationId]);
  let queued=0;
  for(const form of forms)try{queued+=await pollMetaForm(form,undefined,reconcile);}catch(error){hasErrors=true;await db.query("update meta_lead_forms set last_error=$2,poll_failures=poll_failures+1,next_poll_at=now()+(least(3600,30*power(2,least(poll_failures,7))) * interval '1 second') where id=$1",[form.id,sanitizeText(error,{max:250})]);}
  const imports=await importMetaLeads(organizationId);
  hasErrors ||= imports.failed>0;
  details.meta={forms:forms.length,queued,...imports,lookback:reconcile?"24h recovery scan":"checkpoint + 2m overlap"};
  const outbox=process.env.SYNC_GENERIC_API_ENABLED === "true" ? await processOutbox({organizationId,limit:100}) : {claimed:0,delivered:0,failed:0};
  details.outbox={claimed:outbox.claimed,delivered:outbox.delivered,failed:outbox.failed};
  details.messages=await processMessageDeliveries(organizationId);
  await db.query("update integration_sync_runs set status=$2,finished_at=now(),processed=$3,details=$4::jsonb where id=$1",[run.id,hasErrors||outbox.failed?"failed":"completed",imports.imported+outbox.claimed,details]);
  return {id:run.id,details};
 }catch(error){await db.query("update integration_sync_runs set status='failed',finished_at=now(),details=$2::jsonb where id=$1",[run.id,{error:sanitizeText(error,{max:250})}]);throw error;}
}
export async function runWorkerPass(){
 const db=await getDb();
 await processDueReminders();
 const orgs=await db.query<{id:string}>("select id from organizations where status='active'");
 for(const org of orgs)try{await runSyncCycle(org.id);}catch{console.error("Sync cycle failed; inspect stored run logs.");}
 await processPushQueue();
}
