import { z } from "zod";
import type { AuthContext } from "@/lib/auth/context";
import { assertPermission } from "@/lib/auth/context";
import { writeAudit } from "@/lib/audit";
import { badRequest, notFound } from "@/lib/errors";
import { env } from "@/lib/env";
import { db } from "./common";
import { decryptToken, encryptToken } from "@/lib/whatsapp/crypto";
import { exchangeSignupCode, getPhoneInfo, listTemplates, registerPhone, sendMessage, subscribeApp, unsubscribeApp } from "@/lib/whatsapp/graph";

export interface WhatsappAccountView {
  id: string; waba_id: string; phone_number_id: string; display_phone_number: string | null; verified_name: string | null;
  quality_rating: string | null; status: string; webhook_subscribed: boolean; last_error: string | null; connected_at: string;
}

export function whatsappSetup() {
  const missing = [!env.META_APP_ID && "META_APP_ID", !env.META_APP_SECRET && "META_APP_SECRET", !env.META_EMBEDDED_SIGNUP_CONFIG_ID && "META_EMBEDDED_SIGNUP_CONFIG_ID", (!env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || env.WHATSAPP_WEBHOOK_VERIFY_TOKEN.length<16) && "WHATSAPP_WEBHOOK_VERIFY_TOKEN", (!env.WHATSAPP_TOKEN_KEY || env.WHATSAPP_TOKEN_KEY.length<32) && "WHATSAPP_TOKEN_KEY"].filter(Boolean) as string[];
  return {configured: missing.length===0,missing,appId:env.META_APP_ID??null,configId:env.META_EMBEDDED_SIGNUP_CONFIG_ID??null,graphVersion:env.META_GRAPH_VERSION,callbackUrl:`${env.APP_BASE_URL.replace(/\/$/, "")}/api/webhooks/whatsapp`};
}

const COLS = "id, waba_id, phone_number_id, display_phone_number, verified_name, quality_rating, status, webhook_subscribed, last_error, connected_at";

export async function listWhatsappAccounts(ctx: AuthContext): Promise<WhatsappAccountView[]> {
  assertPermission(ctx, "integration.manage");
  const q = await db();
  return q.query<WhatsappAccountView>(`select ${COLS} from whatsapp_accounts where organization_id = $1 and status <> 'disconnected' order by connected_at desc`, [ctx.organizationId]);
}

export async function recentWhatsappEvents(ctx: AuthContext, limit = 25) {
  assertPermission(ctx, "integration.manage");
  const q = await db();
  return q.query<{ id: string; direction: string; counterparty: string | null; message_type: string | null; status: string | null; created_at: string }>(
    "select id, direction, counterparty, message_type, status, created_at from whatsapp_events where organization_id = $1 order by created_at desc limit $2",
    [ctx.organizationId, limit],
  );
}

export const connectSchema = z.object({
  code: z.string().min(10).max(2000),
  wabaId: z.string().regex(/^\d{5,25}$/),
  phoneNumberId: z.string().regex(/^\d{5,25}$/),
});

/** Completes Embedded Signup: code → business token (encrypted at rest), subscribe webhooks, read number details. */
export async function connectWhatsapp(ctx: AuthContext, input: z.infer<typeof connectSchema>) {
  assertPermission(ctx, "integration.manage");
  const token = await exchangeSignupCode(input.code);
  let info: Awaited<ReturnType<typeof getPhoneInfo>> = {};
  let subscribed = false;
  let lastError: string | null = null;
  try { info = await getPhoneInfo(token, input.phoneNumberId); } catch (e) { lastError = (e as Error).message; }
  try { await subscribeApp(token, input.wabaId); subscribed = true; } catch (e) { lastError = (e as Error).message; }
  // Best effort: numbers added through Embedded Signup are normally registered already.
  await registerPhone(token, input.phoneNumberId, String(100000 + Math.floor(Math.random() * 900000))).catch(() => undefined);

  const q = await db();
  const [row] = await q.query<{ id: string }>(
    `insert into whatsapp_accounts (organization_id, waba_id, phone_number_id, display_phone_number, verified_name, quality_rating, status, access_token_enc, webhook_subscribed, last_error, connected_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     on conflict (organization_id, phone_number_id) do update set waba_id = excluded.waba_id, display_phone_number = excluded.display_phone_number,
       verified_name = excluded.verified_name, quality_rating = excluded.quality_rating, status = excluded.status, access_token_enc = excluded.access_token_enc,
       webhook_subscribed = excluded.webhook_subscribed, last_error = excluded.last_error, connected_by = excluded.connected_by, connected_at = now()
     returning id`,
    [ctx.organizationId, input.wabaId, input.phoneNumberId, info.display_phone_number ?? null, info.verified_name ?? null, info.quality_rating ?? null,
      subscribed ? "connected" : "error", encryptToken(token), subscribed, lastError, ctx.user.id],
  );
  await writeAudit(q, ctx, { action: "whatsapp.connected", entityType: "integration", entityId: row.id, summary: `Connected WhatsApp number ${info.display_phone_number ?? input.phoneNumberId}`, metadata: { waba_id: input.wabaId, phone_number_id: input.phoneNumberId, subscribed } });
  return { id: row.id, subscribed, warning: lastError };
}

