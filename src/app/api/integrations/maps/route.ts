import { authed, body, json } from "@/lib/api";
import { mapModeSchema, setMapMode } from "@/lib/services/maps";

/** POST — choose how site-visit locations are displayed (Google Maps or the built-in stationary GIS fence). Requires integration.manage. */
export const POST = authed(async (req, ctx) => json(await setMapMode(ctx, await body(req, mapModeSchema))));
