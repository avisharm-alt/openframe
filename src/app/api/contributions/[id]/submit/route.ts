import { userRoute } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";
import { submit } from "@/lib/services/contributions";
import { submitSchema } from "@/lib/validation";

export const POST = userRoute<{ id: string }>({ body: true }, ({ actor, params, body }) => {
  rateLimit(`contrib-submit:${actor.id}`, 20, 3600_000);
  return submit(actor, params.id, submitSchema.parse(body).attested);
});
