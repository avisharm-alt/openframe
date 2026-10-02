import { reviewerRoute } from "@/lib/http";
import { listAllQuestions } from "@/lib/services/deletion";

/** Maintainers only (enforced in the service). */
export const GET = reviewerRoute({}, ({ actor }) => ({ questions: listAllQuestions(actor) }));
