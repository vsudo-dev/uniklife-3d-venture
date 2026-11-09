import { timingSafeEqual } from "node:crypto";
import { signPayload, verifySignature } from "@/lib/webhooks/signature";

export const INTEGRATION_AUTH_TYPES = ["hmac", "bearer", "basic", "api_key", "custom_header"] as const;
export type IntegrationAuthType = (typeof INTEGRATION_AUTH_TYPES)[number];

export function validAuthHeaderName(name: string): boolean {
  return /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,64}$/.test(name);
}

export function outboundAuthHeaders(
  type: IntegrationAuthType,
  secret: string,
  rawBody: string,
  headerName: string,
): Record<string, string> {
  if (type === "hmac") return { "X-Uniklife-Signature": signPayload(secret, rawBody) };
  if (type === "bearer") return { Authorization: `Bearer ${secret}` };
  if (type === "basic") {
    if (!secret.includes(":")) throw new Error("Basic auth secret must be stored as username:password");
    return { Authorization: `Basic ${Buffer.from(secret).toString("base64")}` };
  }
  if (!validAuthHeaderName(headerName)) throw new Error("Invalid API key header name");
  return { [headerName]: secret };
}

function safeEqual(expectedValue: string, receivedValue: string | null): boolean {
  if (receivedValue === null) return false;
  const expected = Buffer.from(expectedValue);
  const received = Buffer.from(receivedValue);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export function verifyIntegrationAuth(input: {
  type: IntegrationAuthType;
  secret: string | undefined;
  rawBody: string;
  signature: string | null;
  authorization: string | null;
  headers: Headers;
  headerName: string;
  toleranceSeconds: number;
}): { ok: true } | { ok: false; reason: string } {
  if (!input.secret) return { ok: false, reason: "Receiver secret not configured" };
  if (input.type === "hmac") {
    const result = verifySignature(input.secret, input.rawBody, input.signature, input.toleranceSeconds);
    return result.ok ? { ok: true } : { ok: false, reason: result.reason };
  }
  if (input.type === "bearer") {
    const token = input.authorization?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? null;
    return safeEqual(input.secret, token) ? { ok: true } : { ok: false, reason: "Invalid bearer token" };
  }
  if (input.type === "basic") {
    const received = input.authorization?.match(/^Basic\s+([A-Za-z0-9+/]+={0,2})$/i)?.[1];
    if (!received) return { ok: false, reason: "Missing or malformed basic credentials" };
    const decoded = Buffer.from(received, "base64").toString("utf8");
    if (!decoded.includes(":")) return { ok: false, reason: "Malformed basic credentials" };
    return safeEqual(input.secret, decoded) ? { ok: true } : { ok: false, reason: "Invalid basic credentials" };
  }
  if (!validAuthHeaderName(input.headerName)) return { ok: false, reason: "Invalid API key header name" };
  return safeEqual(input.secret, input.headers.get(input.headerName)) ? { ok: true } : { ok: false, reason: "Invalid API key" };
}
