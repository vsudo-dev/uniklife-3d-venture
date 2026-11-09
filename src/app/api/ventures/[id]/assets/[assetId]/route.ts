import { authed, json } from "@/lib/api";
import { contentDisposition, deleteVentureAsset, getAssetForDownload } from "@/lib/services/assets";

export const runtime = "nodejs";

/** Serves asset bytes only after authorization (see getAssetForDownload). */
export const GET = authed<{ id: string; assetId: string }>(async (_req, ctx, { id, assetId }) => {
  const a = await getAssetForDownload(ctx, id, assetId);
  return new Response(new Uint8Array(a.data), {
    status: 200,
    headers: {
      "Content-Type": a.mimeType,
      "Content-Length": String(a.data.length),
      "Content-Disposition": contentDisposition(a.disposition, a.fileName),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=300",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
});

export const DELETE = authed<{ id: string; assetId: string }>(async (_req, ctx, { id, assetId }) => json(await deleteVentureAsset(ctx, id, assetId)));
