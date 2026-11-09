import { authed, body, json } from "@/lib/api";
import { dxfSourceSchema, previewDxfImport } from "@/lib/services/plots";

export const runtime = "nodejs";

export const POST = authed<{ id: string }>(async (req, ctx, { id }) => {
  const { assetId } = await body(req, dxfSourceSchema);
  return json(await previewDxfImport(ctx, id, { assetId }));
});
