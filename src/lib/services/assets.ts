import { z } from "zod";
import type { Queryable } from "@/lib/db/types";
import { num } from "@/lib/db/types";
import type { AuthContext } from "@/lib/auth/context";
import { assertPermission, can, canAccessVenture, isStaff } from "@/lib/auth/context";
import { badRequest, notFound } from "@/lib/errors";
import { writeAudit } from "@/lib/audit";
import { env } from "@/lib/env";
import { buildObjectPath, deleteObject, getObject, putObject, sniffType, type StoredObject } from "@/lib/storage";
import { readGlb } from "@/lib/cad/glb";
import { db, withTx } from "./common";

export const ASSET_KINDS = ["image", "layout_pdf", "model_glb", "cad_dxf", "cad_dwg"] as const;
export type UploadKind = (typeof ASSET_KINDS)[number];

/** Kinds that customers / non-assigned members may view on PUBLISHED ventures. */
export const PUBLIC_ASSET_KINDS = ["image", "layout_pdf", "model_glb"] as const;
const INLINE_KINDS = new Set(["image", "layout_pdf", "model_glb"]);

const ALLOWED_TYPES: Record<UploadKind, string[]> = {
  image: ["image/png", "image/jpeg", "image/webp"],
  layout_pdf: ["application/pdf"],
  model_glb: ["model/gltf-binary"],
  cad_dxf: ["image/vnd.dxf"],
  cad_dwg: ["application/acad"],
};

const KIND_LABEL: Record<UploadKind, string> = {
  image: "an image (PNG, JPEG or WebP)",
  layout_pdf: "a PDF",
  model_glb: "a binary glTF (.glb) model",
  cad_dxf: "an ASCII DXF drawing",
  cad_dwg: "a DWG drawing",
};

export interface AssetRow {
  id: string;
  venture_id: string;
  kind: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
  uploaded_by_name: string | null;
}

export function maxUploadBytes(): number {
  return Math.floor(env.MAX_UPLOAD_MB * 1024 * 1024);
}

/** ASCII DXF files may start with 999 comments; accept a text file whose first group code is numeric and that declares a SECTION. */
function looksLikeAsciiDxf(buf: Buffer): boolean {
  const head = buf.toString("latin1", 0, Math.min(buf.length, 4096));
  if (/[\x00-\x08\x0e-\x1f]/.test(head)) return false;
  const lines = head.split(/\r\n|\r|\n/).map((l) => l.trim());
  return /^\d+$/.test(lines[0] ?? "") && lines.some((l, i) => l === "SECTION" && lines[i - 1] === "0");
}

/** Determines the real type from magic bytes and checks it against the requested kind. Never trusts the client MIME type. */
export function validateUpload(kind: UploadKind, data: Buffer, fileName: string): { mime: string } {
  if (data.length === 0) throw badRequest("The file is empty");
  if (data.length > maxUploadBytes()) throw badRequest(`File exceeds the ${env.MAX_UPLOAD_MB} MB upload limit`);
  let mime = sniffType(data);
  if (!mime && kind === "cad_dxf") {
    if (data.toString("latin1", 0, 18) === "AutoCAD Binary DXF") throw badRequest("Binary DXF is not supported — export an ASCII DXF (R12 or R2000).");
    if (looksLikeAsciiDxf(data)) mime = "image/vnd.dxf";
  }
  if (!mime || !ALLOWED_TYPES[kind].includes(mime)) {
    const ext = fileName.toLowerCase().split(".").pop();
    if (kind === "model_glb" && (ext === "gltf" || data.toString("utf8", 0, 1) === "{")) {
      throw badRequest("Only binary glTF (.glb) is accepted — export your model as GLB with embedded buffers.");
    }
    throw badRequest(`The file content is not ${KIND_LABEL[kind]}`);
  }
  if (kind === "model_glb") {
    try {
      readGlb(data);
    } catch (e) {
      throw badRequest(`Invalid GLB: ${(e as Error).message}`);
    }
  }
  return { mime };
}

