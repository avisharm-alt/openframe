import { userRoute } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";
import { publishAsMaintainer } from "@/lib/services/contributions";
import { submitSchema } from "@/lib/validation";

/** Maintainers only (enforced in the service): publish your own draft without a second reviewer. */
export const POST = userRoute<{ id: string }>({ body: true }, ({ actor, params, body }) => {
  rateLimit(`contrib-publish:${actor.id}`, 60, 3600_000);
  return publishAsMaintainer(actor, params.id, submitSchema.parse(body).attested);
});
