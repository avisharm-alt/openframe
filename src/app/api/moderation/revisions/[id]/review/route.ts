import { reviewerRoute } from "@/lib/http";
import { reviewRevision } from "@/lib/services/moderation";
import { reviewSchema } from "@/lib/validation";

export const POST = reviewerRoute<{ id: string }>({ body: true }, ({ actor, params, body }) =>
  reviewRevision(actor, params.id, reviewSchema.parse(body)),
);
