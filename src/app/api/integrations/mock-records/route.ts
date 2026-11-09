import { authed, json } from "@/lib/api";
import { listMockRecords } from "@/lib/services/integration";

/** GET — what the MOCK UNIKLIFE.AI connector "received" (never a real CRM). */
export const GET = authed(async (_req, ctx) => json(await listMockRecords(ctx)));
