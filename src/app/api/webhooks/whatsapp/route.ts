import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { verifyMetaSignature } from "@/lib/whatsapp/crypto";
import { ingestWhatsappWebhook } from "@/lib/services/whatsapp";

const MAX_BYTES = 1_000_000;
const reply = (body: unknown, status: number) => {
  const res = NextResponse.json(body, { status });
  res.headers.set("Cache-Control", "no-store");
  return res;
};

/** GET — Meta's one-time callback verification (hub.challenge). */
export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const expected = env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  const got = p.get("hub.verify_token") ?? "";
  const ok = !!expected && expected.length >= 16 && got.length === expected.length && timingSafeEqual(Buffer.from(got), Buffer.from(expected));
  if (p.get("hub.mode") === "subscribe" && ok) return new NextResponse(p.get("hub.challenge") ?? "", { status: 200, headers: { "content-type": "text/plain" } });
  return reply({ error: "Verification failed" }, 403);
}

/** POST — message + status events. Rejected unless X-Hub-Signature-256 matches the raw body (HMAC with the app secret). */
export async function POST(req: Request) {
  try {
    if (Number(req.headers.get("content-length") ?? "0") > MAX_BYTES) return reply({ error: "Payload too large" }, 413);
    const raw = await req.text();
    if (!verifyMetaSignature(raw, req.headers.get("x-hub-signature-256"), env.META_APP_SECRET)) return reply({ error: "Invalid signature" }, 401);
    let payload: unknown;
    try { payload = JSON.parse(raw); } catch { return reply({ error: "Invalid JSON" }, 400); }
    const stored = await ingestWhatsappWebhook(payload);
    return reply({ ok: true, stored }, 200);
  } catch (e) {
    console.error("[whatsapp-webhook] unhandled:", e instanceof Error ? e.name : "error");
    return reply({ error: "Internal error" }, 500);
  }
}
