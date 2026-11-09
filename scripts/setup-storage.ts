/**
 * Creates the PRIVATE Supabase Storage bucket used for venture assets and logos.
 *   npx tsx --env-file=.env.production.local scripts/setup-storage.ts
 * Files are always served through the app's authorization-checked routes.
 */
import { createClient } from "@supabase/supabase-js";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "venture-assets";
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const { data: existing } = await sb.storage.getBucket(bucket);
  if (existing) {
    console.log(`Bucket "${bucket}" already exists (public: ${existing.public}).`);
    if (existing.public) console.warn("WARNING: bucket is public — make it private in the Supabase dashboard.");
    return;
  }
  const { error } = await sb.storage.createBucket(bucket, { public: false, fileSizeLimit: `${process.env.MAX_UPLOAD_MB ?? 50}MB` });
  if (error) throw new Error(`Could not create bucket: ${error.message}`);
  console.log(`Created private bucket "${bucket}".`);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
