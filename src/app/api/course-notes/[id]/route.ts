import { getActor, errorResponse, userRoute } from "@/lib/http";
import { ServiceError } from "@/lib/errors";
import { deleteCourseNote, readCourseNote, requireNotesUploads } from "@/lib/services/course-notes";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    requireNotesUploads(); // 404 while the feature is off, even for signed-out requests
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

const remove = userRoute<{ id: string }>({}, ({ actor, params }) => deleteCourseNote(actor, params.id));
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try { requireNotesUploads(); } catch (e) { return errorResponse(e); }
  return remove(req, ctx);
}
