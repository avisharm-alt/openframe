import { z } from "zod";
import { reviewerRoute } from "@/lib/http";
import { deleteNoteAsMaintainer, getNoteForReview, setNoteStatus } from "@/lib/services/notes";

const statusSchema = z.strictObject({ status: z.enum(["new", "used", "declined"]) });

/** Maintainers only (enforced in the service). Opening a note is written to the audit log. */
export const GET = reviewerRoute<{ id: string }>({}, ({ actor, params }) => getNoteForReview(actor, params.id));
export const PATCH = reviewerRoute<{ id: string }>({ body: true }, ({ actor, params, body }) => setNoteStatus(actor, params.id, statusSchema.parse(body).status));
export const DELETE = reviewerRoute<{ id: string }>({}, ({ actor, params }) => deleteNoteAsMaintainer(actor, params.id));
