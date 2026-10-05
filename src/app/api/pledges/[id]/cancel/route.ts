import { userRoute } from "@/lib/http";
import { cancelPledge } from "@/lib/services/pledges";

export const POST = userRoute<{ id: string }>({}, ({ actor, params }) => {
  cancelPledge(actor, params.id);
  return { ok: true };
});
