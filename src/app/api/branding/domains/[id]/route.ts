import { z } from "zod";
import { authed, body, json } from "@/lib/api";
import { confirmDomainDns, removeDomain, setPrimaryDomain, unverifyDomain } from "@/lib/services/branding";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("set_primary") }),
  z.object({ action: z.literal("confirm_dns"), confirmed: z.literal(true) }),
  z.object({ action: z.literal("unverify") }),
]);

export const PATCH = authed<{ id: string }>(async (req, ctx, { id }) => {
  const input = await body(req, schema);
  if (input.action === "set_primary") return json(await setPrimaryDomain(ctx, id));
  if (input.action === "confirm_dns") return json(await confirmDomainDns(ctx, id, input.confirmed));
  return json(await unverifyDomain(ctx, id));
});

export const DELETE = authed<{ id: string }>(async (_req, ctx, { id }) => json(await removeDomain(ctx, id)));
