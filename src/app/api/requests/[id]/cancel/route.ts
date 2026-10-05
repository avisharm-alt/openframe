import { userRoute } from "@/lib/http";
import { cancelRequest } from "@/lib/services/requests";

export const POST = userRoute<{ id: string }>({}, ({ actor, params }) => {
  cancelRequest(actor, params.id);
  return { ok: true };
});
