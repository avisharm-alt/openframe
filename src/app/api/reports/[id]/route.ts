import { userRoute } from "@/lib/http";
import { updateConcern } from "@/lib/services/concerns";

export const PATCH = userRoute<{ id: string }>({ body: true }, ({ actor, params, body }) => {
  updateConcern(actor, params.id, body);
  return { ok: true };
});
