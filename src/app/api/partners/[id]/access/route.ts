import { userRoute } from "@/lib/http";
import { requestAccess } from "@/lib/services/partners";

export const POST = userRoute<{ id: string }>({}, ({ actor, params }) => {
  requestAccess(actor, params.id);
  return { ok: true };
});
