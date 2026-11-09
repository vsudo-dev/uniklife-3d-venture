import { authed, body, json } from "@/lib/api";
import { createStaff, createStaffSchema, listStaff } from "@/lib/services/staff";

export const dynamic = "force-dynamic";

export const GET = authed(async (req, ctx) => {
  const sp = req.nextUrl.searchParams;
  return json({ items: await listStaff(ctx, { q: sp.get("q") ?? undefined, includeCustomers: sp.get("customers") === "1" }) });
});

export const POST = authed(async (req, ctx) => {
  const input = await body(req, createStaffSchema);
  return json(await createStaff(ctx, input), 201);
});
