import { z } from "zod";
import { authed, body, json } from "@/lib/api";
import { notFound } from "@/lib/errors";
import { isUuid } from "@/lib/services/common";
import { setOrganizationStatus } from "@/lib/services/organizations";

export const PATCH = authed<{ id: string }>(async (req, ctx, { id }) => {
  if (!isUuid(id)) throw notFound("Organization");
  const { status } = await body(req, z.object({ status: z.enum(["active", "suspended"]) }));
  return json(await setOrganizationStatus(ctx, id, status));
});
