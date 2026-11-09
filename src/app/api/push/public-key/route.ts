import { authed, json } from "@/lib/api";
import { pushPublicKey } from "@/lib/push";

/** GET — VAPID public key (null/enabled:false when push is not configured on the server). */
export const GET = authed(async () => json(pushPublicKey()));
