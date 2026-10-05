import { userRoute } from "@/lib/http";
import { getChapterBySlug } from "@/lib/services/access";
import { listConcerns } from "@/lib/services/concerns";

export const GET = userRoute<{ slug: string }>({}, ({ actor, req, params }) => ({
  reports: listConcerns(actor, getChapterBySlug(params.slug).id, new URL(req.url).searchParams.get("state") ?? undefined),
}));
