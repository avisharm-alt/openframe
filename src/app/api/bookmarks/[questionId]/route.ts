import { userRoute } from "@/lib/http";
import { addBookmark, removeBookmark } from "@/lib/services/bookmarks";

export const PUT = userRoute<{ questionId: string }>({}, ({ actor, params }) => addBookmark(actor, params.questionId));
export const DELETE = userRoute<{ questionId: string }>({}, ({ actor, params }) => removeBookmark(actor, params.questionId));
