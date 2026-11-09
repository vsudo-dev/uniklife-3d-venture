import { authed, body, json } from "@/lib/api";
import { applyDxfGeometry, dxfApplySchema } from "@/lib/services/plots";

export const runtime = "nodejs";

/** Geometry is recomputed on the server from the stored DXF; the client only sends the asset id and options. */
export const POST = authed<{ id: string }>(async (req, ctx, { id }) => json(await applyDxfGeometry(ctx, id, await body(req, dxfApplySchema))));
