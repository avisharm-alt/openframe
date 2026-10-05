import { z } from "zod";
import { adminRoute, publicRoute } from "@/lib/http";
import { getChapterBySlug } from "@/lib/services/access";
import { setChapterActive } from "@/lib/services/chapters";
import { listPartners, listSites } from "@/lib/services/partners";
import { listBoard } from "@/lib/services/requests";
import { listZones } from "@/lib/services/zones";

type P = { slug: string };

// Public: the live request board (filter with ?category= and ?size=), drop-off zones, and partners with their delivery sites.
export const GET = publicRoute<P>({}, ({ params, req }) => {
  const chapter = getChapterBySlug(params.slug);
  const q = new URL(req.url).searchParams;
  return {
    chapter,
    board: listBoard(chapter.id, { category: q.get("category") ?? undefined, size: q.get("size") ?? undefined }),
    zones: listZones(chapter.id, { activeOnly: true }),
    partners: listPartners(chapter.id).map((p) => ({
      id: p.id, name: p.name, description: p.description, excludedItems: p.excludedItems,
      sites: listSites(p.id, { activeOnly: true }).map((s) => ({ id: s.id, name: s.name, address: s.address, receivingHours: s.receivingHours })),
    })),
  };
});

export const PATCH = adminRoute<P>({ body: true }, ({ actor, params, body }) => {
  const { active } = z.strictObject({ active: z.boolean() }).parse(body);
  setChapterActive(actor, getChapterBySlug(params.slug).id, active);
  return { ok: true };
});
