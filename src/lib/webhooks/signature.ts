import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * HMAC-SHA256 webhook signatures in the form `t=<unix-seconds>,v1=<hex>` over
 * `${t}.${rawBody}`. The timestamp gives replay protection (tolerance window);
 * event-id de-duplication is handled separately by the receivers.
 */
export function signPayload(secret: string, rawBody: string, timestamp = Math.floor(Date.now() / 1000)): string {
  const sig = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  return `t=${timestamp},v1=${sig}`;
}

export type SignatureCheck = { ok: true; timestamp: number } | { ok: false; reason: string };

export function verifySignature(
  secret: string | undefined,
  rawBody: string,
  header: string | null,
  toleranceSeconds = 300,
  now = Math.floor(Date.now() / 1000),
): SignatureCheck {
  if (!secret) return { ok: false, reason: "Receiver secret not configured" };
  if (!header) return { ok: false, reason: "Missing signature header" };
  const parts = Object.fromEntries(
    header.split(",").map((kv) => {
      const i = kv.indexOf("=");
      return [kv.slice(0, i).trim(), kv.slice(i + 1).trim()];
    }),
  );
  const t = Number(parts.t);
  const v1 = parts.v1;
  if (!Number.isInteger(t) || !v1 || !/^[0-9a-f]{64}$/i.test(v1)) return { ok: false, reason: "Malformed signature header" };
  if (Math.abs(now - t) > toleranceSeconds) return { ok: false, reason: "Signature timestamp outside tolerance (possible replay)" };
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest();
  const given = Buffer.from(v1, "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: "Signature mismatch" };
  return { ok: true, timestamp: t };
}
