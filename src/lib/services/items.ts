import { getDb, uid } from "../db";
import { conflict, forbidden, notFound } from "../errors";
import { itemSchema } from "../validation";
import type { Actor, ItemCategory } from "../types";
import { logAudit } from "./audit";
import { isCoordinatorAnywhere } from "./access";

export type Item = { id: string; slug: string; name: string; category: ItemCategory; unit: string; newOnly: boolean; active: boolean };
type Row = Omit<Item, "newOnly" | "active"> & { new_only: number; active: number };
const toItem = (r: Row): Item => ({ id: r.id, slug: r.slug, name: r.name, category: r.category, unit: r.unit, newOnly: !!r.new_only, active: !!r.active });

export function listItems(opts: { activeOnly?: boolean } = {}): Item[] {
  return (getDb().prepare(`SELECT * FROM item ${opts.activeOnly ? "WHERE active = 1" : ""} ORDER BY category, name`).all() as Row[]).map(toItem);
}
export function getItem(id: string): Item {
  const r = getDb().prepare("SELECT * FROM item WHERE id = ?").get(id) as Row | undefined;
  if (!r) throw notFound("Item not found");
  return toItem(r);
}

const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50);

/** The catalog is shared by all chapters. Any chapter coordinator (or an admin) may add an item. */
export function createItem(actor: Actor, raw: unknown): Item {
  if (!isCoordinatorAnywhere(actor)) throw forbidden("Only coordinators can add catalog items.");
  const input = itemSchema.parse(raw);
  const db = getDb();
  const slug = slugify(input.name) || "item";
  if (db.prepare("SELECT 1 FROM item WHERE slug = ?").get(slug)) throw conflict("item_exists", "An item with that name is already in the catalog.");
  const id = uid();
  db.prepare("INSERT INTO item (id, slug, name, category, unit, new_only, active) VALUES (?,?,?,?,?,?,1)").run(id, slug, input.name, input.category, input.unit, input.newOnly ? 1 : 0);
  logAudit(actor.id, "item_created", { subjectType: "item", subjectId: id });
  return getItem(id);
}
