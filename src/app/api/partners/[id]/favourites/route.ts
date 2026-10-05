import { userRoute } from "@/lib/http";
import { listFavourites, saveFavourite } from "@/lib/services/requests";

type P = { id: string };
export const GET = userRoute<P>({}, ({ actor, params }) => ({ favourites: listFavourites(actor, params.id) }));
export const POST = userRoute<P>({ body: true }, ({ actor, params, body }) => saveFavourite(actor, params.id, body));
