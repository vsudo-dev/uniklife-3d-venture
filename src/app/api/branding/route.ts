import { authed, body, json } from "@/lib/api";
import { brandingInputSchema, getBrandingSettings, updateBranding } from "@/lib/services/branding";

export const dynamic = "force-dynamic";

export const GET = authed(async (_req, ctx) => json({ branding: await getBrandingSettings(ctx) }));

export const PUT = authed(async (req, ctx) => {
  const input = await body(req, brandingInputSchema);
  return json(await updateBranding(ctx, input));
});
