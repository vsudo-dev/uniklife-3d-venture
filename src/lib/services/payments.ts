import { createNotification } from "./notifications";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { num } from "@/lib/db/types";
import type { AuthContext } from "@/lib/auth/context";
import { assertPermission } from "@/lib/auth/context";
import { badRequest, conflict, forbidden, notFound, unprocessable } from "@/lib/errors";
import { env, requireSecret } from "@/lib/env";
import { writeAudit } from "@/lib/audit";
import { enqueueOutboundEvent } from "@/lib/integration/outbox";
import { signPayload, verifySignature } from "@/lib/webhooks/signature";
import { db, requireIdempotencyKey, withTx } from "./common";
import { canSeeBooking, confirmBookingInternal } from "./bookings";

/**
 * Payment provider abstraction. Only the MOCK provider is implemented: every
 * transaction it creates is flagged is_simulated = true and shown as SIMULATED.
 * A real gateway (Razorpay/Stripe…) must be added and verified before taking money.
 */
export interface CheckoutSession {
  transactionId: string;
  providerReference: string;
  amount: number;
  checkoutUrl: string;
  simulated: boolean;
}

export async function initiatePayment(ctx: AuthContext, bookingId: string, idempotencyKey: string): Promise<CheckoutSession> {
  const key = requireIdempotencyKey(idempotencyKey);
  if (env.PAYMENT_PROVIDER !== "mock") throw unprocessable("No payment provider configured");
  return withTx(async (q) => {
    const [b] = await q.query<Record<string, unknown>>("select * from bookings where organization_id = $1 and id = $2 for update", [ctx.organizationId, bookingId]);
    if (!b || !canSeeBooking(ctx, b)) throw notFound("Booking");
    if (ctx.role !== "customer") assertPermission(ctx, "booking.create");
    const [existing] = await q.query<{ id: string; provider_reference: string; amount: string; status: string }>(
      "select id, provider_reference, amount, status from payment_transactions where organization_id = $1 and idempotency_key = $2",
      [ctx.organizationId, key],
    );
    if (existing) {
      return { transactionId: existing.id, providerReference: existing.provider_reference, amount: num(existing.amount), checkoutUrl: `/pay/mock/${existing.id}`, simulated: true };
    }
    if (b.status !== "payment_pending") throw conflict(`Booking is ${b.status}`);
    if (new Date(b.payment_due_at as string) <= new Date()) throw conflict("The payment window for this booking has elapsed");
    const [{ verified }] = await q.query<{ verified: string }>(
      "select coalesce(sum(amount),0) as verified from payment_transactions where booking_id = $1 and status = 'verified'", [bookingId],
    );
    const due = Math.round((num(b.booking_amount) - num(verified)) * 100) / 100;
    if (due <= 0) throw conflict("The advance has already been paid");
    // Only one open checkout at a time per booking.
    await q.query("update payment_transactions set status = 'failed', failure_reason = 'Superseded by a new checkout' where booking_id = $1 and status = 'pending'", [bookingId]);
    const ref = `mock_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
    const [t] = await q.query<{ id: string }>(
      `insert into payment_transactions (organization_id, booking_id, customer_id, provider, provider_reference, purpose, amount, currency, status, is_simulated, idempotency_key, created_by)
       values ($1,$2,$3,'mock',$4,'booking_amount',$5,$6,'pending',true,$7,$8) returning id`,
      [ctx.organizationId, bookingId, b.customer_id, ref, due, b.currency, key, ctx.user.id],
    );
    await writeAudit(q, ctx, { action: "payment.initiated", entityType: "payment", entityId: t.id, summary: `Simulated checkout for ${b.booking_number}: ${due}` });
    return { transactionId: t.id, providerReference: ref, amount: due, checkoutUrl: `/pay/mock/${t.id}`, simulated: true };
  });
}

export async function getTransactionForCheckout(ctx: AuthContext, transactionId: string) {
  const q = await db();
  const [t] = await q.query<Record<string, unknown>>(
    `select t.id, t.status, t.amount, t.currency, t.provider, t.provider_reference, t.is_simulated, t.failure_reason, t.booking_id,
            b.booking_number, b.status as booking_status, b.customer_id, b.organization_id, b.venture_id, b.credited_employee_id, b.requested_by
       from payment_transactions t join bookings b on b.id = t.booking_id
      where t.organization_id = $1 and t.id = $2`,
    [ctx.organizationId, transactionId],
  );
  if (!t || !canSeeBooking(ctx, t)) throw notFound("Payment");
  return t;
}

/**
 * MOCK GATEWAY: simulates the provider sending a signed webhook. It goes through
 * exactly the same signature verification and processing as a real webhook.
 */
export async function simulateMockGateway(ctx: AuthContext, transactionId: string, outcome: "success" | "failure") {
  if (env.PAYMENT_PROVIDER !== "mock") throw forbidden("Mock gateway is disabled");
  const t = await getTransactionForCheckout(ctx, transactionId);
  if (t.provider !== "mock") throw badRequest("Not a mock transaction");
  const event = {
    id: `evt_${randomUUID().replace(/-/g, "")}`,
    type: outcome === "success" ? "payment.succeeded" : "payment.failed",
    created: Math.floor(Date.now() / 1000),
    data: {
      provider: "mock",
      provider_reference: String(t.provider_reference),
      amount: num(t.amount),
      currency: String(t.currency),
      failure_reason: outcome === "failure" ? "Card declined (simulated)" : undefined,
    },
  };
  const raw = JSON.stringify(event);
  const signature = signPayload(requireSecret("PAYMENT_WEBHOOK_SECRET"), raw);
  return handlePaymentWebhook(raw, signature);
}

const paymentEventSchema = z.object({
  id: z.string().min(8).max(100),
  type: z.enum(["payment.succeeded", "payment.failed"]),
  created: z.number().int(),
  data: z.object({
    provider: z.enum(["mock"]),
    provider_reference: z.string().min(4).max(100),
    amount: z.number().positive(),
    currency: z.string().length(3),
    failure_reason: z.string().max(300).optional(),
  }),
});

export interface WebhookResult {
  status: number;
  body: Record<string, unknown>;
}

/** POST /api/webhooks/payment — signature-verified, schema-validated, de-duplicated, idempotent. */
export async function handlePaymentWebhook(rawBody: string, signatureHeader: string | null): Promise<WebhookResult> {
  const sig = verifySignature(requireSecret("PAYMENT_WEBHOOK_SECRET"), rawBody, signatureHeader);
  if (!sig.ok) return { status: 401, body: { error: sig.reason } };
  let parsed: z.infer<typeof paymentEventSchema>;
  try {
    parsed = paymentEventSchema.parse(JSON.parse(rawBody));
  } catch {
    return { status: 400, body: { error: "Invalid payload" } };
  }
  return withTx(async (q) => {
    const inserted = await q.query<{ id: string }>(
      `insert into webhook_events (source, external_event_id, event_type, payload, signature_valid, status)
       values ('payment', $1, $2, $3::jsonb, true, 'received') on conflict (source, external_event_id) do nothing returning id`,
      [parsed.id, parsed.type, parsed],
    );
    if (inserted.length === 0) {
      await q.query("update webhook_events set duplicate_count = duplicate_count + 1 where source = 'payment' and external_event_id = $1", [parsed.id]);
      return { status: 200, body: { received: true, duplicate: true } };
    }
    const webhookId = inserted[0].id;
    const finish = async (status: "processed" | "rejected" | "failed" | "ignored", error?: string, orgId?: string) => {
      await q.query("update webhook_events set status = $2, error = $3, organization_id = coalesce($4, organization_id), processed_at = now(), attempts = attempts + 1 where id = $1",
        [webhookId, status, error ?? null, orgId ?? null]);
    };
    const [t] = await q.query<Record<string, unknown>>(
      "select * from payment_transactions where provider = $1 and provider_reference = $2 for update",
      [parsed.data.provider, parsed.data.provider_reference],
    );
    if (!t) {
      await finish("rejected", "Unknown transaction");
      return { status: 200, body: { received: true, ignored: "unknown transaction" } };
    }
    const orgId = String(t.organization_id);
    if (Math.round(num(t.amount) * 100) !== Math.round(parsed.data.amount * 100) || t.currency !== parsed.data.currency) {
      await finish("rejected", "Amount/currency mismatch", orgId);
      await writeAudit(q, { system: true, organizationId: orgId, actorType: "webhook" }, {
        action: "payment.webhook_rejected", entityType: "payment", entityId: String(t.id), summary: "Amount/currency mismatch in payment webhook",
      });
      return { status: 200, body: { received: true, ignored: "amount mismatch" } };
    }
    const actor = { system: true as const, organizationId: orgId, actorType: "webhook" as const };
    if (parsed.type === "payment.failed") {
      if (t.status === "pending") {
        await q.query("update payment_transactions set status = 'failed', failure_reason = $2, last_event = $3::jsonb where id = $1", [t.id, parsed.data.failure_reason ?? "Payment failed", parsed]);
        await writeAudit(q, actor, { action: "payment.failed", entityType: "payment", entityId: String(t.id), summary: parsed.data.failure_reason ?? "Payment failed" });
      }
      await finish("processed", undefined, orgId);
      return { status: 200, body: { received: true, payment: "failed" } };
    }
    // payment.succeeded
    if (t.status === "pending" || t.status === "failed") {
      await q.query("update payment_transactions set status = 'verified', verified_at = now(), failure_reason = null, last_event = $2::jsonb where id = $1", [t.id, parsed]);
      await writeAudit(q, actor, { action: "payment.verified", entityType: "payment", entityId: String(t.id), summary: `Verified ${t.amount} (${t.is_simulated ? "SIMULATED" : "live"})` });
      await enqueueOutboundEvent(q, {
        organizationId: orgId, eventType: "payment.verified", aggregateType: "payment", aggregateId: String(t.id), idempotencyKey: `payment.verified:${t.id}`,
        data: { payment_id: t.id, booking_id: t.booking_id, amount: num(t.amount), currency: t.currency, provider: t.provider, simulated: t.is_simulated },
      });
    }
    const [b] = await q.query<{ status: string }>("select status from bookings where id = $1", [t.booking_id]);
    let confirmation: { confirmed: boolean; reason?: string } = { confirmed: false };
    if (b.status === "payment_pending") {
      confirmation = await confirmBookingInternal(q, String(t.booking_id), "payment_webhook", null);
    } else if (b.status === "expired" || b.status === "cancelled") {
      await writeAudit(q, actor, {
        action: "payment.refund_review_required", entityType: "payment", entityId: String(t.id),
        summary: `Payment verified for a ${b.status} booking — manual refund review required`,
      });
    }
    await finish("processed", confirmation.confirmed ? undefined : confirmation.reason, orgId);
    return { status: 200, body: { received: true, payment: "verified", bookingConfirmed: confirmation.confirmed } };
  });
}

export const offlinePaymentSchema = z.object({
  amount: z.coerce.number().positive(),
  reference: z.string().trim().min(3).max(100),
  method: z.enum(["bank_transfer", "cheque", "upi", "cash", "other"]),
  purpose: z.enum(["booking_amount", "installment", "balance"]).default("booking_amount"),
  note: z.string().trim().max(500).optional(),
  idempotencyKey: z.string(),
});

/** Staff record a real-world payment they have verified (bank statement, cleared cheque…). */
export async function recordOfflinePayment(ctx: AuthContext, bookingId: string, input: z.infer<typeof offlinePaymentSchema>) {
  assertPermission(ctx, "payment.record");
  const key = requireIdempotencyKey(input.idempotencyKey);
  return withTx(async (q) => {
    const [b] = await q.query<Record<string, unknown>>("select * from bookings where organization_id = $1 and id = $2 for update", [ctx.organizationId, bookingId]);
    if (!b || !canSeeBooking(ctx, b)) throw notFound("Booking");
    if (!["payment_pending", "confirmed"].includes(String(b.status))) throw conflict(`Booking is ${b.status}`);
    const [dup] = await q.query<{ id: string }>("select id from payment_transactions where organization_id = $1 and idempotency_key = $2", [ctx.organizationId, key]);
    if (dup) return { id: dup.id, replayed: true };
    const [{ verified }] = await q.query<{ verified: string }>("select coalesce(sum(amount),0) as verified from payment_transactions where booking_id = $1 and status = 'verified'", [bookingId]);
    if (num(verified) + input.amount > num(b.net_amount) + 0.001) throw badRequest("Payment exceeds the booking's net amount");
    const [t] = await q.query<{ id: string }>(
      `insert into payment_transactions (organization_id, booking_id, customer_id, provider, provider_reference, purpose, amount, currency, status,
                                         is_simulated, idempotency_key, verified_at, verified_by, created_by, last_event)
       values ($1,$2,$3,'offline',$4,$5,$6,$7,'verified',false,$8, now(), $9, $9, $10::jsonb) returning id`,
      [ctx.organizationId, bookingId, b.customer_id, `${input.method}:${input.reference}`, input.purpose, input.amount, b.currency, key, ctx.user.id, { method: input.method, note: input.note ?? null }],
    ).catch((e) => {
      if ((e as { code?: string }).code === "23505") throw conflict("This payment reference was already recorded");
      throw e;
    });
    await writeAudit(q, ctx, { action: "payment.offline_recorded", entityType: "payment", entityId: t.id, summary: `${input.method} ${input.reference}: ${input.amount}` });
    await enqueueOutboundEvent(q, {
      organizationId: ctx.organizationId, eventType: "payment.verified", aggregateType: "payment", aggregateId: t.id, idempotencyKey: `payment.verified:${t.id}`,
      data: { payment_id: t.id, booking_id: bookingId, amount: input.amount, provider: "offline", method: input.method, simulated: false },
    });
    const recipients=await q.query<{user_id:string}>("select user_id from organization_members where organization_id=$1 and status='active' and role in('org_admin','sales_manager')",[ctx.organizationId]);
    for(const r of recipients)await createNotification(q,{organizationId:ctx.organizationId,recipientUserId:r.user_id,type:"booking_update",title:"Payment received",body:`Payment of INR ${input.amount} recorded for booking ${b.booking_number}.`,bookingId,link:`/bookings/${bookingId}`,dedupeKey:`payment:${t.id}:${r.user_id}`});
    return { id: t.id, replayed: false };
  });
}

export async function listPayments(ctx: AuthContext, f: { status?: string } = {}) {
  assertPermission(ctx, "payment.view");
  const q = await db();
  const params: unknown[] = [ctx.organizationId];
  const where = ["t.organization_id = $1"];
  if (ctx.ventureIds !== null) {
    params.push(ctx.ventureIds);
    where.push(`b.venture_id = any($${params.length}::uuid[])`);
  }
  if (ctx.networkEmployeeIds !== null) {
    params.push(ctx.networkEmployeeIds, ctx.user.id);
    where.push(`(b.credited_employee_id = any($${params.length - 1}::uuid[]) or b.requested_by = $${params.length})`);
  }
  if (f.status) {
    params.push(f.status);
    where.push(`t.status = $${params.length}`);
  }
  return q.query<Record<string, unknown>>(
    `select t.id, t.provider, t.provider_reference, t.purpose, t.amount, t.currency, t.status, t.is_simulated, t.verified_at, t.failure_reason, t.created_at,
            b.id as booking_id, b.booking_number, c.full_name as customer_name
       from payment_transactions t join bookings b on b.id = t.booking_id join customers c on c.id = t.customer_id
      where ${where.join(" and ")} order by t.created_at desc limit 500`,
    params,
  );
}
