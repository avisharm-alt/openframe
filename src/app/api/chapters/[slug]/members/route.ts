import { userRoute } from "@/lib/http";
import { getChapterBySlug } from "@/lib/services/access";
import { listMembers, setMember } from "@/lib/services/chapters";

type P = { slug: string };
export const GET = userRoute<P>({}, ({ actor, params }) => ({ members: listMembers(actor, getChapterBySlug(params.slug).id) }));
export const POST = userRoute<P>({ body: true }, ({ actor, params, body }) => setMember(actor, getChapterBySlug(params.slug).id, body));
