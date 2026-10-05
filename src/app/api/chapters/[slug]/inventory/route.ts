import { userRoute } from "@/lib/http";
import { getChapterBySlug } from "@/lib/services/access";
import { adjustStock, listInventory, listLedger } from "@/lib/services/inventory";

type P = { slug: string };
export const GET = userRoute<P>({}, ({ actor, params }) => {
  const id = getChapterBySlug(params.slug).id;
  return { inventory: listInventory(actor, id), ledger: listLedger(actor, id, 30) };
});
export const POST = userRoute<P>({ body: true }, ({ actor, params, body }) => adjustStock(actor, getChapterBySlug(params.slug).id, body));
