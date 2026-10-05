import { beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { world, NEEDED_BY, type World } from "./fixtures";
import { ServiceError } from "@/lib/errors";
import { setClock } from "@/lib/time";
import { resetRateLimits } from "@/lib/ratelimit";
import { cancelRequest, createRequest, deleteFavourite, lastRequest, listBoard, listFavourites, listPartnerRequests, saveFavourite } from "@/lib/services/requests";
import { createClaim, getMyClaim } from "@/lib/services/claims";
import { createKitTemplate, updateKitTemplate } from "@/lib/services/kits";
import { REQUEST_NOTE_MAX } from "@/lib/validation";
import { listItems } from "@/lib/services/items";

let w: World;
beforeEach(() => {
  w = world();
});
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    if (e instanceof ZodError) return "invalid";
    return e instanceof ServiceError ? e.code : (e as Error).message;
  }
  return "no error";
};
const base = () => ({ type: "item", partnerId: w.ark.id, siteId: w.arkSite.id, itemId: w.item("mens-winter-boots"), size: "11", quantity: 6, neededBy: NEEDED_BY });

describe("who can post requests", () => {
  it("only an approved agency worker of that partner", () => {
    expect(code(() => createRequest(w.worker, base()))).toBe("no error");
    expect(code(() => createRequest(w.pending, base()))).toBe("forbidden"); // asked for access, not approved
    expect(code(() => createRequest(w.worker2, base()))).toBe("forbidden"); // worker of another partner
    expect(code(() => createRequest(w.oshWorker, base()))).toBe("forbidden"); // another chapter
    expect(code(() => createRequest(w.neighbour, base()))).toBe("forbidden");
    expect(code(() => createRequest(w.lonCoord, base()))).toBe("forbidden"); // coordinators approve partners, they do not speak for them
  });

  it("not for a suspended partner, and the site must be that partner's own active site", () => {
    expect(code(() => createRequest(w.worker, { ...base(), siteId: w.otherSite.id }))).toBe("invalid");
    expect(code(() => createRequest(w.worker, { ...base(), siteId: w.oshSite.id }))).toBe("invalid");
  });
});

describe("request validation", () => {
  it("requires a valid size for sized items and none for unsized ones", () => {
    expect(code(() => createRequest(w.worker, { ...base(), size: "" }))).toBe("invalid");
    expect(code(() => createRequest(w.worker, { ...base(), size: "99" }))).toBe("invalid");
    expect(code(() => createRequest(w.worker, { ...base(), size: "11" }))).toBe("no error");
    expect(code(() => createRequest(w.worker, { ...base(), itemId: w.item("socks"), size: "M" }))).toBe("invalid");
    expect(code(() => createRequest(w.worker, { ...base(), itemId: w.item("socks"), size: "" }))).toBe("no error");
    expect(code(() => createRequest(w.worker, { ...base(), itemId: w.item("sweatshirt"), size: "xl" }))).toBe("no error"); // case-insensitive
  });

  it("keeps the public note short and free of anything identifying", () => {
    expect(code(() => createRequest(w.worker, { ...base(), note: "Size 11, wide fit" }))).toBe("no error");
    expect(code(() => createRequest(w.worker, { ...base(), note: "x".repeat(REQUEST_NOTE_MAX + 1) }))).toBe("invalid");
    for (const bad of ["call him on 519 555 0142", "email me a@b.co", "see https://example.org", "www.example.org", "5195550142"]) {
      expect(code(() => createRequest(w.worker, { ...base(), note: bad })), bad).toBe("invalid");
    }
  });

  it("rejects fields we never accept (a recipient name, description or location)", () => {
    for (const extra of [{ recipientName: "A. Person" }, { recipient: "man by the bridge" }, { clientDescription: "x" }, { location: "Dundas & Richmond" }]) {
      expect(code(() => createRequest(w.worker, { ...base(), ...extra })), JSON.stringify(extra)).toBe("invalid");
    }
  });

  it("needed-by must be today or later and within 60 days; quantity within limits", () => {
    expect(code(() => createRequest(w.worker, { ...base(), neededBy: "2026-11-01" }))).toBe("invalid");
    expect(code(() => createRequest(w.worker, { ...base(), neededBy: "2026-11-02" }))).toBe("no error"); // today
    expect(code(() => createRequest(w.worker, { ...base(), neededBy: "2027-03-01" }))).toBe("invalid");
    expect(code(() => createRequest(w.worker, { ...base(), quantity: 0 }))).toBe("invalid");
    expect(code(() => createRequest(w.worker, { ...base(), quantity: 501 }))).toBe("invalid");
  });

  it("rate-limits request creation per worker", () => {
    resetRateLimits();
    let last = "";
    for (let i = 0; i < 32; i++) last = code(() => createRequest(w.worker, { ...base(), size: "10" }));
    expect(last).toBe("rate_limited");
  });

  it("kit requests need an active kit template of the chapter", () => {
    const kit = createKitTemplate(w.lonCoord, w.london.id, { name: "Test kit", items: [{ itemId: w.item("socks"), quantity: 1 }] });
    const k = { type: "kit", partnerId: w.ark.id, siteId: w.arkSite.id, kitTemplateId: kit.id, quantity: 20, neededBy: NEEDED_BY };
    expect(code(() => createRequest(w.worker, k))).toBe("no error");
    updateKitTemplate(w.lonCoord, kit.id, { active: false });
    expect(code(() => createRequest(w.worker, k))).toBe("invalid");
    expect(code(() => createRequest(w.worker, { ...k, kitTemplateId: "does-not-exist" }))).toBe("not_found");
  });
});

