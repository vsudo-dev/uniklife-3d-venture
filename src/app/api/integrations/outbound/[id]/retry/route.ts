import { authed, json } from "@/lib/api";
import { redeliverOutbound } from "@/lib/services/integration";

/** POST — manual retry of a failed / dead-letter event (resets to pending, same idempotency key). */
export const POST = authed<{ id: string }>(async (_req, ctx, { id }) => json(await redeliverOutbound(ctx, id, "retry")));
