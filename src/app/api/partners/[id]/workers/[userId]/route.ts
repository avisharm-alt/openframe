import { userRoute } from "@/lib/http";
import { decideWorker } from "@/lib/services/partners";

export const POST = userRoute<{ id: string; userId: string }>({ body: true }, ({ actor, params, body }) => {
  decideWorker(actor, params.id, params.userId, body);
  return { ok: true };
});
