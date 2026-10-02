import { reviewerRoute } from "@/lib/http";
import { queue } from "@/lib/services/moderation";

export const GET = reviewerRoute({}, ({ actor }) => ({ queue: queue(actor) }));
