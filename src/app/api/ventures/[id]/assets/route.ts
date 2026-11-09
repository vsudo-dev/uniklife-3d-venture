import { authed, json, rateLimit } from "@/lib/api";
import { badRequest } from "@/lib/errors";
import { ASSET_KINDS, listAssets, maxUploadBytes, uploadVentureAsset, type UploadKind } from "@/lib/services/assets";

export const runtime = "nodejs";

export const GET = authed<{ id: string }>(async (_req, ctx, { id }) => json({ assets: await listAssets(ctx, id) }));

/** multipart/form-data: `file` + `kind` (image | layout_pdf | model_glb | cad_dxf | cad_dwg). Type is verified by magic bytes. */
export const POST = authed<{ id: string }>(async (req, ctx, { id }) => {
  rateLimit(`upload:${ctx.user.id}`, 30, 60_000);
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > maxUploadBytes() + 64 * 1024) throw badRequest("File exceeds the upload limit");
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw badRequest("Expected a multipart/form-data upload");
  }
  const kind = String(form.get("kind") ?? "") as UploadKind;
  if (!ASSET_KINDS.includes(kind)) throw badRequest("Choose what kind of file this is");
  const file = form.get("file");
  if (!file || typeof file === "string") throw badRequest("No file was uploaded");
  if (file.size > maxUploadBytes()) throw badRequest("File exceeds the upload limit");
  const data = Buffer.from(await file.arrayBuffer());
  const asset = await uploadVentureAsset(ctx, id, { kind, fileName: file.name || "upload", data });
  return json({ asset }, 201);
});
