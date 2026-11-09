import { authed, body, json } from "@/lib/api";
import { commissionSettingsSchema, getCommissionSettings, updateCommissionSettings } from "@/lib/services/commissions";

export const GET = authed(async (_req, ctx) => json(await getCommissionSettings(ctx)));

/** Org administrators: toggle whether a commission plan needs a second approver. */
export const PUT = authed(async (req, ctx) => json(await updateCommissionSettings(ctx, await body(req, commissionSettingsSchema))));
