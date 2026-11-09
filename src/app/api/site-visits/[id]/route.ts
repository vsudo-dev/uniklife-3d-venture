import { authed, body, json } from "@/lib/api";
import { getSiteVisit, siteVisitActionSchema, updateSiteVisit } from "@/lib/services/site-visits";

export const GET = authed<{ id: string }>(async (_req, ctx, { id }) => json(await getSiteVisit(ctx, id)));

/** { action: reschedule | assign | schedule | cancel | no_show | complete, ... } */
export const PATCH = authed<{ id: string }>(async (req, ctx, { id }) => json(await updateSiteVisit(ctx, id, await body(req, siteVisitActionSchema))));
