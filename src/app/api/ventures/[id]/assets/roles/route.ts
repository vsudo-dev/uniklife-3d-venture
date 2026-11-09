import { authed, body, json } from "@/lib/api";
import { assetRoleSchema, setVentureAssetRole } from "@/lib/services/assets";

/** Explicitly sets/clears the venture cover image, layout PDF or 3D model. */
export const POST = authed<{ id: string }>(async (req, ctx, { id }) => json(await setVentureAssetRole(ctx, id, await body(req, assetRoleSchema))));
