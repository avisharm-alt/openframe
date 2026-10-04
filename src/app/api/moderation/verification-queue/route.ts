import { reviewerRoute } from "@/lib/http";
import { verificationProgress, verificationQueue } from "@/lib/services/moderation";

export const GET = reviewerRoute({}, ({ actor, req }) => {
  const courseId = new URL(req.url).searchParams.get("course") ?? undefined;
  return { queue: verificationQueue(actor, { courseId }), progress: verificationProgress(actor) };
});
