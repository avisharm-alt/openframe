import { z } from "zod";
import { reviewerRoute } from "@/lib/http";
import { deleteAnyQuestion } from "@/lib/services/deletion";

const schema = z.strictObject({ reason: z.string().trim().min(5).max(500) });

/** Maintainers only (enforced in the service): permanently delete any question. */
export const DELETE = reviewerRoute<{ id: string }>({ body: true }, ({ actor, params, body }) => deleteAnyQuestion(actor, params.id, schema.parse(body).reason));