function safeFileName(name: string): string {
  const base = name.replace(/\\/g, "/").split("/").pop() ?? "file";
  const cleaned = base.replace(/[\u0000-\u001f\u007f"<>|:*?]/g, "_").trim().slice(0, 180);
  return cleaned || "file";
}

async function loadManagedVenture(ctx: AuthContext, q: Queryable, ventureId: string, forUpdate = false) {
  const [v] = await q.query<Record<string, unknown>>(
    `select id, name, organization_id, is_published, cover_image_asset_id, layout_pdf_asset_id, model_asset_id, viewer_mode
       from ventures where organization_id = $1 and id = $2${forUpdate ? " for update" : ""}`,
    [ctx.organizationId, ventureId],
  );
  if (!v || !isStaff(ctx) || !canAccessVenture(ctx, ventureId)) throw notFound("Venture");
  return v;
}

export async function listAssets(ctx: AuthContext, ventureId: string): Promise<AssetRow[]> {
  assertPermission(ctx, "venture.view");
  const q = await db();
  await loadManagedVenture(ctx, q, ventureId);
  const rows = await q.query<AssetRow>(
    `select a.id, a.venture_id, a.kind, a.file_name, a.mime_type, a.size_bytes, a.created_at, u.full_name as uploaded_by_name
       from venture_assets a left join app_users u on u.id = a.uploaded_by
      where a.organization_id = $1 and a.venture_id = $2 order by a.created_at desc`,
    [ctx.organizationId, ventureId],
  );
  return rows.map((r) => ({ ...r, size_bytes: num(r.size_bytes) }));
}

export async function uploadVentureAsset(ctx: AuthContext, ventureId: string, input: { kind: UploadKind; fileName: string; data: Buffer }) {
  assertPermission(ctx, "venture.update");
  if (!ASSET_KINDS.includes(input.kind)) throw badRequest("Unsupported asset kind");
  const q0 = await db();
  await loadManagedVenture(ctx, q0, ventureId);
  const { mime } = validateUpload(input.kind, input.data, input.fileName);
  const fileName = safeFileName(input.fileName);
  const objectPath = buildObjectPath(ctx.organizationId, `ventures/${ventureId}/${input.kind}`, fileName);
  const stored = await putObject(objectPath, input.data, mime);
  try {
    return await withTx(async (q) => {
      await loadManagedVenture(ctx, q, ventureId);
      const [row] = await q.query<{ id: string }>(
        `insert into venture_assets (organization_id, venture_id, kind, storage_driver, storage_path, file_name, mime_type, size_bytes, uploaded_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
        [ctx.organizationId, ventureId, input.kind, stored.driver, stored.path, fileName, mime, input.data.length, ctx.user.id],
      );
      await writeAudit(q, ctx, {
        action: "venture.asset_uploaded", entityType: "venture", entityId: ventureId,
        summary: `Uploaded ${input.kind} "${fileName}"`, metadata: { asset_id: row.id, kind: input.kind, mime, size_bytes: input.data.length },
      });
      return { id: row.id, kind: input.kind, fileName, mime, sizeBytes: input.data.length };
    });
  } catch (e) {
    await deleteObject(stored).catch(() => undefined); // don't leave orphaned objects behind
    throw e;
  }
}

export const assetRoleSchema = z.object({
  role: z.enum(["cover_image", "layout_pdf", "model"]),
  assetId: z.string().uuid().nullable(),
});

const ROLE_COLUMN = { cover_image: "cover_image_asset_id", layout_pdf: "layout_pdf_asset_id", model: "model_asset_id" } as const;
const ROLE_KIND = { cover_image: "image", layout_pdf: "layout_pdf", model: "model_glb" } as const;

/** Explicitly assigns (or clears) the venture's cover image / layout PDF / 3D model. */
export async function setVentureAssetRole(ctx: AuthContext, ventureId: string, input: z.infer<typeof assetRoleSchema>) {
  assertPermission(ctx, "venture.update");
  return withTx(async (q) => {
    const v = await loadManagedVenture(ctx, q, ventureId, true);
    if (input.assetId) {
      const [a] = await q.query<{ kind: string }>("select kind from venture_assets where organization_id = $1 and venture_id = $2 and id = $3", [ctx.organizationId, ventureId, input.assetId]);
      if (!a) throw notFound("Asset");
      if (a.kind !== ROLE_KIND[input.role]) throw badRequest(`Only ${ROLE_KIND[input.role]} assets can be used as the ${input.role.replace("_", " ")}`);
    }
    const col = ROLE_COLUMN[input.role];
    await q.query(`update ventures set ${col} = $3 where organization_id = $1 and id = $2`, [ctx.organizationId, ventureId, input.assetId]);
    await writeAudit(q, ctx, {
      action: "venture.asset_role_changed", entityType: "venture", entityId: ventureId,
      summary: `${input.role} ${input.assetId ? "set" : "cleared"}`, before: { [col]: v[col] ?? null }, after: { [col]: input.assetId },
    });
    return { ok: true };
  });
}

export async function deleteVentureAsset(ctx: AuthContext, ventureId: string, assetId: string) {
  assertPermission(ctx, "venture.update");
  const stored = await withTx(async (q) => {
    await loadManagedVenture(ctx, q, ventureId, true);
    const [a] = await q.query<{ id: string; kind: string; file_name: string; storage_driver: string; storage_path: string }>(
      "select id, kind, file_name, storage_driver, storage_path from venture_assets where organization_id = $1 and venture_id = $2 and id = $3",
      [ctx.organizationId, ventureId, assetId],
    );
    if (!a) throw notFound("Asset");
    await q.query("delete from venture_assets where id = $1", [assetId]); // venture role columns are cleared by FK "on delete set null"
    await writeAudit(q, ctx, { action: "venture.asset_deleted", entityType: "venture", entityId: ventureId, summary: `Deleted ${a.kind} "${a.file_name}"`, metadata: { asset_id: assetId } });
    return { driver: a.storage_driver, path: a.storage_path } as StoredObject;
  });
  await deleteObject(stored).catch(() => undefined);
  return { deleted: true };
}

/**
 * Authorization for serving asset bytes:
 *  - staff with venture.view and access to the venture: every kind;
 *  - any other authenticated member (customers, non-assigned staff): only image /
 *    layout_pdf / model_glb of PUBLISHED ventures.
 * Anything else is reported as not found.
 */
export async function getAssetForDownload(ctx: AuthContext, ventureId: string, assetId: string) {
  const q = await db();
  const [row] = await q.query<Record<string, unknown>>(
    `select a.id, a.kind, a.file_name, a.mime_type, a.size_bytes, a.storage_driver, a.storage_path, v.is_published
       from venture_assets a join ventures v on v.id = a.venture_id
      where a.organization_id = $1 and v.organization_id = $1 and a.venture_id = $2 and a.id = $3`,
    [ctx.organizationId, ventureId, assetId],
  );
  if (!row) throw notFound("Asset");
  const fullAccess = isStaff(ctx) && can(ctx, "venture.view") && canAccessVenture(ctx, ventureId);
  const publicAccess = Boolean(row.is_published) && (PUBLIC_ASSET_KINDS as readonly string[]).includes(String(row.kind));
  if (!fullAccess && !publicAccess) throw notFound("Asset");
  let data: Buffer;
  try {
    data = await getObject({ driver: row.storage_driver as StoredObject["driver"], path: String(row.storage_path) });
  } catch {
    throw notFound("Asset file");
  }
  return {
    data,
    kind: String(row.kind),
    fileName: String(row.file_name),
    mimeType: String(row.mime_type),
    disposition: INLINE_KINDS.has(String(row.kind)) ? ("inline" as const) : ("attachment" as const),
  };
}

/** Reads a stored DXF asset as text (staff with venture access only). */
export async function readDxfAssetText(ctx: AuthContext, q: Queryable, ventureId: string, assetId: string): Promise<{ text: string; fileName: string }> {
  await loadManagedVenture(ctx, q, ventureId);
  const [a] = await q.query<{ kind: string; file_name: string; storage_driver: string; storage_path: string }>(
    "select kind, file_name, storage_driver, storage_path from venture_assets where organization_id = $1 and venture_id = $2 and id = $3",
    [ctx.organizationId, ventureId, assetId],
  );
  if (!a) throw notFound("Asset");
  if (a.kind === "cad_dwg") throw badRequest("DWG cannot be parsed directly; export to DXF (R12/R2000 ASCII) from your CAD tool and upload the DXF.");
  if (a.kind !== "cad_dxf") throw badRequest("Select a DXF asset to import");
  const buf = await getObject({ driver: a.storage_driver as StoredObject["driver"], path: a.storage_path });
  return { text: buf.toString("utf8"), fileName: a.file_name };
}

/** Reads a stored layout PDF (staff with venture access only). */
export async function readPdfAsset(ctx: AuthContext, q: Queryable, ventureId: string, assetId: string): Promise<{ data: Buffer; fileName: string }> {
  await loadManagedVenture(ctx, q, ventureId);
  const [a] = await q.query<{ kind: string; file_name: string; storage_driver: string; storage_path: string }>(
    "select kind, file_name, storage_driver, storage_path from venture_assets where organization_id = $1 and venture_id = $2 and id = $3",
    [ctx.organizationId, ventureId, assetId],
  );
  if (!a) throw notFound("Asset");
  if (a.kind !== "layout_pdf") throw badRequest("Select a PDF asset to extract plots from");
  const data = await getObject({ driver: a.storage_driver as StoredObject["driver"], path: a.storage_path });
  return { data, fileName: a.file_name };
}

/** RFC 6266 Content-Disposition with an ASCII fallback and UTF-8 filename*. */
export function contentDisposition(type: "inline" | "attachment", fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
