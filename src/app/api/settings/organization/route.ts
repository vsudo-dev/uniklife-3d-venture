import { authed, body, json } from "@/lib/api";
import { getOrgSettings, orgSettingsSchema, updateOrgSettings } from "@/lib/services/organizations";

export const dynamic = "force-dynamic";

export const GET = authed(async (_req, ctx) => json({ settings: await getOrgSettings(ctx) }));

export const PUT = authed(async (req, ctx) => {
  const input = await body(req, orgSettingsSchema);
  return json({ settings: await updateOrgSettings(ctx, input) });
});
