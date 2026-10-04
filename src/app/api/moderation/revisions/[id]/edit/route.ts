import { reviewerRoute } from "@/lib/http";
import { editAsReviewer } from "@/lib/services/contributions";

/** Reviewers correct a question while reviewing it. The correction becomes a new revision that needs fresh approvals. */
export const POST = reviewerRoute<{ id: string }>({ body: true }, ({ actor, params, body }) => editAsReviewer(actor, params.id, body));
