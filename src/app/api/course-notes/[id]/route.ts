import { getActor, errorResponse, userRoute } from "@/lib/http";
import { ServiceError } from "@/lib/errors";
import { deleteCourseNote, readCourseNote } from "@/lib/services/course-notes";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const actor = await getActor(req.headers);
    if (!actor) throw new ServiceError(401, "unauthenticated", "Please sign in.");
    const note = readCourseNote(actor, (await ctx.params).id);
    return new Response(new Uint8Array(note.content), { headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": "attachment; filename*=UTF-8''" + encodeURIComponent(note.filename),
      "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store",
      "Content-Security-Policy": "sandbox; default-src 'none'",
    } });
  } catch (e) { return errorResponse(e); }
}
export const DELETE = userRoute<{ id: string }>({}, ({ actor, params }) => deleteCourseNote(actor, params.id));
