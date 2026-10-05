import { publicRoute, userRoute } from "@/lib/http";
import { createItem, listItems } from "@/lib/services/items";

export const GET = publicRoute({}, () => ({ items: listItems({ activeOnly: true }) }));
export const POST = userRoute({ body: true }, ({ actor, body }) => ({ item: createItem(actor, body) }));
