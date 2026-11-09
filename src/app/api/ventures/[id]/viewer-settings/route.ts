import { authed, body, json } from "@/lib/api";
import { viewerSettingsSchema } from "@/lib/viewer-settings";
import { getVentureViewerSettings, updateViewerSettings } from "@/lib/services/ventures";

export const dynamic = "force-dynamic";

export const GET = authed<{ id: string }>(async (_req, ctx, { id }) => json({ settings: await getVentureViewerSettings(ctx, id) }));

/** Replaces the venture's viewer & presentation settings (venture.update, organization-scoped, audited). */
export const PUT = authed<{ id: string }>(async (req, ctx, { id }) => {
  const input = await body(req, viewerSettingsSchema);
  return json({ settings: await updateViewerSettings(ctx, id, input) });
});
