import { z } from "zod";
import { authed, body, json } from "@/lib/api";
import { blockPlots, bulkBlockSchema, bulkPriceSchema, unblockPlots, updatePlotPrices } from "@/lib/services/plots";

const schema = z.discriminatedUnion("action", [
  bulkBlockSchema.extend({ action: z.literal("block") }),
  bulkBlockSchema.extend({ action: z.literal("unblock") }),
  bulkPriceSchema.extend({ action: z.literal("price") }),
]);

export const POST = authed(async (req, ctx) => {
  const input = await body(req, schema);
  if (input.action === "block") return json(await blockPlots(ctx, input));
  if (input.action === "unblock") return json(await unblockPlots(ctx, input));
  return json(await updatePlotPrices(ctx, input));
});
