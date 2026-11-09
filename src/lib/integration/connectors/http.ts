import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { AppError } from "@/lib/errors";
import { env, secretFromEnvName } from "@/lib/env";
import { outboundAuthHeaders } from "../auth";
import type { EventEnvelope } from "../events";
import { liveRuntimeEnabled, sanitizeText } from "../sanitize";
import type { ConnectionRow, SendResult, UniklifeConnector } from "./types";

/**
 * GENERIC HTTP connector — PROPOSED, NOT VERIFIED AGAINST UNIKLIFE.AI.
 *
 * The request shape (JSON envelope, Idempotency-Key / X-Uniklife-* headers, HMAC
 * `t=…,v1=…` signature or Bearer token) is OUR proposal. It must be confirmed
 * with UNIKLIFE.AI before use. The connector refuses to run unless ALL of:
 *   - env UNIKLIFE_LIVE_ENABLED=true (runtime kill-switch),
 *   - connection.mode = 'live' and connection.live_verified = true (set only by an org admin).
 */
export function integrationDisabled(message: string) {
  return new AppError(503, "integration_disabled", message);
}

function isPrivateIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 10 || a === 127 || a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) || // CGNAT
      a >= 224 // multicast / reserved
    );
  }
  if (v === 6) {
    const s = ip.toLowerCase().replace(/^\[|\]$/g, "");
    if (s === "::1" || s === "::") return true;
    if (s.startsWith("fe80") || s.startsWith("fc") || s.startsWith("fd")) return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
    if (mapped) return isPrivateIp(mapped[1]);
    return false;
  }
  return false;
}

/**
 * Static destination checks (used when saving settings and before every send):
 * https only, no credentials in the URL, and — in production — no loopback /
 * private / link-local hosts (SSRF protection).
 */
export function assertSafeDestination(rawUrl: string, production = env.NODE_ENV === "production"): URL {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new AppError(400, "validation_error", "Destination URL is not a valid URL");
  }
  if (u.protocol !== "https:") throw new AppError(400, "validation_error", "Destination URL must use https://");
  if (u.username || u.password) throw new AppError(400, "validation_error", "Destination URL must not contain credentials");
  if (production) {
    const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || isPrivateIp(host)) {
      throw new AppError(400, "validation_error", "Destination URL must be a public host");
    }
  }
  return u;
}

/** DNS check at send time (production only): every resolved address must be public. */
async function assertResolvesPublic(u: URL) {
  if (env.NODE_ENV !== "production") return;
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return; // already checked statically
  const addrs = await lookup(host, { all: true });
  if (addrs.length === 0 || addrs.some((a) => isPrivateIp(a.address))) {
    throw new AppError(400, "validation_error", "Destination resolves to a non-public address");
  }
}

export class HttpConnector implements UniklifeConnector {
  readonly mode = "live" as const;

  async send(envelope: EventEnvelope, connection: ConnectionRow): Promise<SendResult> {
    if (!liveRuntimeEnabled()) throw integrationDisabled("Live UNIKLIFE.AI delivery is disabled (UNIKLIFE_LIVE_ENABLED is not true)");
    if (connection.mode !== "live" || !connection.live_verified) {
      throw integrationDisabled("Connection is not verified for live delivery");
    }
    if (!connection.destination_url) throw integrationDisabled("No destination URL configured");
    const url = assertSafeDestination(connection.destination_url);
    await assertResolvesPublic(url);

    const secret = secretFromEnvName(connection.outbound_secret_env);
    if (!secret) {
      return { ok: false, status: null, error: `Outbound secret env var ${connection.outbound_secret_env ?? "(none)"} is not set` };
    }
    const raw = JSON.stringify(envelope);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), env.UNIKLIFE_HTTP_TIMEOUT_MS);
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "User-Agent": "uniklife-3d-venture/1",
        "Idempotency-Key": envelope.idempotency_key,
        "X-Uniklife-Event": envelope.mapped_type ?? envelope.type,
        ...outboundAuthHeaders(connection.auth_type, secret, raw, connection.outbound_auth_header_name),
      };
      const res = await fetch(url, { method: "POST", headers, body: raw, signal: controller.signal, redirect: "manual", cache: "no-store" });
      const text = await readLimited(res, 4096);
      const excerpt = sanitizeText(text, { secrets: [secret] });
      const ok = res.status >= 200 && res.status < 300;
      return {
        ok,
        status: res.status,
        excerpt,
        externalReference: ok ? extractReference(text, connection) : undefined,
        error: ok ? undefined : `Destination responded ${res.status}`,
      };
    } catch (e) {
      const aborted = (e as Error)?.name === "AbortError";
      return { ok: false, status: null, error: aborted ? `Timed out after ${env.UNIKLIFE_HTTP_TIMEOUT_MS} ms` : sanitizeText(e, { secrets: [secret] }) };
    } finally {
      clearTimeout(timer);
    }
  }
}

async function readLimited(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    total += value.byteLength;
  }
  await reader.cancel().catch(() => undefined);
  return new TextDecoder().decode(Buffer.concat(chunks).subarray(0, maxBytes));
}

/**
 * The response field holding the destination's record reference is UNKNOWN.
 * It is read only when an admin configures `event_mappings.__response_reference_field`
 * (a top-level JSON key) after verifying the real response format.
 */
function extractReference(text: string, connection: ConnectionRow): string | undefined {
  const field = connection.event_mappings?.__response_reference_field;
  if (typeof field !== "string" || !/^[A-Za-z0-9_]{1,64}$/.test(field)) return undefined;
  try {
    const v = (JSON.parse(text) as Record<string, unknown>)[field];
    return typeof v === "string" || typeof v === "number" ? String(v).slice(0, 200) : undefined;
  } catch {
    return undefined;
  }
}
