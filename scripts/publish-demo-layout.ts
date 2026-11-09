/** Upload a user-approved image to an existing demo venture, with an audit trail. */
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createPostgresDatabase } from "../src/lib/db/postgres";
import { writeAudit } from "../src/lib/audit";

const arg = (name: string) => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };

async function main() {
  if (!process.argv.includes("--yes-i-am-sure")) throw new Error("Explicit production upload confirmation is required.");
  const file = arg("--file"), code = arg("--venture-code");
  const url = process.env.POSTGRES_URL_NON_POOLING;
  const storageUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!file || !code || !url || !storageUrl || !key || key.includes("[SENSITIVE]")) throw new Error("Missing file, venture code or production connection settings.");
  const data = await readFile(file);
  if (data.length > 50 * 1024 * 1024 || data.toString("ascii", 0, 4) !== "RIFF" || data.toString("ascii", 8, 12) !== "WEBP") throw new Error("Expected a WebP image under 50 MB.");
  const digest = createHash("sha256").update(data).digest("hex");
  const db = createPostgresDatabase(url);
  try {
    const ventures = await db.query<{ id: string; name: string; organization_id: string; cover_image_asset_id: string | null; is_published: boolean }>("select id, name, organization_id, cover_image_asset_id, is_published from ventures where code = $1 and is_demo = true", [code]);
    if (ventures.length !== 1) throw new Error("Expected exactly one matching demo venture.");
    const v = ventures[0];
    const sb = createClient(storageUrl, key, { auth: { persistSession: false } });
    const bucket = process.env.SUPABASE_STORAGE_BUCKET && !process.env.SUPABASE_STORAGE_BUCKET.includes("[SENSITIVE]") ? process.env.SUPABASE_STORAGE_BUCKET : "venture-assets";
    const { data: bucketInfo, error: bucketError } = await sb.storage.getBucket(bucket);
    if (bucketError || !bucketInfo) throw new Error("Asset bucket is unavailable.");
    if (bucketInfo.public) throw new Error("Expected the existing private asset bucket.");
    const existing = await db.query<{ id: string; storage_path: string }>("select id, storage_path from venture_assets where venture_id = $1 and file_name = $2 and size_bytes = $3 and kind = 'image'", [v.id, basename(file), data.length]);
    for (const asset of existing) {
      const result = await sb.storage.from(bucket).download(asset.storage_path);
      if (result.data && createHash("sha256").update(Buffer.from(await result.data.arrayBuffer())).digest("hex") === digest && v.cover_image_asset_id === asset.id && v.is_published) {
        console.log(JSON.stringify({ status: "already-published", venture: v.name, ventureId: v.id, assetId: asset.id })); return;
      }
    }
    const objectPath = `${v.organization_id}/ventures/${v.id}/image/${randomUUID()}.webp`;
    const uploaded = await sb.storage.from(bucket).upload(objectPath, data, { contentType: "image/webp", upsert: false });
    if (uploaded.error) throw new Error("Storage upload failed.");
    const result = await db.transaction(async tx => {
      const [locked] = await tx.query<{ cover_image_asset_id: string | null; is_published: boolean }>("select cover_image_asset_id, is_published from ventures where id = $1 and organization_id = $2 and is_demo = true for update", [v.id, v.organization_id]);
      if (!locked) throw new Error("Demo venture is no longer available.");
      const [asset] = await tx.query<{ id: string }>("insert into venture_assets (organization_id, venture_id, kind, storage_driver, storage_path, file_name, mime_type, size_bytes) values ($1,$2,'image','supabase',$3,$4,'image/webp',$5) returning id", [v.organization_id, v.id, objectPath, basename(file), data.length]);
      await tx.query("update ventures set cover_image_asset_id = $1, is_published = true where id = $2 and organization_id = $3", [asset.id, v.id, v.organization_id]);
      await writeAudit(tx, { system: true, organizationId: v.organization_id }, { action: "venture.asset_uploaded", entityType: "venture", entityId: v.id, summary: `Published user-supplied layout reference ${basename(file)} to demo venture`, before: { cover_image_asset_id: locked.cover_image_asset_id, is_published: locked.is_published }, after: { cover_image_asset_id: asset.id, is_published: true }, metadata: { asset_id: asset.id, kind: "image", size_bytes: data.length, sha256: digest, source: "explicit-user-request" } });
      return asset;
    });
    const downloaded = await sb.storage.from(bucket).download(objectPath);
    if (!downloaded.data || createHash("sha256").update(Buffer.from(await downloaded.data.arrayBuffer())).digest("hex") !== digest) throw new Error("Uploaded image verification failed.");
    console.log(JSON.stringify({ status: "published", venture: v.name, ventureId: v.id, assetId: result.id, sizeBytes: data.length, verified: true }));
  } finally { await db.close(); }
}
main().catch(() => { console.error("Demo layout publication failed. Check database and storage availability; credentials are never logged."); process.exitCode = 1; });
