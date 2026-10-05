import { getDb, uid } from "../db";
import { conflict, forbidden, invalid, notFound } from "../errors";
import { itemSchema } from "../validation";
import { SIZES, type Actor, type ItemCategory, type SizeScheme } from "../types";
import { logAudit } from "./audit";
import { isCoordinatorAnywhere } from "./access";

export type Item = { id: string; slug: string; name: string; category: ItemCategory; sizeScheme: SizeScheme; unit: string; newOnly: boolean; active: boolean };
type Row = { id: string; slug: string; name: string; category: ItemCategory; size_scheme: SizeScheme; unit: string; new_only: number; active: number };
const toItem = (r: Row): Item => ({ id: r.id, slug: r.slug, name: r.name, category: r.category, sizeScheme: r.size_scheme, unit: r.unit, newOnly: !!r.new_only, active: !!r.active });

export function listItems(opts: { activeOnly?: boolean } = {}): Item[] {
  return (getDb().prepare(`SELECT * FROM item ${opts.activeOnly ? "WHERE active = 1" : ""} ORDER BY category, name`).all() as Row[]).map(toItem);
}
export function getItem(id: string): Item {
  const r = getDb().prepare("SELECT * FROM item WHERE id = ?").get(id) as Row | undefined;
  if (!r) throw notFound("Item not found");
  return toItem(r);
}

/** A sized item needs one of its scheme's sizes; an unsized item must have none. Returns the cleaned size ("" for none). */
export function normalizeSize(item: Pick<Item, "name" | "sizeScheme">, size: string): string {
  const s = size.trim().toUpperCase();
  if (item.sizeScheme === "none") {
    if (s) throw invalid(`“${item.name}” does not come in sizes.`);
    return "";
  }
  if (!s) throw invalid(`Choose a size for “${item.name}”.`);
  if (!SIZES[item.sizeScheme].includes(s)) throw invalid(`“${size}” is not a valid size for “${item.name}”. Choose one of: ${SIZES[item.sizeScheme].join(", ")}.`);
  return s;
}

export const itemLabel = (name: string, size: string) => (size ? `${name} (size ${size})` : name);

const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50);

/** The catalog is shared by all chapters. Any chapter coordinator (or an admin) may add an item. */
export function createItem(actor: Actor, raw: unknown): Item {
  if (!isCoordinatorAnywhere(actor)) throw forbidden("Only coordinators can add catalog items.");
  const input = itemSchema.parse(raw);
  const db = getDb();
  const slug = slugify(input.name) || "item";
  if (db.prepare("SELECT 1 FROM item WHERE slug = ?").get(slug)) throw conflict("item_exists", "An item with that name is already in the catalog.");
  const id = uid();
  db.prepare("INSERT INTO item (id, slug, name, category, size_scheme, unit, new_only, active) VALUES (?,?,?,?,?,?,?,1)").run(id, slug, input.name, input.category, input.sizeScheme, input.unit, input.newOnly ? 1 : 0);
  logAudit(actor.id, "item_created", { subjectType: "item", subjectId: id });
  return getItem(id);
}
