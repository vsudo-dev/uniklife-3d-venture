import { authed, body, json } from "@/lib/api";
import { createOrganization, createOrganizationSchema, listOrganizations } from "@/lib/services/organizations";

export const dynamic = "force-dynamic";

export const GET = authed(async (_req, ctx) => json({ items: await listOrganizations(ctx) }));

export const POST = authed(async (req, ctx) => {
  const input = await body(req, createOrganizationSchema);
  return json(await createOrganization(ctx, input), 201);
});
