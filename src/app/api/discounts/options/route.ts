import { authed, json } from "@/lib/api";
import { discountFormOptions } from "@/lib/services/discounts";

/** Venture list and (with ?venture=) that venture's plots, for the discount form pickers. */
export const GET = authed(async (req, ctx) => json(await discountFormOptions(ctx, req.nextUrl.searchParams.get("venture"))));
