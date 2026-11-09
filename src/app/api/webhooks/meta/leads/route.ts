import { NextResponse } from "next/server";
import { verifyMetaSignature } from "@/lib/whatsapp/crypto";
import { queueMetaWebhook, verifyLeadChallenge } from "@/lib/integration/direct-meta";
export const runtime="nodejs";
export async function GET(req:Request){const u=new URL(req.url);if(u.searchParams.get("hub.mode")!=="subscribe"||!verifyLeadChallenge(u.searchParams.get("hub.verify_token")))return new Response("Verification failed",{status:403});return new Response(u.searchParams.get("hub.challenge")??"");}
export async function POST(req:Request){
 if(Number(req.headers.get("content-length")??0)>262144)return new Response("Too large",{status:413});
 const raw=await req.text();if(Buffer.byteLength(raw)>262144)return new Response("Too large",{status:413});
 if(!verifyMetaSignature(raw,req.headers.get("x-hub-signature-256"),process.env.META_APP_SECRET))return new Response("Invalid signature",{status:403});
 try{return NextResponse.json({queued:await queueMetaWebhook(JSON.parse(raw))});}catch{return NextResponse.json({error:"Unable to accept delivery. Meta may retry."},{status:500});}
}
