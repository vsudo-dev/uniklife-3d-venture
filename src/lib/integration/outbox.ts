import type { Queryable } from "@/lib/db/types";
import type { OutboundEventType } from "./events";

/**
 * Transactional outbox: call inside the same transaction as the business change.
 * The dispatcher (dispatcher.ts) delivers rows asynchronously with retries.
 * Duplicate idempotency keys are ignored, so retried requests never double-emit.
 *
 * Loop prevention: changes applied FROM an inbound UNIKLIFE.AI webhook pass
 * `causedByWebhookEventId`; such events are recorded but never sent back.
 */
export async function enqueueOutboundEvent(
  q: Queryable,
  args: {
    organizationId: string;
    eventType: OutboundEventType;
    aggregateType: string;
    aggregateId: string | null;
    idempotencyKey: string;
    data: Record<string, unknown>;
    causedByWebhookEventId?: string | null;
    connectionId?: string;
  },
): Promise<void> {
  const connections = args.connectionId
    ? await q.query<{ id: string }>(
        `select id from integration_connections
          where id = $1 and organization_id = $2 and provider = 'uniklife' and is_enabled = true and connection_type in ('api', 'both')`,
        [args.connectionId, args.organizationId],
      )
    : await q.query<{ id: string }>(
        `select id from integration_connections
          where organization_id = $1 and provider = 'uniklife' and is_enabled = true and connection_type in ('api', 'both')
          order by created_at, id`,
        [args.organizationId],
      );
  const targets = connections.length ? connections : [{ id: null }];
  for (const [index, conn] of targets.entries()) {
    const status = !conn.id || args.causedByWebhookEventId ? "skipped" : "pending";
    const lastError = !conn.id
      ? "No enabled UNIKLIFE.AI API connection"
      : args.causedByWebhookEventId
        ? "Suppressed: caused by an inbound UNIKLIFE.AI webhook (loop prevention)"
        : null;
    await q.query(
      `insert into outbound_events (organization_id, connection_id, event_type, aggregate_type, aggregate_id, payload,
                                    idempotency_key, status, last_error, caused_by_webhook_event_id)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10)
       on conflict (idempotency_key) do nothing`,
      [
        args.organizationId,
        conn.id,
        args.eventType,
        args.aggregateType,
        args.aggregateId,
        args.data,
        index === 0 ? args.idempotencyKey : `${args.idempotencyKey}:${conn.id}`,
        status,
        lastError,
        args.causedByWebhookEventId ?? null,
      ],
    );
  }
}