describe("the public board", () => {
  it("shows open requests, urgent first, then soonest needed-by, with partner, site and exclusions", () => {
    const later = w.post({ itemId: w.item("socks"), size: "", quantity: 12, neededBy: "2026-11-12" });
    const soon = w.post({ itemId: w.item("toque"), size: "", quantity: 5, neededBy: "2026-11-05" });
    const urgent = w.post({ itemId: w.item("gloves"), size: "", quantity: 4, neededBy: "2026-11-11", urgency: "urgent" });
    const cards = listBoard(w.london.id);
    expect(cards.map((c) => c.requestId)).toEqual([urgent, soon, later]);
    expect(cards[0]).toMatchObject({ partnerName: "Ark Aid Street Mission", siteName: "Ark Aid main building", urgency: "urgent", quantity: 4, remaining: 4, claimable: true, excluded: "Used underwear, glass items" });
    expect(listBoard(w.oshawa.id)).toEqual([]);
  });

  it("filters by category and size", () => {
    w.post({ size: "11" });
    w.post({ size: "9" });
    w.post({ itemId: w.item("socks"), size: "" });
    w.post({ itemId: w.item("sweatshirt"), size: "L" });
    expect(listBoard(w.london.id, { category: "footwear" })).toHaveLength(2);
    expect(listBoard(w.london.id, { category: "footwear", size: "9" })).toHaveLength(1);
    expect(listBoard(w.london.id, { size: "L" })).toHaveLength(1);
    expect(listBoard(w.london.id, { category: "clothing" })).toHaveLength(2); // socks and the sweatshirt
    expect(listBoard(w.london.id, { category: "electronics" })).toEqual([]);
  });

  it("drops a request off the board once it is fully claimed, and shows only what is still unclaimed after a partial claim", () => {
    const id = w.post({ quantity: 6 });
    w.claimDropoff(w.neighbour, id, { quantity: 4 });
    expect(listBoard(w.london.id)[0]).toMatchObject({ quantity: 6, remaining: 2 });
    w.claimDropoff(w.neighbour2, id, { quantity: 2 });
    expect(listBoard(w.london.id)).toEqual([]);
  });

  it("lists kit requests as not claimable by neighbours", () => {
    const kit = createKitTemplate(w.lonCoord, w.london.id, { name: "Test kit", items: [{ itemId: w.item("socks"), quantity: 1 }] });
    createRequest(w.worker, { type: "kit", partnerId: w.ark.id, siteId: w.arkSite.id, kitTemplateId: kit.id, quantity: 20, neededBy: NEEDED_BY });
    expect(listBoard(w.london.id)[0]).toMatchObject({ type: "kit", label: "Test kit", quantity: 20, claimable: false, category: "kit" });
    expect(listBoard(w.london.id, { category: "kit" })).toHaveLength(1);
    expect(listBoard(w.london.id, { category: "footwear" })).toEqual([]);
    const id = listBoard(w.london.id)[0].requestId;
    expect(code(() => createClaim(w.neighbour, { requestId: id, quantity: 1, method: "dropoff", zoneId: w.zone.id, expectedDate: "2026-11-05" }))).toBe("kit_request");
  });

  it("never exposes who posted a request or anything private", () => {
    w.post({ note: "Wide fit if possible" });
    const text = JSON.stringify(listBoard(w.london.id));
    expect(text).not.toMatch(/Ark Worker|@example|created_by|createdBy/);
  });
});

