import { authed, json } from "@/lib/api";
import { releaseHold } from "@/lib/services/bookings";
import { isUuid } from "@/lib/services/common";
import { notFound } from "@/lib/errors";

export const DELETE = authed<{ groupId: string }>(async (_req, ctx, { groupId }) => {
  if (!isUuid(groupId)) throw notFound("Hold");
  return json(await releaseHold(ctx, groupId));
});
