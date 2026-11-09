import { authed, body, json } from "@/lib/api";
import { getVenture, updateVenture, deleteVenture, ventureInputSchema } from "@/lib/services/ventures";

export const GET = authed<{ id: string }>(async (_req, ctx, { id }) => json(await getVenture(ctx, id)));

export const PUT = authed<{ id: string }>(async (req, ctx, { id }) => {
  const input = await body(req, ventureInputSchema);
  const venture = await updateVenture(ctx, id, input);
  return json({ id, venture });
});

export const DELETE=authed<{id:string}>(async(_req,ctx,{id})=>json(await deleteVenture(ctx,id)));
