import { z } from "zod";
import { authed, body, json } from "@/lib/api";
import { initiatePayment } from "@/lib/services/payments";

/** Starts a (simulated) checkout for the booking's outstanding advance. */
export const POST = authed<{ id: string }>(async (req, ctx, { id }) => {
  const { idempotencyKey } = await body(req, z.object({ idempotencyKey: z.string() }));
  return json(await initiatePayment(ctx, id, idempotencyKey), 201);
});
