import type { NextRequest } from "next/server";
import { errorResponse, json } from "@/lib/api";
import { handlePaymentWebhook } from "@/lib/services/payments";

/** POST /api/webhooks/payment — provider → app. Signature-verified; never trusts the browser. */
export async function POST(req: NextRequest) {
  try {
    const raw = await req.text();
    if (raw.length > 256 * 1024) return json({ error: "Payload too large" }, 413);
    const result = await handlePaymentWebhook(raw, req.headers.get("x-payment-signature"));
    return json(result.body, result.status);
  } catch (e) {
    return errorResponse(e);
  }
}
