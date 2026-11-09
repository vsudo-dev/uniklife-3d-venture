import "server-only";
import { env } from "@/lib/env";
import { AppError, badRequest } from "@/lib/errors";

const base = () => `https://graph.facebook.com/${env.META_GRAPH_VERSION}`;

async function graph<T>(path: string, init: { method?: "GET" | "POST" | "DELETE"; token?: string; body?: unknown; query?: Record<string, string> } = {}): Promise<T> {
  const url = new URL(`${base()}/${path}`);
  for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers: { ...(init.token ? { authorization: `Bearer ${init.token}` } : {}), ...(init.body ? { "content-type": "application/json" } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: number } } & T;
  if (!res.ok) {
    // Meta error text can include ids but never our token; keep it short for the UI.
    throw new AppError(res.status >= 500 ? 502 : 400, "unprocessable", `Meta API: ${data.error?.message ?? `HTTP ${res.status}`}`);
  }
  return data;
}

export function metaConfigured() {
  return !!(env.META_APP_ID && env.META_APP_SECRET);
}

/** Embedded Signup returns a short-lived `code`; exchange it for the customer's business token. */
export async function exchangeSignupCode(code: string): Promise<string> {
  if (!metaConfigured()) throw badRequest("META_APP_ID / META_APP_SECRET are not configured on the server.");
  const r = await graph<{ access_token?: string }>("oauth/access_token", {
    query: { client_id: env.META_APP_ID!, client_secret: env.META_APP_SECRET!, code },
  });
  if (!r.access_token) throw badRequest("Meta did not return an access token.");
  return r.access_token;
}

export interface PhoneInfo { display_phone_number?: string; verified_name?: string; quality_rating?: string }
export const getPhoneInfo = (token: string, phoneNumberId: string) =>
  graph<PhoneInfo>(phoneNumberId, { token, query: { fields: "display_phone_number,verified_name,quality_rating" } });

/** Subscribes this app to the WABA so message + status webhooks are delivered to our callback URL. */
export const subscribeApp = (token: string, wabaId: string) => graph<{ success?: boolean }>(`${wabaId}/subscribed_apps`, { method: "POST", token });
export const unsubscribeApp = (token: string, wabaId: string) => graph<{ success?: boolean }>(`${wabaId}/subscribed_apps`, { method: "DELETE", token });

/** Registers the number for Cloud API use (Embedded Signup numbers usually need this once). */
export const registerPhone = (token: string, phoneNumberId: string, pin: string) =>
  graph<{ success?: boolean }>(`${phoneNumberId}/register`, { method: "POST", token, body: { messaging_product: "whatsapp", pin } });

export const listTemplates = (token: string, wabaId: string) =>
  graph<{ data?: Array<{ name: string; status: string; language: string; category: string }> }>(`${wabaId}/message_templates`, { token, query: { fields: "name,status,language,category", limit: "50" } });

export type OutboundMessage =
  | { kind: "template"; to: string; name: string; language: string; parameters?: string[] }
  | { kind: "text"; to: string; text: string };

/** Sends one message. Free-form text only works inside the 24h customer-service window; otherwise use a template. */
export async function sendMessage(token: string, phoneNumberId: string, m: OutboundMessage) {
  const common = { messaging_product: "whatsapp", to: m.to.replace(/\D/g, "") };
  const body = m.kind === "template"
    ? { ...common, type: "template", template: { name: m.name, language: { code: m.language }, ...(m.parameters?.length ? { components: [{ type: "body", parameters: m.parameters.map(text => ({ type: "text", text })) }] } : {}) } }
    : { ...common, type: "text", text: { body: m.text, preview_url: false } };
  const r = await graph<{ messages?: Array<{ id: string }> }>(`${phoneNumberId}/messages`, { method: "POST", token, body });
  return { messageId: r.messages?.[0]?.id ?? null };
}
