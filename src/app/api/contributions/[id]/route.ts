import { userRoute } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";
import { getMine, updateDraft } from "@/lib/services/contributions";

export const GET = userRoute<{ id: string }>({}, ({ actor, params }) => getMine(actor, params.id));
export const PUT = userRoute<{ id: string }>({ body: true }, ({ actor, params, body }) => {
  rateLimit(`contrib-save:${actor.id}`, 300, 3600_000);
  return updateDraft(actor, params.id, body);
});