describe("a partner sees only its own requests", () => {
  it("workers of Ark see Ark's, not another partner's; coordinators of the chapter can see them; other chapters cannot", () => {
    const mine = w.post();
    const theirs = w.post({ partnerId: w.other.id, siteId: w.otherSite.id }, w.worker2);
    expect(listPartnerRequests(w.worker, w.ark.id).map((r) => r.id)).toEqual([mine]);
    expect(listPartnerRequests(w.worker2, w.other.id).map((r) => r.id)).toEqual([theirs]);
    expect(code(() => listPartnerRequests(w.worker, w.other.id))).toBe("forbidden");
    expect(code(() => listPartnerRequests(w.pending, w.ark.id))).toBe("forbidden");
    expect(code(() => listPartnerRequests(w.neighbour, w.ark.id))).toBe("forbidden");
    expect(code(() => listPartnerRequests(w.oshWorker, w.ark.id))).toBe("forbidden");
    expect(code(() => listPartnerRequests(w.oshCoord, w.ark.id))).toBe("forbidden");
    expect(code(() => listPartnerRequests(w.lonCoord, w.ark.id))).toBe("no error");
  });
});

describe("cancelling", () => {
  it("a worker cancels their own partner's open request; another partner's worker cannot", () => {
    const id = w.post();
    expect(code(() => cancelRequest(w.worker2, id))).toBe("not_found");
    expect(code(() => cancelRequest(w.neighbour, id))).toBe("not_found");
    cancelRequest(w.worker, id);
    expect(listBoard(w.london.id)).toEqual([]);
    expect(code(() => cancelRequest(w.worker, id))).toBe("not_cancellable");
  });

  it("releases neighbours who have not handed anything over yet", () => {
    const id = w.post();
    const c = w.claimPickup(w.neighbour, id);
    cancelRequest(w.worker, id);
    expect(getMyClaim(w.neighbour, c).status).toBe("cancelled");
  });
});

describe("repeat last request and favourites", () => {
  it("returns the worker's last item request to post again, and keeps favourites per worker", () => {
    expect(lastRequest(w.worker, w.ark.id)).toBeNull();
    w.post({ quantity: 3, size: "10" });
    w.post({ quantity: 7, size: "12", urgency: "urgent" });
    expect(lastRequest(w.worker, w.ark.id)).toMatchObject({ itemId: w.item("mens-winter-boots"), size: "12", quantity: 7, urgency: "urgent", siteId: w.arkSite.id });
    const { id } = saveFavourite(w.worker, w.ark.id, { itemId: w.item("socks"), quantity: 10 });
    expect(listFavourites(w.worker, w.ark.id)).toMatchObject([{ id, label: "Socks", quantity: 10 }]);
    expect(code(() => listFavourites(w.pending, w.ark.id))).toBe("forbidden");
    expect(code(() => deleteFavourite(w.worker2, id))).toBe("not_found");
    deleteFavourite(w.worker, id);
    expect(listFavourites(w.worker, w.ark.id)).toEqual([]);
    expect(code(() => saveFavourite(w.worker, w.ark.id, { itemId: w.item("mens-winter-boots"), size: "", quantity: 1 }))).toBe("invalid"); // needs a size
  });
});

describe("catalog", () => {
  it("has sized footwear, clothing, electronics and bags", () => {
    const items = listItems();
    expect(items.find((i) => i.slug === "mens-winter-boots")).toMatchObject({ category: "footwear", sizeScheme: "shoe" });
    expect(items.find((i) => i.slug === "phone-charger-usbc")).toMatchObject({ category: "electronics", sizeScheme: "none" });
    expect(items.find((i) => i.slug === "backpack")).toMatchObject({ category: "bags" });
    expect(items.find((i) => i.slug === "pants-numeric")).toMatchObject({ sizeScheme: "numeric" });
  });
  it("uses the injected clock for needed-by", () => {
    setClock(new Date("2026-12-24T12:00:00Z"));
    expect(code(() => createRequest(w.worker, base()))).toBe("invalid"); // 10 Nov is now in the past
  });
});
