import { reviewerRoute } from "@/lib/http";
import { getRevisionForReview } from "@/lib/services/moderation";

export const GET = reviewerRoute<{ id: string }>({}, ({ actor, params }) => getRevisionForReview(actor, params.id));
