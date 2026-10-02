import { reviewerRoute } from "@/lib/http";
import { listNotesForReview } from "@/lib/services/notes";

/** Maintainers only (enforced in the service). */
export const GET = reviewerRoute({}, ({ actor }) => ({ notes: listNotesForReview(actor) }));
