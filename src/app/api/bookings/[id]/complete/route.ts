import { authed, json } from "@/lib/api";
import { completeSale } from "@/lib/services/bookings";

export const POST = authed<{ id: string }>(async (_req, ctx, { id }) => json(await completeSale(ctx, id)));
