import { z } from "zod";
import { reviewerRoute } from "@/lib/http";
import { withdrawQuestion } from "@/lib/services/moderation";

const schema = z.strictObject({ reason: z.string().trim().min(5).max(500), reportId: z.string().uuid().optional() });

export const POST = reviewerRoute<{ id: string }>({ body: true }, ({ actor, params, body }) => {
  const b = schema.parse(body);
  return withdrawQuestion(actor, params.id, b.reason, b.reportId);
});
