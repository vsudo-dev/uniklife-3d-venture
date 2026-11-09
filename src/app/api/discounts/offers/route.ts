import { authed, json } from "@/lib/api";
import { eligibleOffers } from "@/lib/services/discounts";
import { badRequest } from "@/lib/errors";
import { isUuid } from "@/lib/services/common";

export const GET = authed(async (req, ctx) => {
  const plots = (req.nextUrl.searchParams.get("plots") ?? "").split(",").filter(isUuid);
  if (plots.length === 0) throw badRequest("plots query parameter is required");
  return json(await eligibleOffers(ctx, plots, req.nextUrl.searchParams.get("customer")));
});
