import type { EventEnvelope } from "../events";

/**
 * PROPOSED / INTERNAL adapter contract. No UNIKLIFE.AI API documentation has been
 * provided, so nothing here describes a real UNIKLIFE.AI endpoint, field or auth
 * scheme. The MOCK connector is the default; the HTTP connector stays disabled
 * until the real interface is verified (see HttpConnector).
 */
export interface ConnectionRow {
  id: string;
  organization_id: string;
  provider: "uniklife";
  connection_type: "api" | "webhook" | "both";
  name: string;
  mode: "mock" | "live";
  is_enabled: boolean;
  destination_url: string | null;
  auth_type: "hmac" | "bearer" | "basic" | "api_key" | "custom_header";
  inbound_auth_type: "hmac" | "bearer" | "basic" | "api_key" | "custom_header";
  outbound_auth_header_name: string;
  inbound_auth_header_name: string;
  outbound_secret_env: string | null;
  inbound_secret_env: string | null;
  event_mappings: Record<string, unknown>;
  live_verified: boolean;
  live_verified_by: string | null;
  live_verified_at: Date | string | null;
  last_success_at: Date | string | null;
  last_error: string | null;
  created_at?: Date | string;
  updated_at?: Date | string;
}

export interface SendResult {
  ok: boolean;
  /** HTTP status (or a synthetic one for the mock). null when no response was received. */
  status: number | null;
  externalReference?: string;
  /** Sanitized response excerpt (≤ 500 chars). */
  excerpt?: string;
  error?: string;
}

export interface UniklifeConnector {
  readonly mode: "mock" | "live";
  send(envelope: EventEnvelope, connection: ConnectionRow): Promise<SendResult>;
}

/** Keys in event_mappings starting with "__" are connector options, not event-name mappings. */
export function isOptionKey(k: string): boolean {
  return k.startsWith("__");
}
