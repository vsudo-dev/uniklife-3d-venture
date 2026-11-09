import { authed, body, json } from "@/lib/api";
import { getPlot, plotUpdateSchema, updatePlot } from "@/lib/services/plots";

export const GET = authed<{ id: string }>(async (_req, ctx, { id }) => json(await getPlot(ctx, id)));

export const PUT = authed<{ id: string }>(async (req, ctx, { id }) => json({ plot: await updatePlot(ctx, id, await body(req, plotUpdateSchema)) }));
