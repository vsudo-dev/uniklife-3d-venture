import { authed, body, json } from "@/lib/api";
import { metaFormSchema, saveMetaForm } from "@/lib/integration/direct-meta";
export const POST=authed(async(req,ctx)=>json(await saveMetaForm(ctx,await body(req,metaFormSchema)),201));
