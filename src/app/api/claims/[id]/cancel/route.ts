import { userRoute } from "@/lib/http";
import { cancelClaim } from "@/lib/services/claims";

export const POST = userRoute<{ id: string }>({}, ({ actor, params }) => {
  cancelClaim(actor, params.id);
  return { ok: true };
});
