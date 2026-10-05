import { userRoute } from "@/lib/http";
import { getChapterBySlug, requireCoordinator } from "@/lib/services/access";
import { createSlot, listCoverage, listPeriods, listSlots } from "@/lib/services/shifts";

type P = { slug: string };
export const GET = userRoute<P>({}, ({ actor, params }) => {
  const c = getChapterBySlug(params.slug);
  requireCoordinator(actor, c.id);
  return { slots: listSlots(c.id), coverage: listCoverage(actor, c.id, 4), periods: listPeriods(c.id) };
});
export const POST = userRoute<P>({ body: true }, ({ actor, params, body }) => ({ slot: createSlot(actor, getChapterBySlug(params.slug).id, body) }));
