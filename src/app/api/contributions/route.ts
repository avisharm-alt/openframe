import { userRoute } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";
import { createDraft, listMine } from "@/lib/services/contributions";

export const GET = userRoute({}, ({ actor }) => ({ contributions: listMine(actor) }));
export const POST = userRoute({ body: true }, ({ actor, body }) => {
  rateLimit(`contrib-create:${actor.id}`, 30, 3600_000);
  return createDraft(actor, body);
});
