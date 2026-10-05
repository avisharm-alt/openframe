import { z } from "zod";
import { adminRoute, publicRoute } from "@/lib/http";
import { getChapterBySlug } from "@/lib/services/access";
import { setChapterActive } from "@/lib/services/chapters";
import { listBoard } from "@/lib/services/needs";
import { listPartners } from "@/lib/services/partners";
import { listZones } from "@/lib/services/zones";

type P = { slug: string };

// Public: the live needs board, drop-off zones and partner agencies (name and description only).
export const GET = publicRoute<P>({}, ({ params }) => {
  const chapter = getChapterBySlug(params.slug);
  return {
    chapter,
    board: listBoard(chapter.id),
    zones: listZones(chapter.id, { activeOnly: true }),
    partners: listPartners(chapter.id, { activeOnly: true }).map((p) => ({ id: p.id, name: p.name, description: p.description, acceptsPackages: p.acceptsPackages })),
  };
});

export const PATCH = adminRoute<P>({ body: true }, ({ actor, params, body }) => {
  const { active } = z.strictObject({ active: z.boolean() }).parse(body);
  setChapterActive(actor, getChapterBySlug(params.slug).id, active);
  return { ok: true };
});
