import { reviewerRoute } from "@/lib/http";
import { listCourseRequests } from "@/lib/services/moderation";

export const GET = reviewerRoute({}, ({ actor }) => ({ requests: listCourseRequests(actor) }));
