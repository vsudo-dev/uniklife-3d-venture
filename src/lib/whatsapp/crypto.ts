import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env, requireSecret } from "@/lib/env";

function key(): Buffer {
  const base = env.WHATSAPP_TOKEN_KEY && env.WHATSAPP_TOKEN_KEY.length >= 32 ? env.WHATSAPP_TOKEN_KEY : requireSecret("SESSION_SECRET");
  return createHash("sha256").update(`waba-token-v1:${base}`).digest();
}

/** AES-256-GCM → "v1.<iv>.<tag>.<ciphertext>" (base64url). */
export function encryptToken(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

export function decryptToken(stored: string): string {
  const [v, iv, tag, ct] = stored.split(".");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("Unsupported token format");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
}

/** Verifies Meta's X-Hub-Signature-256 ("sha256=<hex>") over the RAW body with the app secret. */
export function verifyMetaSignature(raw: string, header: string | null, appSecret: string | undefined): boolean {
  if (!appSecret || !header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(raw, "utf8").digest();
  const got = Buffer.from(header.slice(7), "hex");
  return got.length === expected.length && timingSafeEqual(got, expected);
}
