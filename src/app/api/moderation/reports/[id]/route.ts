import { z } from "zod";
import { reviewerRoute } from "@/lib/http";
import { updateReport } from "@/lib/services/moderation";

const schema = z.strictObject({ state: z.enum(["open", "investigating", "resolved", "dismissed"]), note: z.string().trim().max(1000).optional() });

export const PATCH = reviewerRoute<{ id: string }>({ body: true }, ({ actor, params, body }) => updateReport(actor, params.id, schema.parse(body)));
