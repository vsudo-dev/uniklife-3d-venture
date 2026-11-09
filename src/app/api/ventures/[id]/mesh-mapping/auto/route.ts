import { z } from "zod";
import { authed, body, json } from "@/lib/api";
import { autoMapMeshIds } from "@/lib/services/plots";

const schema = z.object({ overwrite: z.boolean().default(false) });

/** Bulk "auto-map by PLOT_<number> convention". */
export const POST = authed<{ id: string }>(async (req, ctx, { id }) => json(await autoMapMeshIds(ctx, id, await body(req, schema))));
