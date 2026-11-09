import { authed, json } from "@/lib/api";
import { getViewerData } from "@/lib/services/ventures";

export const GET = authed<{ id: string }>(async (_req, ctx, { id }) => json(await getViewerData(ctx, id)));
