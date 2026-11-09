import { authed, json } from "@/lib/api";
import { searchCustomers } from "@/lib/services/customers";

export const GET = authed(async (req, ctx) => json(await searchCustomers(ctx, (req.nextUrl.searchParams.get("q") ?? "").slice(0, 60))));
