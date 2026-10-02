import { reviewerRoute } from "@/lib/http";
import { restoreQuestion } from "@/lib/services/moderation";

export const POST = reviewerRoute<{ id: string }>({}, ({ actor, params }) => restoreQuestion(actor, params.id));
