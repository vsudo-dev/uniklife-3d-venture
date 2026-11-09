import "server-only";
import nodemailer from "nodemailer";
import { z } from "zod";
import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { getDb } from "@/lib/db";
import { assertPermission, type AuthContext } from "@/lib/auth/context";
import { badRequest } from "@/lib/errors";
import { writeAudit } from "@/lib/audit";
import { decryptToken } from "@/lib/whatsapp/crypto";
import { sendMessage } from "@/lib/whatsapp/graph";

export const smtpPasswordName=(orgId:string)=>`SMTP_PASSWORD_${orgId.replace(/-/g,"").toUpperCase()}`;
export const smtpSchema=z.object({host:z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/),port:z.union([z.literal(465),z.literal(587)]),username:z.string().trim().min(1).max(160).refine(s=>!/[\r\n]/.test(s)),fromEmail:z.string().email(),fromName:z.string().trim().min(1).max(80).refine(s=>!/[\r\n]/.test(s)),enabled:z.boolean().default(false)});
export interface SmtpSettings {organization_id:string;host:string;port:number;username:string;from_email:string;from_name:string;enabled:boolean;verified_at:string|null;last_error:string|null}
// Restrict SMTP to publicly routed hosts; never connect to local/internal services.
function publicAddress(ip:string){
 if(isIP(ip)===6)return !/^(::|fc|fd|fe[89ab]|ff)/i.test(ip) && !ip.toLowerCase().includes("::ffff:");
 const [a,b]=ip.split(".").map(Number);return a>0&&a!==10&&a!==127&&a!==169&&a<224&&!(a===172&&b>=16&&b<=31)&&!(a===192&&(b===168||b===0))&&!(a===100&&b>=64&&b<=127)&&!(a===198&&(b===18||b===19));
}
export async function smtpTransport(s:SmtpSettings){
 const password=process.env[smtpPasswordName(s.organization_id)];if(!password)throw new Error("SMTP password variable is not set on worker.");
 const addresses=await lookup(s.host,{all:true});if(!addresses.length||addresses.some(a=>!publicAddress(a.address)))throw new Error("SMTP host must resolve to a public server.");
 // Pin the checked address and verify TLS against the original hostname.
 return nodemailer.createTransport({host:addresses[0].address,port:s.port,secure:s.port===465,requireTLS:s.port===587,tls:{servername:s.host,rejectUnauthorized:true},auth:{user:s.username,pass:password},connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000,disableFileAccess:true,disableUrlAccess:true});
}
export async function saveSmtp(ctx:AuthContext,input:z.infer<typeof smtpSchema>){
 assertPermission(ctx,"integration.manage");const d=smtpSchema.parse(input),db=await getDb();
 await db.transaction(async tx=>{await tx.query(`insert into organization_smtp(organization_id,host,port,username,from_email,from_name,enabled) values($1,$2,$3,$4,$5,$6,$7)
 on conflict(organization_id) do update set host=excluded.host,port=excluded.port,username=excluded.username,from_email=excluded.from_email,from_name=excluded.from_name,enabled=excluded.enabled,verified_at=null,updated_at=now()`,[ctx.organizationId,d.host,d.port,d.username,d.fromEmail,d.fromName,d.enabled]);await writeAudit(tx,ctx,{action:"smtp.settings_saved",entityType:"integration_connection",summary:"SMTP settings saved; connection test required"});});
 return {ok:true};
}
export async function verifySmtp(ctx:AuthContext){
 assertPermission(ctx,"integration.manage");const db=await getDb();const [s]=await db.query<SmtpSettings>("select * from organization_smtp where organization_id=$1",[ctx.organizationId]);if(!s)throw badRequest("Save SMTP settings first.");
 try{const t=await smtpTransport(s);await t.verify();t.close();await db.query("update organization_smtp set verified_at=now(),last_error=null where organization_id=$1",[ctx.organizationId]);return {ok:true};}
 catch{await db.query("update organization_smtp set verified_at=null,last_error='SMTP connection failed. Check host, port and app password.' where organization_id=$1",[ctx.organizationId]);throw badRequest("SMTP connection failed. Check host, port and app password.");}
}
/** At-most-once automatic attempt: an ambiguous send is marked unknown for review, never blindly retried. */
export async function processMessageDeliveries(organizationId:string){
 const db=await getDb();let sent=0,blocked=0;
 await db.query("update message_deliveries set status='unknown',last_error='Worker stopped during delivery; inspect provider before retrying.' where organization_id=$1 and status='processing' and next_attempt_at<now()",[organizationId]);
 const items=await db.transaction(tx=>tx.query<{id:string;notification_id:string;channel:string}>(`update message_deliveries set status='processing',attempts=attempts+1,next_attempt_at=now()+interval '5 minutes'
 where id in(select id from message_deliveries where organization_id=$1 and status='pending' order by created_at limit 30 for update skip locked) returning id,notification_id,channel`,[organizationId]));
 for(const item of items){let attempted=false;try{
  const [n]=await db.query<{title:string;body:string;email:string;phone:string|null;email_via_uniklife:boolean;whatsapp_via_uniklife:boolean}>(`select n.title,n.body,u.email,u.phone,p.email_via_uniklife,p.whatsapp_via_uniklife from notifications n join app_users u on u.id=n.recipient_user_id
   join organization_members m on m.user_id=u.id and m.organization_id=n.organization_id and m.status='active'
   join notification_preferences p on p.user_id=u.id and p.organization_id=n.organization_id
   where n.id=$1 and n.organization_id=$2 and u.status='active'`,[item.notification_id,organizationId]);
  if(!n||(item.channel==="smtp"?!n.email_via_uniklife:!n.whatsapp_via_uniklife))throw new Error("Recipient unavailable or channel not enabled.");
  let reference:string|null=null;
  if(item.channel==="smtp"){
   const [s]=await db.query<SmtpSettings>("select * from organization_smtp where organization_id=$1 and enabled=true and verified_at is not null",[organizationId]);if(!s)throw new Error("Configure and verify SMTP first.");
   const transport=await smtpTransport(s);attempted=true;
   try{const r=await transport.sendMail({from:{name:s.from_name,address:s.from_email},to:n.email,subject:n.title,text:n.body,messageId:`<${item.id}@uniklife-notifications.local>`});reference=r.messageId;}finally{transport.close();}
  }else{
   const [a]=await db.query<{id:string;phone_number_id:string;access_token_enc:string}>("select id,phone_number_id,access_token_enc from whatsapp_accounts where organization_id=$1 and status='connected' and webhook_subscribed=true order by connected_at desc limit 1",[organizationId]);
   if(!a||!n.phone||!/^\+?\d{8,15}$/.test(n.phone))throw new Error("Connect WhatsApp and add the recipient's international phone number first.");
   const template=process.env.WHATSAPP_ALERT_TEMPLATE;if(!template)throw new Error("Set WHATSAPP_ALERT_TEMPLATE to your approved two-parameter alert template.");
   const token=decryptToken(a.access_token_enc);attempted=true;
   const result=await sendMessage(token,a.phone_number_id,{kind:"template",to:n.phone,name:template,language:process.env.WHATSAPP_ALERT_LANGUAGE??"en_US",parameters:[n.title,n.body]});reference=result.messageId;
   await db.query("insert into whatsapp_events(organization_id,account_id,direction,wa_message_id,message_type,status) values($1,$2,'outbound',$3,'template','sent') on conflict do nothing",[organizationId,a.id,reference]);
  }
  await db.query("update message_deliveries set status='sent',external_reference=$2,last_error=null where id=$1",[item.id,reference]);sent++;
 }catch(error){blocked++;const message=attempted?"Delivery outcome uncertain. Inspect SMTP/Meta provider logs before retrying.":error instanceof Error?error.message:"Setup required.";await db.query("update message_deliveries set status=$2,last_error=$3 where id=$1",[item.id,attempted?"unknown":"blocked",message.slice(0,250)]);}}
 return {sent,blocked};
}
