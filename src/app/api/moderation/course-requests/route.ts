import { reviewerRoute } from "@/lib/http";
import { listCourseRequests } from "@/lib/services/moderation";

const STATUSES = ["open", "added", "dismissed", "all"] as const;

export const GET = reviewerRoute({}, ({ actor, req }) => {
  const s = new URL(req.url).searchParams.get("status") ?? "open";
  return { requests: listCourseRequests(actor, (STATUSES as readonly string[]).includes(s) ? (s as (typeof STATUSES)[number]) : "open") };
});
