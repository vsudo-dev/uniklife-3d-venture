import type { NextRequest } from "next/server";
import { assertSameOrigin, authed, body, ipOf, json, publicRoute, rateLimit } from "@/lib/api";
import { getAuthContext } from "@/lib/auth/server";
import { createEnquiry, enquiryCreateSchema, listEnquiries } from "@/lib/services/enquiries";
import { getDb } from "@/lib/db";
import { findOrganizationByHost } from "@/lib/tenant";
import { badRequest } from "@/lib/errors";

export const GET = authed(async (req, ctx) => {
  const sp = req.nextUrl.searchParams;
  return json(await listEnquiries(ctx, { status: sp.get("status") ?? undefined, mine: sp.get("mine") === "1", q: sp.get("q") ?? undefined }));
});

/** Enquiry submission — signed-in users or public visitors on a tenant domain (rate-limited, honeypot). */
export const POST = publicRoute(async (req: NextRequest) => {
  assertSameOrigin(req);
  rateLimit(`enquiry:${ipOf(req)}`, 8, 10 * 60_000);
  const input = await body(req, enquiryCreateSchema);
  const ctx = await getAuthContext();
  let orgId: string | null = null;
  if (!ctx) {
    orgId = await findOrganizationByHost(await getDb(), req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "");
    if (!orgId) throw badRequest("Please sign in to send an enquiry");
  }
  return json(await createEnquiry(ctx, orgId, input), 201);
});
