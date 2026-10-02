import { publicRoute, clientIp, ipHash } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";
import { createReport } from "@/lib/services/reports";
import { reportSchema } from "@/lib/validation";

export const POST = publicRoute({ body: true }, ({ req, actor, body }) => {
  rateLimit(`report:${actor?.id ?? clientIp(req)}`, 10, 3600_000);
  return createReport(actor, ipHash(req), reportSchema.parse(body));
});
