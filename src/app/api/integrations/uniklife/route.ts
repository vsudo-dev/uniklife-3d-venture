import { authed, body, json } from "@/lib/api";
import { connectionUpdateSchema, getConnection, getConnections, integrationStats, updateConnection } from "@/lib/services/integration";

/** GET/PATCH the organization's UNIKLIFE.AI connection settings (env var NAMES only, never values). */
export const GET = authed(async (_req, ctx) => {
  const [connection, connections, stats] = await Promise.all([getConnection(ctx), getConnections(ctx), integrationStats(ctx)]);
  return json({ connection, connections, stats });
});

export const PATCH = authed(async (req, ctx) => {
  return json({ connection: await updateConnection(ctx, await body(req, connectionUpdateSchema)) });
});

export const POST = authed(async (req, ctx) => {
  return json({ connection: await updateConnection(ctx, await body(req, connectionUpdateSchema), true) }, { status: 201 });
});
