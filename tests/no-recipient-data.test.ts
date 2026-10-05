import { describe, expect, it } from "vitest";
import { world } from "./fixtures";
import { freshDb } from "./helpers";
import { getDb } from "@/lib/db";
import { createRequest } from "@/lib/services/requests";
import { createDelivery } from "@/lib/services/deliveries";
import { claimSchema, deliverySchema, favouriteSchema, partnerSchema, receiveSchema, requestSchema, siteSchema } from "@/lib/validation";

// Recipients are never recorded: no names, descriptions or locations of the people served, anywhere.
describe("no recipient data is ever stored", () => {
  it("the schema has no table or column for recipients", () => {
    const db = freshDb();
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name);
    const banned = /recipient|beneficiar|person_served|served|resident|encampment|sighting|description_of|client_name|participant/i;
    for (const t of tables) {
      expect(t).not.toMatch(banned);
      const cols = (db.prepare(`PRAGMA table_info("${t}")`).all() as { name: string }[]).map((c) => c.name);
      for (const c of cols) expect(`${t}.${c}`, `unexpected column ${t}.${c}`).not.toMatch(banned);
    }
  });

  it("the request table holds only item, size, quantity, dates, urgency and a short note", () => {
    const db = freshDb();
    const cols = (db.prepare('PRAGMA table_info("request")').all() as { name: string }[]).map((c) => c.name).sort();
    expect(cols).toEqual([
      "chapter_id", "confirmed_at", "confirmed_by", "created_at", "created_by", "delivered_at", "delivery_site_id", "filled_from_stock", "id", "item_id", "kit_template_id",
      "needed_by", "note", "partner_id", "quantity", "risk_notified_at", "size", "status", "status_reason", "type", "updated_at", "urgency",
    ]);
    const claim = (db.prepare('PRAGMA table_info("claim")').all() as { name: string }[]).map((c) => c.name);
    expect(claim).not.toEqual(expect.arrayContaining(["recipient_id"]));
    expect((db.prepare('PRAGMA table_info("delivery")').all() as { name: string }[]).map((c) => c.name).sort()).toEqual(["chapter_id", "completed_at", "created_at", "created_by", "delivery_site_id", "id", "planned_for", "started_at", "status"]);
  });

  it("every input schema rejects extra fields, so recipient details cannot be sent", () => {
    const item = { type: "item", partnerId: "abcdefgh", siteId: "abcdefgh", itemId: "abcdefgh", size: "11", quantity: 1, neededBy: "2026-11-10" };
    expect(requestSchema.safeParse(item).success).toBe(true);
    for (const extra of [{ recipientName: "A. Person" }, { recipient: "man near the bridge" }, { forWho: "client" }, { location: "Dundas & Richmond" }, { description: "tall, beard" }]) {
      expect(requestSchema.safeParse({ ...item, ...extra }).success, JSON.stringify(extra)).toBe(false);
    }
    expect(partnerSchema.safeParse({ name: "Shelter", recipients: 40 }).success).toBe(false);
    expect(siteSchema.safeParse({ name: "S", address: "1 St", clients: 40 }).success).toBe(false);
    expect(deliverySchema.safeParse({ siteId: "abcdefgh", requestIds: ["abcdefgh"], plannedFor: "2026-11-05", recipientName: "x" }).success).toBe(false);
    expect(favouriteSchema.safeParse({ itemId: "abcdefgh", quantity: 1, recipient: "x" }).success).toBe(false);
    expect(receiveSchema.safeParse({ quantity: 1, recipient: "x" }).success).toBe(false);
    expect(claimSchema.safeParse({ requestId: "abcdefgh", quantity: 1, method: "dropoff", zoneId: "abcdefgh", expectedDate: "2026-11-05", forPerson: "x" }).success).toBe(false);
  });

  it("the public note cannot carry contact details or links", () => {
    const w = world();
    const base = { type: "item", partnerId: w.ark.id, siteId: w.arkSite.id, itemId: w.item("socks"), size: "", quantity: 1, neededBy: "2026-11-10" };
    expect(() => createRequest(w.worker, { ...base, note: "Contact Mike at 519-555-0100" })).toThrow();
    expect(() => createRequest(w.worker, { ...base, note: "mike@example.org" })).toThrow();
    expect(() => createRequest(w.worker, { ...base, note: "Warm socks please" })).not.toThrow();
  });

  it("a full request-to-delivery run leaves only agency, site, item and dates behind", () => {
    const w = world();
    w.stock("socks", 6);
    const r = w.post({ itemId: w.item("socks"), size: "", quantity: 6 });
    getDb().prepare("UPDATE request SET status = 'in_transit' WHERE id = ?").run(r);
    createDelivery(w.lonCoord, w.london.id, { siteId: w.arkSite.id, requestIds: [r], plannedFor: "2026-11-05" });
    const row = getDb().prepare("SELECT * FROM request WHERE id = ?").get(r) as Record<string, unknown>;
    for (const v of Object.values(row)) expect(String(v)).not.toMatch(/recipient|homeless person/i);
  });
});
