import { getDb } from "@/lib/db";
import type { EventEnvelope } from "../events";
import type { ConnectionRow, SendResult, UniklifeConnector } from "./types";

/**
 * MOCK UNIKLIFE.AI receiver. Records every delivery in `mock_uniklife_records`
 * and NEVER contacts a real CRM. It de-duplicates on the idempotency key the way
 * a well-behaved real receiver should, so replays never create a second record.
 *
 * Simulated failures (for demos/tests):
 *  - `event_mappings.__mock_fail_next = N` on the connection: the next N sends fail
 *    (the counter is decremented atomically on each simulated failure), or
 *  - `mockConnectorTestHooks.failNext(N)` (process-local, tests only).
 */
let processFailures = 0;

export const mockConnectorTestHooks = {
  failNext(n: number) {
    processFailures = Math.max(0, Math.floor(n));
  },
  reset() {
    processFailures = 0;
  },
  get pending() {
    return processFailures;
  },
};

export class MockConnector implements UniklifeConnector {
  readonly mode = "mock" as const;

  async send(envelope: EventEnvelope, connection: ConnectionRow): Promise<SendResult> {
    const q = await getDb();
    if (processFailures > 0) {
      processFailures--;
      return { ok: false, status: 503, error: "Simulated mock failure (test hook)", excerpt: '{"error":"simulated_unavailable"}' };
    }
    const failed = await q.query<{ left: number }>(
      `update integration_connections
          set event_mappings = jsonb_set(event_mappings, '{__mock_fail_next}', to_jsonb(((event_mappings->>'__mock_fail_next')::int - 1)))
        where id = $1 and jsonb_typeof(event_mappings->'__mock_fail_next') = 'number' and (event_mappings->>'__mock_fail_next')::int > 0
        returning (event_mappings->>'__mock_fail_next')::int as left`,
      [connection.id],
    );
    if (failed.length > 0) {
      return { ok: false, status: 503, error: `Simulated mock failure (__mock_fail_next, ${failed[0].left} remaining)`, excerpt: '{"error":"simulated_unavailable"}' };
    }

    const inserted = await q.query<{ id: string }>(
      `insert into mock_uniklife_records (organization_id, idempotency_key, event_type, payload)
       values ($1, $2, $3, $4::jsonb) on conflict (idempotency_key) do nothing returning id`,
      [envelope.organization_id, envelope.idempotency_key, envelope.mapped_type ?? envelope.type, envelope],
    );
    let id = inserted[0]?.id;
    let duplicate = false;
    if (!id) {
      const [existing] = await q.query<{ id: string }>("select id from mock_uniklife_records where idempotency_key = $1", [envelope.idempotency_key]);
      id = existing?.id;
      duplicate = true;
    }
    const ref = `MOCK-${String(id ?? "unknown").replace(/-/g, "").slice(0, 12).toUpperCase()}`;
    return {
      ok: true,
      status: duplicate ? 200 : 201,
      externalReference: ref,
      excerpt: JSON.stringify({ accepted: true, duplicate, reference: ref, mock: true }),
    };
  }
}
