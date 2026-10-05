import { adminRoute, publicRoute } from "@/lib/http";
import { createChapter, listChapters } from "@/lib/services/chapters";

export const GET = publicRoute({}, () => ({ chapters: listChapters() }));
export const POST = adminRoute({ body: true }, ({ actor, body }) => ({ chapter: createChapter(actor, body) }));
