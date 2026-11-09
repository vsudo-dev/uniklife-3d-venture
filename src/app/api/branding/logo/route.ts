import { authed, json, rateLimit } from "@/lib/api";
import { assertPermission } from "@/lib/auth/context";
import { badRequest } from "@/lib/errors";
import { uploadLogo } from "@/lib/services/branding";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BYTES = 5 * 1024 * 1024;

/** multipart/form-data with a single `file` field. The bytes are stored unmodified. */
export const POST = authed(async (req, ctx) => {
  assertPermission(ctx, "branding.manage");
  rateLimit(`logo:${ctx.organizationId}`, 20, 60 * 60_000);
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES + 64 * 1024) throw badRequest("Logo must be 5 MB or smaller");
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw badRequest("Expected a multipart form upload");
  }
  const file = form.get("file");
  if (!file || typeof file === "string") throw badRequest("No file uploaded");
  if (file.size > MAX_BYTES) throw badRequest("Logo must be 5 MB or smaller");
  const data = Buffer.from(await file.arrayBuffer());
  return json(await uploadLogo(ctx, data), 201);
});