async function loadAccount(ctx: AuthContext, id: string) {
  const q = await db();
  const [a] = await q.query<{ id: string; waba_id: string; phone_number_id: string; access_token_enc: string | null }>(
    "select id, waba_id, phone_number_id, access_token_enc from whatsapp_accounts where organization_id = $1 and id = $2 and status <> 'disconnected'", [ctx.organizationId, id]);
  if (!a) throw notFound("WhatsApp account");
  if (!a.access_token_enc) throw badRequest("This account has no stored token. Reconnect it.");
  return { q, a, token: decryptToken(a.access_token_enc) };
}

export const testSendSchema = z.object({
  accountId: z.string().uuid(),
  to: z.string().regex(/^\+?\d{8,15}$/, "Enter the number with country code, e.g. 919876543210"),
  template: z.string().regex(/^[a-z0-9_]{1,512}$/).default("hello_world"),
  language: z.string().regex(/^[a-z]{2}(_[A-Z]{2})?$/).default("en_US"),
});

/** Sends an approved template (default Meta's `hello_world`) — the standard connectivity check. */
export async function sendWhatsappTest(ctx: AuthContext, input: z.infer<typeof testSendSchema>) {
  assertPermission(ctx, "integration.manage");
  const { q, a, token } = await loadAccount(ctx, input.accountId);
  const { messageId } = await sendMessage(token, a.phone_number_id, { kind: "template", to: input.to, name: input.template, language: input.language });
  await q.query(
    "insert into whatsapp_events (organization_id, account_id, direction, wa_message_id, counterparty, message_type, status) values ($1,$2,'outbound',$3,$4,'template','sent') on conflict do nothing",
    [ctx.organizationId, a.id, messageId, input.to.replace(/\D/g, "").replace(/^(\d{2})\d+(\d{2})$/, "$1******$2")],
  );
  await writeAudit(q, ctx, { action: "whatsapp.test_sent", entityType: "integration", entityId: a.id, summary: `Sent WhatsApp template "${input.template}"`, metadata: { message_id: messageId } });
  return { messageId };
}

export async function whatsappTemplates(ctx: AuthContext, accountId: string) {
  assertPermission(ctx, "integration.manage");
  const { a, token } = await loadAccount(ctx, accountId);
  return (await listTemplates(token, a.waba_id)).data ?? [];
}

export async function disconnectWhatsapp(ctx: AuthContext, accountId: string) {
  assertPermission(ctx, "integration.manage");
  const { q, a, token } = await loadAccount(ctx, accountId);
  await unsubscribeApp(token, a.waba_id).catch(() => undefined);
  await q.query("update whatsapp_accounts set status = 'disconnected', access_token_enc = null, webhook_subscribed = false where id = $1 and organization_id = $2", [a.id, ctx.organizationId]);
  await writeAudit(q, ctx, { action: "whatsapp.disconnected", entityType: "integration", entityId: a.id, summary: "Disconnected WhatsApp number" });
}

/** Stores verified webhook deliveries (messages + statuses). Routed by phone_number_id; PII kept minimal (masked number, no body). */
export async function ingestWhatsappWebhook(payload: unknown): Promise<number> {
  const q = await db();
  let stored = 0;
  const entries = ((payload as { entry?: unknown[] })?.entry ?? []) as Array<{ changes?: Array<{ field?: string; value?: Record<string, unknown> }> }>;
  for (const entry of entries) {
    for (const ch of entry.changes ?? []) {
      const v = ch.value ?? {};
      const phoneId = (v.metadata as { phone_number_id?: string } | undefined)?.phone_number_id;
      if (!phoneId) continue;
      const [acc] = await q.query<{ id: string; organization_id: string }>("select id, organization_id from whatsapp_accounts where phone_number_id = $1 and status <> 'disconnected'", [phoneId]);
      if (!acc) continue;
      const mask = (n?: string) => (n ? n.replace(/\D/g, "").replace(/^(\d{2})\d+(\d{2})$/, "$1******$2") : null);
      for (const m of (v.messages as Array<{ id: string; from?: string; type?: string }> | undefined) ?? []) {
        const r = await q.query("insert into whatsapp_events (organization_id, account_id, direction, wa_message_id, counterparty, message_type) values ($1,$2,'inbound',$3,$4,$5) on conflict do nothing returning id", [acc.organization_id, acc.id, m.id, mask(m.from), m.type ?? null]);
        stored += r.length;
      }
      for (const s of (v.statuses as Array<{ id: string; recipient_id?: string; status?: string }> | undefined) ?? []) {
        const r = await q.query("insert into whatsapp_events (organization_id, account_id, direction, wa_message_id, counterparty, status) values ($1,$2,'status',$3,$4,$5) on conflict do nothing returning id", [acc.organization_id, acc.id, s.id, mask(s.recipient_id), s.status ?? null]);
        stored += r.length;
      }
      if (ch.field === "account_update" || ch.field === "phone_number_quality_update") {
        await q.query("insert into whatsapp_events (organization_id, account_id, direction, status, payload) values ($1,$2,'account',$3,$4::jsonb)", [acc.organization_id, acc.id, ch.field, JSON.stringify({ event: (v as { event?: string }).event ?? null })]);
        stored++;
      }
    }
  }
  return stored;
}
