import { authed, body, json } from "@/lib/api";
import { getMyPreferences, preferencesSchema, updateMyPreferences } from "@/lib/services/notifications";

export const dynamic = "force-dynamic";

export const GET = authed(async (_req, ctx) => json({ preferences: await getMyPreferences(ctx) }));

export const PUT = authed(async (req, ctx) => {
  const input = await body(req, preferencesSchema);
  return json({ preferences: await updateMyPreferences(ctx, input) });
});
