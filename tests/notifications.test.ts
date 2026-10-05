import { beforeEach, describe, expect, it } from "vitest";
import { ADDRESS, NOTES, PHONE, world, type World } from "./fixtures";
import { setClock } from "@/lib/time";
import { arrive, assignVolunteer, completePickup, confirmWindow } from "@/lib/services/pickups";
import { getMyPledge, receivePledge } from "@/lib/services/pledges";
import { decryptField, encryptField } from "@/lib/crypto";
import { getEmailProvider, queueEmail, registerEmailProvider, setEmailProvider } from "@/lib/email";

let w: World;
beforeEach(() => {
  w = world();
});

describe("notifications", () => {
  it("sends the donor and volunteer emails at the right moments, and none ever contain private details", () => {
    const pledgeId = w.pickupPledge();
    expect(w.sent.map((m) => [m.template, m.to])).toEqual([["pledge_confirmed", "donor@example.test"]]);
    expect(w.sent[0].text).toMatch(/4 × Socks, 2 × Toque/);
    const pk = getMyPledge(w.donor, pledgeId).pickup!;
    assignVolunteer(w.lonCoord, pk.id, { volunteerId: w.vol1.id });
    assignVolunteer(w.lonCoord, pk.id, { volunteerId: w.vol2.id });
    confirmWindow(w.lonCoord, pk.id, { windowId: pk.windows[0].id });
    expect(w.sent.filter((m) => m.template === "volunteer_assigned").map((m) => m.to)).toEqual(["vol.one@example.test", "vol.two@example.test"]);
    const scheduled = w.sent.filter((m) => m.template === "pickup_scheduled");
    expect(scheduled).toHaveLength(1); // once, when it actually becomes scheduled
    expect(scheduled[0].to).toBe("donor@example.test");
    expect(scheduled[0].text).toMatch(/Fri, Nov 6.*10:00 a\.m\. to 12:00 p\.m\./);
    expect(scheduled[0].text).toMatch(/Two volunteers will come together/);
    setClock(new Date("2026-11-06T15:00:00Z"));
    arrive(w.vol1, pk.id);
    arrive(w.vol2, pk.id);
    completePickup(w.vol1, pk.id, { outcome: "collected" });
    completePickup(w.vol2, pk.id, { outcome: "collected" });
    expect(w.sent.map((m) => m.template)).toContain("pledge_collected");
    const lines = getMyPledge(w.donor, pledgeId).items;
    receivePledge(w.lonCoord, pledgeId, { lines: lines.map((l) => ({ lineId: l.lineId, quantity: l.quantity })) });
    expect(w.sent.map((m) => m.template)).toEqual(["pledge_confirmed", "volunteer_assigned", "volunteer_assigned", "pickup_scheduled", "pledge_collected", "thank_you"]);
    const all = JSON.stringify(w.sent);
    for (const secret of [ADDRESS, NOTES, PHONE, "Wallaby"]) expect(all).not.toContain(secret);
  });

  it("a failing or throwing provider never breaks the action", () => {
    setEmailProvider({ name: "broken", send: async () => { throw new Error("smtp down"); } });
    expect(() => w.dropoffPledge()).not.toThrow();
    setEmailProvider({ name: "broken2", send: () => { throw new Error("sync boom"); } });
    expect(() => w.dropoffPledge(w.donor2)).not.toThrow();
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
    expect(decryptField(encryptField("", "row-1"), "row-1")).toBe("");
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
