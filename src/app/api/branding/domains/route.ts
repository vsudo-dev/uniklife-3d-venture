import { z } from "zod";
import { authed, body, json } from "@/lib/api";
import { addDomain, listDomains } from "@/lib/services/branding";

export const dynamic = "force-dynamic";

export const GET = authed(async (_req, ctx) => json({ items: await listDomains(ctx) }));

export const POST = authed(async (req, ctx) => {
  const { domain } = await body(req, z.object({ domain: z.string().trim().min(3).max(260) }));
  return json({ domain: await addDomain(ctx, domain) }, 201);
});
