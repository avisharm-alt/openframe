import { reviewerRoute } from "@/lib/http";
import { listEvents } from "@/lib/services/moderation";

export const GET = reviewerRoute({}, ({ actor, req }) => ({ events: listEvents(actor, new URL(req.url).searchParams.get("questionId") ?? undefined) }));
