import "server-only";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";

/**
 * Object storage abstraction. "local" writes under LOCAL_UPLOAD_DIR (development);
 * "supabase" uses Supabase Storage with the service-role key (server only; UNTESTED
 * until a Supabase project is configured). Files are always served through
 * authorization-checked routes, never directly from a public bucket.
 */
export interface StoredObject {
  driver: "local" | "supabase";
  path: string;
}

const root = () => path.resolve(process.cwd(), env.LOCAL_UPLOAD_DIR);

function safeJoin(p: string): string {
  const full = path.resolve(root(), p);
  if (!full.startsWith(root() + path.sep)) throw new Error("Invalid storage path");
  return full;
}

export function buildObjectPath(orgId: string, folder: string, originalName: string): string {
  const ext = path.extname(originalName).toLowerCase().replace(/[^.a-z0-9]/g, "").slice(0, 8);
  return `${orgId}/${folder}/${randomUUID()}${ext}`;
}

async function supabase() {
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Supabase Storage is not configured");
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }).storage.from(env.SUPABASE_STORAGE_BUCKET);
}

export async function putObject(objectPath: string, data: Buffer, contentType: string): Promise<StoredObject> {
  if (env.STORAGE_DRIVER === "supabase") {
    const bucket = await supabase();
    const { error } = await bucket.upload(objectPath, data, { contentType, upsert: false });
    if (error) throw new Error("Upload failed");
    return { driver: "supabase", path: objectPath };
  }
  const full = safeJoin(objectPath);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, data);
  return { driver: "local", path: objectPath };
}

export async function getObject(obj: StoredObject): Promise<Buffer> {
  if (obj.driver === "supabase") {
    const bucket = await supabase();
    const { data, error } = await bucket.download(obj.path);
    if (error || !data) throw new Error("Not found");
    return Buffer.from(await data.arrayBuffer());
  }
  return readFile(safeJoin(obj.path));
}

export async function deleteObject(obj: StoredObject): Promise<void> {
  if (obj.driver === "supabase") {
    const bucket = await supabase();
    await bucket.remove([obj.path]);
    return;
  }
  await unlink(safeJoin(obj.path)).catch(() => undefined);
}

/** Validates file type by magic bytes (never trusts the client-provided MIME type). */
export function sniffType(buf: Buffer): string | null {
  const b = buf;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (b.length >= 5 && b.toString("ascii", 0, 5) === "%PDF-") return "application/pdf";
  if (b.length >= 4 && b.toString("ascii", 0, 4) === "glTF") return "model/gltf-binary";
  if (b.length >= 6 && b.toString("ascii", 0, 6).startsWith("AC10")) return "application/acad"; // DWG
  const head = b.toString("utf8", 0, Math.min(b.length, 256)).trimStart();
  if (/^0\s*\r?\nSECTION/.test(head)) return "image/vnd.dxf";
  return null;
}
