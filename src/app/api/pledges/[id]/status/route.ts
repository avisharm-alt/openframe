import { userRoute } from "@/lib/http";
import { coordinatorTransition } from "@/lib/services/pledges";

export const POST = userRoute<{ id: string }>({ body: true }, ({ actor, params, body }) => {
  coordinatorTransition(actor, params.id, body);
  return { ok: true };
});
