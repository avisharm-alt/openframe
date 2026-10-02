import { publicRoute, clientIp } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";
import { createSession } from "@/lib/services/practice";
import { sessionCreateSchema } from "@/lib/validation";

export const POST = publicRoute({ body: true }, ({ req, actor, body }) => {
  rateLimit(`sessions:${actor?.id ?? clientIp(req)}`, 60, 3600_000);
  return createSession(actor, sessionCreateSchema.parse(body));
});
