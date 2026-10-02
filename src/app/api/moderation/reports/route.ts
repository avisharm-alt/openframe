import { reviewerRoute } from "@/lib/http";
import { listReports } from "@/lib/services/moderation";

export const GET = reviewerRoute({}, ({ actor, req }) => ({ reports: listReports(actor, new URL(req.url).searchParams.get("state") ?? undefined) }));
