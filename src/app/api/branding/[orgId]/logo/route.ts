import type { NextRequest } from "next/server";
import { loadOrganizationLogo } from "@/lib/services/branding";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Public logo endpoint (logos appear on the login screen and in PWA chrome).
 * Serves the stored bytes exactly as uploaded. The URL is versioned (?v=branding_version),
 * so responses are immutable.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const logo = await loadOrganizationLogo(orgId).catch(() => null);
  if (!logo) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  return new Response(new Uint8Array(logo.data), {
    headers: {
      "Content-Type": logo.mime,
      "Content-Length": String(logo.data.length),
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
