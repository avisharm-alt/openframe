import { NextResponse } from "next/server";
import { getActor, errorResponse } from "@/lib/http";
import { config } from "@/lib/config";
import { guardRequest } from "@/lib/guard";
import { ServiceError } from "@/lib/errors";
import { rateLimit } from "@/lib/ratelimit";
import { MAX_NOTE_REQUEST_BYTES, requireNotesUploads, saveCourseNote } from "@/lib/services/course-notes";

export async function POST(req: Request) {
  try {
    requireNotesUploads(); // 404 while the feature is off, before anything else is looked at
    const bad = guardRequest(req, { baseUrl: config.baseUrl, trustProxy: config.trustProxy, notesUploads: config.notesUploadsEnabled });
    if (bad) throw new ServiceError(bad.status, bad.code, bad.message);
    const actor = await getActor(req.headers);
    if (!actor) throw new ServiceError(401, "unauthenticated", "Sign in to upload course notes.");
    if (!req.headers.get("content-type")?.startsWith("multipart/form-data;")) throw new ServiceError(415, "invalid", "Use the course notes upload form.");
    rateLimit("course-notes:" + actor.id, 5, 3600_000);
    const reader = req.body?.getReader();
    if (!reader) throw new ServiceError(400, "invalid", "Choose a file.");
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.length;
      if (length > MAX_NOTE_REQUEST_BYTES) { await reader.cancel(); throw new ServiceError(413, "too_large", "Choose a file up to 10 MB."); }
      chunks.push(part.value);
    }
    let form: FormData;
    try {
      form = await new Response(Buffer.concat(chunks), { headers: { "content-type": req.headers.get("content-type")! } }).formData();
    } catch { throw new ServiceError(400, "invalid", "The upload could not be read. Please choose the file again."); }
    const file = form.get("file");
    if (!(file instanceof File) || form.getAll("file").length !== 1) throw new ServiceError(422, "invalid", "Choose one PDF or text file.");
    return NextResponse.json(saveCourseNote(actor, String(form.get("courseId") ?? ""), file.name, Buffer.from(await file.arrayBuffer()), form.get("ownNotes") === "true"), { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (e) { return errorResponse(e); }
}
