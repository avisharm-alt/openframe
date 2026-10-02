import { publicRoute } from "@/lib/http";
import { answerQuestion } from "@/lib/services/practice";
import { answerSchema } from "@/lib/validation";

export const POST = publicRoute<{ id: string }>({ body: true }, ({ actor, params, body }) =>
  answerQuestion(params.id, actor, answerSchema.parse(body)),
);
