import { z } from "zod";
import { authed, body, json, rateLimit } from "@/lib/api";
import { simulateMockGateway } from "@/lib/services/payments";

/** MOCK gateway only: produces a signed provider webhook for a simulated outcome. */
export const POST = authed<{ id: string }>(async (req, ctx, { id }) => {
  rateLimit(`mockpay:${ctx.user.id}`, 20, 60_000);
  const { outcome } = await body(req, z.object({ outcome: z.enum(["success", "failure"]) }));
  const result = await simulateMockGateway(ctx, id, outcome);
  return json({ gatewayResponse: result.body, simulated: true }, result.status);
});
