import { authed, json } from "@/lib/api";
import { searchCreditableEmployees } from "@/lib/services/employees";

/** Booking employee selector — returns ONLY staff the caller may credit. */
export const GET = authed(async (req, ctx) => json(await searchCreditableEmployees(ctx, (req.nextUrl.searchParams.get("q") ?? "").slice(0, 60))));
