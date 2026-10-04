import { reviewerRoute } from "@/lib/http";
import { itemAnalysis } from "@/lib/services/item-analysis";

/** Aggregate answer statistics per published question. Never includes individual students' answers. */
export const GET = reviewerRoute({}, ({ actor, req }) => {
  const sp = new URL(req.url).searchParams;
  return { items: itemAnalysis(actor, { courseId: sp.get("course") ?? undefined, flaggedOnly: sp.get("flagged") === "1", withAttemptsOnly: sp.get("attempted") === "1" }) };
});
