import { authed, json } from "@/lib/api";
import { redeliverOutbound } from "@/lib/services/integration";

/** POST — replay a delivered event with the SAME idempotency key (receivers must de-duplicate). */
export const POST = authed<{ id: string }>(async (_req, ctx, { id }) => json(await redeliverOutbound(ctx, id, "replay")));
