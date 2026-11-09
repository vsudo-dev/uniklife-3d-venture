import { authed, body, json } from "@/lib/api";
import { enquiryUpdateSchema, updateEnquiry } from "@/lib/services/enquiries";
import { isUuid } from "@/lib/services/common";
import { notFound } from "@/lib/errors";

/** Status change and/or (re)assignment to a permitted employee. */
export const PATCH = authed<{ id: string }>(async (req, ctx, { id }) => {
  if (!isUuid(id)) throw notFound("Enquiry");
  return json(await updateEnquiry(ctx, id, await body(req, enquiryUpdateSchema)));
});
