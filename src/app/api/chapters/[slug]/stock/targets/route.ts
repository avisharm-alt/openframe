import { userRoute } from "@/lib/http";
import { getChapterBySlug } from "@/lib/services/access";
import { setTarget } from "@/lib/services/restock";

// Restock target for an item (and size). Below it, a restock request is posted to the board automatically. Target 0 removes it.
export const PUT = userRoute<{ slug: string }>({ body: true }, ({ actor, params, body }) => {
  setTarget(actor, getChapterBySlug(params.slug).id, body);
  return { ok: true };
});
