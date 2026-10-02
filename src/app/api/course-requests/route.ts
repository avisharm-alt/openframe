import { publicRoute, clientIp } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";
import { createCourseRequest } from "@/lib/services/reports";
import { courseRequestSchema } from "@/lib/validation";

export const POST = publicRoute({ body: true }, ({ req, actor, body }) => {
  rateLimit(`course-request:${actor?.id ?? clientIp(req)}`, 5, 3600_000);
  return createCourseRequest(actor, courseRequestSchema.parse(body));
});
