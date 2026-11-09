import type { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { findOrganizationByHost, loadBranding } from "@/lib/tenant";
import { ICON_SIZES, renderIcon } from "@/lib/pwa/icons";
import { getObject } from "@/lib/storage";

export const dynamic = "force-dynamic";

const cache = new Map<string, Buffer>();

export async function GET(req: NextRequest, { params }: { params: Promise<{ size: string }> }) {
  const size = Number((await params).size);
  if (!ICON_SIZES.includes(size as (typeof ICON_SIZES)[number])) return new Response("Not found", { status: 404 });
  const maskable = req.nextUrl.searchParams.get("maskable") === "1";
  const db = await getDb();
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  const orgId = await findOrganizationByHost(db, host);
  const branding = await loadBranding(db, orgId);
  const key = `${orgId ?? "platform"}:${branding.version}:${branding.theme}:${size}:${maskable}`;
  let png = cache.get(key);
  if (!png) {
    let logo: Buffer | null = null;
    if (orgId) {
      const [o] = await db.query<{ logo_path: string | null }>("select logo_path from organizations where id = $1", [orgId]);
      if (o?.logo_path) logo = await getObject({ driver: o.logo_path.startsWith("sb:") ? "supabase" : "local", path: o.logo_path.replace(/^sb:/, "") }).catch(() => null);
    }
    png = await renderIcon(size, branding, logo, maskable);
    if (cache.size > 500) cache.clear();
    cache.set(key, png);
  }
  return new Response(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      // URLs carry ?v=<branding_version>; still vary by host and keep private to avoid cross-tenant reuse.
      "Cache-Control": "private, max-age=3600",
      Vary: "Host, X-Forwarded-Host",
    },
  });
}
