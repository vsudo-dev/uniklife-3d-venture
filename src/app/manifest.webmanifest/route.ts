import type { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { findOrganizationByHost, loadBranding } from "@/lib/tenant";
import { buildManifest } from "@/lib/pwa/manifest";

export const dynamic = "force-dynamic";

// Resolved from the request HOST only (never the session) so the installed identity matches the domain.
export async function GET(req: NextRequest) {
  const db = await getDb();
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  const branding = await loadBranding(db, await findOrganizationByHost(db, host));
  return new Response(JSON.stringify(buildManifest(branding)), {
    headers: {
      "Content-Type": "application/manifest+json; charset=utf-8",
      // Revalidate every time and vary by host so shared caches never mix tenants.
      "Cache-Control": "no-cache, private",
      Vary: "Host, X-Forwarded-Host",
    },
  });
}
