import { userRoute } from "@/lib/http";
import { decidePartner } from "@/lib/services/partners";

export const POST = userRoute<{ id: string }>({ body: true }, ({ actor, params, body }) => {
  decidePartner(actor, params.id, body);
  return { ok: true };
});
