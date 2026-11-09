import { authed, body, json } from "@/lib/api";
import { getMeshMapping, meshMappingSchema, updateMeshMapping } from "@/lib/services/plots";

export const GET = authed<{ id: string }>(async (_req, ctx, { id }) => json(await getMeshMapping(ctx, id)));

export const PUT = authed<{ id: string }>(async (req, ctx, { id }) => json(await updateMeshMapping(ctx, id, await body(req, meshMappingSchema))));
