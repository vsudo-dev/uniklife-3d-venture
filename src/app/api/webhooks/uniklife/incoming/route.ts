import { NextResponse } from "next/server";
import { handleUniklifeWebhook, INBOUND_MAX_BYTES } from "@/lib/integration/inbound";

/**
 * POST /api/webhooks/uniklife/incoming — PROPOSED receiver for UNIKLIFE.AI → app events.
 * Authenticated (HMAC signature or bearer token), connection-scoped (X-Uniklife-Connection),
 * de-duplicated and loop-protected. See src/lib/integration/inbound.ts.
 */
function reply(body: unknown, status: number) {
  const res = NextResponse.json(body, { status });
  res.headers.set("Cache-Control", "no-store");
  return res;
}

export async function POST(req: Request) {
  try {
    const declared = Number(req.headers.get("content-length") ?? "0");
    if (declared > INBOUND_MAX_BYTES) return reply({ error: "Payload too large" }, 413);
    const raw = await req.text();
    const result = await handleUniklifeWebhook(raw, {
      connectionId: req.headers.get("x-uniklife-connection"),
      signature: req.headers.get("x-uniklife-signature"),
      authorization: req.headers.get("authorization"),
      headers: req.headers,
    });
    return reply(result.body, result.status);
  } catch (e) {
    console.error("[uniklife-webhook] unhandled:", e instanceof Error ? e.name : "error");
    return reply({ error: "Internal error" }, 500);
  }
}
