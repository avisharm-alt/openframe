import { userRoute } from "@/lib/http";
import { getChapterBySlug } from "@/lib/services/access";
import { removeMember } from "@/lib/services/chapters";

export const DELETE = userRoute<{ slug: string; userId: string }>({}, ({ actor, params }) => {
  removeMember(actor, getChapterBySlug(params.slug).id, params.userId);
  return { ok: true };
});
