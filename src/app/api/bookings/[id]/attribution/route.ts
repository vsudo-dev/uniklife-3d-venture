import { authed, body, json } from "@/lib/api";
import { attributionSchema, changeAttribution } from "@/lib/services/bookings";

export const POST = authed<{ id: string }>(async (req, ctx, { id }) => json(await changeAttribution(ctx, id, await body(req, attributionSchema))));
