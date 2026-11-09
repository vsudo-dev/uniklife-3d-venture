import { authed, body, json } from "@/lib/api";
import { createVenture, listVentures, ventureInputSchema } from "@/lib/services/ventures";

export const GET = authed(async (_req, ctx) => json({ ventures: await listVentures(ctx) }));

export const POST = authed(async (req, ctx) => {
  const input = await body(req, ventureInputSchema);
  const venture = await createVenture(ctx, input);
  return json({ id: venture.id, venture }, 201);
});
