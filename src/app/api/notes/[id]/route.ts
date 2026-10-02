import { userRoute } from "@/lib/http";
import { deleteMyNote } from "@/lib/services/notes";

export const DELETE = userRoute<{ id: string }>({}, ({ actor, params }) => deleteMyNote(actor, params.id));
