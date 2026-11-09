import { z } from "zod";
import { authed, body, json } from "@/lib/api";
import { previewEmployeeImport } from "@/lib/services/employees";

const schema = z.object({ csv: z.string().min(1, "CSV is empty").max(2_000_000, "CSV is too large (max 2 MB)") });

export const POST = authed(async (req, ctx) => {
  const { csv } = await body(req, schema);
  return json(await previewEmployeeImport(ctx, csv));
});
