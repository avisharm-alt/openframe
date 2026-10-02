import { userRoute } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";
import { NOTES_MAX_FILES } from "@/lib/attestation";
import { ServiceError, invalid } from "@/lib/errors";
import { listMyNotes, submitNote, type IncomingFile } from "@/lib/services/notes";

const FIELDS = new Set(["courseId", "title", "text", "ownWork", "aiConsent", "files"]);
const text = (v: FormDataEntryValue | null) => (typeof v === "string" ? v : "");

export const GET = userRoute({}, ({ actor }) => ({ notes: listMyNotes(actor) }));

/**
 * Send notes as JSON (pasted text only) or as multipart/form-data (pasted text and/or files). This is the only route that accepts a
 * file upload; src/lib/guard.ts caps the request size before the body is read, and the service validates every file.
 */
export const POST = userRoute({}, async ({ actor, req }) => {
  rateLimit(`note-submit:${actor.id}`, 10, 3600_000);
  const ct = (req.headers.get("content-type") || "").toLowerCase();
  if (ct.startsWith("multipart/form-data")) {
    let form: FormData;
    try { form = await req.formData(); } catch { throw new ServiceError(400, "bad_form", "The upload could not be read. Please try again."); }
    for (const k of new Set(form.keys())) if (!FIELDS.has(k)) throw invalid("Unexpected field in the upload.");
    const parts = form.getAll("files").filter((v): v is File => typeof v !== "string");
    if (parts.length > NOTES_MAX_FILES) throw invalid(`You can attach at most ${NOTES_MAX_FILES} files to one note.`);
    const files: IncomingFile[] = [];
    for (const f of parts) files.push({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
    return submitNote(actor, {
      courseId: text(form.get("courseId")), title: text(form.get("title")), text: text(form.get("text")),
      ownWork: form.get("ownWork") === "true", aiConsent: form.get("aiConsent") === "true",
    }, files);
  }
  const raw = await req.text();
  if (raw.length > 100_000) throw new ServiceError(413, "too_large", "Request body is too large.");
  let body: unknown;
  try { body = raw ? JSON.parse(raw) : {}; } catch { throw new ServiceError(400, "bad_json", "Request body must be valid JSON."); }
  return submitNote(actor, body);
});
