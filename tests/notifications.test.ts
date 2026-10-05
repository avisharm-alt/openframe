import { beforeEach, describe, expect, it } from "vitest";
import { ADDRESS, NOTES, PHONE, world, type World } from "./fixtures";
import { setClock } from "@/lib/time";
import { arrive, assignVolunteer, completePickup, confirmWindow } from "@/lib/services/pickups";
import { getMyClaim, receiveClaim } from "@/lib/services/claims";
import { assignDeliveryVolunteer, completeDelivery, createDelivery, startDelivery } from "@/lib/services/deliveries";
import { decryptField, encryptField } from "@/lib/crypto";
import { getEmailProvider, queueEmail, registerEmailProvider, setEmailProvider } from "@/lib/email";
import { notifyAtRisk } from "@/lib/services/sweep";

let w: World;
beforeEach(() => {
  w = world();
});

describe("notifications", () => {
  it("sends neighbour, agency worker and volunteer emails at the right moments, and none ever contain private details", () => {
    const req = w.post({ quantity: 2 });
    const claimId = w.claimPickup(w.neighbour, req, { quantity: 2 });
    expect(w.sent.map((m) => [m.template, m.to])).toEqual([["request_claimed", "ark.worker@example.test"], ["claim_confirmed", "neighbour@example.test"]]);
    expect(w.sent[1].text).toMatch(/2 × Men's winter boots \(size 11\) for Ark Aid Street Mission/);
    expect(w.sent[1].text).toMatch(/within 48 hours/);
    const pk = getMyClaim(w.neighbour, claimId).pickup!;
    assignVolunteer(w.lonCoord, pk.id, { volunteerId: w.vol1.id });
    assignVolunteer(w.lonCoord, pk.id, { volunteerId: w.vol2.id });
    confirmWindow(w.lonCoord, pk.id, { windowId: pk.windows[0].id });
    expect(w.sent.filter((m) => m.template === "volunteer_assigned").map((m) => m.to)).toEqual(["vol.one@example.test", "vol.two@example.test"]);
    const scheduled = w.sent.filter((m) => m.template === "pickup_scheduled");
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].to).toBe("neighbour@example.test");
    expect(scheduled[0].text).toMatch(/Fri, Nov 6.*10:00 a\.m\. to 12:00 p\.m\./);
    expect(scheduled[0].text).toMatch(/Two volunteers will come together/);
    setClock(new Date("2026-11-06T15:00:00Z"));
    arrive(w.vol1, pk.id);
    arrive(w.vol2, pk.id);
    completePickup(w.vol1, pk.id, { outcome: "collected" });
    completePickup(w.vol2, pk.id, { outcome: "collected" });
    expect(w.sent.map((m) => m.template)).toContain("claim_collected");
    receiveClaim(w.lonCoord, claimId, { quantity: 2 });
    expect(w.sent.map((m) => m.template)).toContain("request_ready"); // worker: in hand, waiting for a delivery
    const { id: d } = createDelivery(w.lonCoord, w.london.id, { siteId: w.arkSite.id, requestIds: [req], plannedFor: "2026-11-07" });
    assignDeliveryVolunteer(w.lonCoord, d, { volunteerId: w.vol3.id });
    startDelivery(w.vol3, d);
    completeDelivery(w.vol3, d);
    expect(w.sent.map((m) => m.template)).toEqual([
      "request_claimed", "claim_confirmed", "volunteer_assigned", "volunteer_assigned", "pickup_scheduled", "claim_collected",
      "request_ready", "delivery_assigned", "delivery_on_the_way", "request_delivered", "claim_delivered",
    ]);
    const delivered = w.sent.at(-1)!;
    expect(delivered).toMatchObject({ to: "neighbour@example.test", subject: "Delivered to Ark Aid Street Mission" });
    const all = JSON.stringify(w.sent);
    for (const secret of [ADDRESS, NOTES, PHONE, "Wallaby"]) expect(all).not.toContain(secret);
  });

  it("alerts coordinators once when an unfilled request is close to its needed-by date", () => {
    w.post({ neededBy: "2026-11-04" });
    w.post({ neededBy: "2026-11-30" });
    expect(notifyAtRisk()).toBe(1); // 2 days out
    expect(notifyAtRisk()).toBe(0); // once
    const mail = w.sent.filter((m) => m.template === "request_at_risk");
    expect(mail.map((m) => m.to)).toEqual(["lon.coord@example.test"]);
    expect(mail[0].text).toMatch(/needed by 2026-11-04/);
  });

  it("a failing or throwing provider never breaks the action", () => {
    setEmailProvider({ name: "broken", send: async () => { throw new Error("smtp down"); } });
    expect(() => w.claimDropoff(w.neighbour, w.post())).not.toThrow();
    setEmailProvider({ name: "broken2", send: () => { throw new Error("sync boom"); } });
    expect(() => w.claimDropoff(w.neighbour2, w.post())).not.toThrow();
  });

  it("defaults to a console provider that logs no address or body, and supports registering a real one", async () => {
    setEmailProvider(null);
    expect(getEmailProvider().name).toBe("console");
    const lines: string[] = [];
    const orig = console.log;
    console.log = (...a: unknown[]) => void lines.push(a.join(" "));
    try {
      queueEmail({ to: "someone@example.org", subject: "Hello", text: "SECRET BODY", template: "t" });
      await Promise.resolve();
    } finally {
      console.log = orig;
    }
    expect(lines.join("\n")).toBe('[email:console] template=t to=s***@example.org subject="Hello"');
    registerEmailProvider("custom", () => ({ name: "custom", send: async () => {} }));
    process.env.EMAIL_PROVIDER = "custom";
    expect(getEmailProvider().name).toBe("custom");
    process.env.EMAIL_PROVIDER = "noop";
    expect(getEmailProvider().name).toBe("noop");
    delete process.env.EMAIL_PROVIDER;
  });
});

describe("field encryption (AES-256-GCM)", () => {
  it("round-trips, uses a fresh IV each time and never leaks the plaintext", () => {
    const a = encryptField("1 Main St", "row-1");
    const b = encryptField("1 Main St", "row-1");
    expect(a).not.toBe(b);
    expect(a).not.toContain("Main");
    expect(decryptField(a, "row-1")).toBe("1 Main St");
    expect(decryptField(encryptField("Zoë – 北京 🏠", "r"), "r")).toBe("Zoë – 北京 🏠");
  });
  it("detects tampering and a ciphertext moved onto another row", () => {
    const blob = encryptField("secret", "row-1");
    expect(() => decryptField(blob, "row-2")).toThrow();
    const parts = blob.split(".");
    parts[3] = Buffer.from("tampered!").toString("base64url");
    expect(() => decryptField(parts.join("."), "row-1")).toThrow();
    expect(() => decryptField("garbage", "row-1")).toThrow();
  });
  it("cannot be decrypted with a different key", () => {
    const blob = encryptField("secret", "row-1");
    const prev = process.env.PICKUP_ENCRYPTION_KEY;
    process.env.PICKUP_ENCRYPTION_KEY = "another-completely-different-key-0123456789abcdef";
    try {
      expect(() => decryptField(blob, "row-1")).toThrow();
    } finally {
      if (prev === undefined) delete process.env.PICKUP_ENCRYPTION_KEY;
      else process.env.PICKUP_ENCRYPTION_KEY = prev;
    }
  });
});
