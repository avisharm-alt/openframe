import { afterEach, describe, expect, it } from "vitest";
import { config } from "@/lib/config";

const KEYS = ["NODE_ENV", "PICKUP_ENCRYPTION_KEY", "NEXT_PHASE", "PICKUP_PURGE_DAYS", "PICKUP_VISIBLE_HOURS_BEFORE"];
const saved: Record<string, string | undefined> = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
afterEach(() => KEYS.forEach((k) => (saved[k] === undefined ? delete process.env[k] : ((process.env as Record<string, string>)[k] = saved[k]!))));
const env = process.env as Record<string, string | undefined>;

describe("pickup configuration", () => {
  it("refuses to run in production without a long PICKUP_ENCRYPTION_KEY", () => {
    env.NODE_ENV = "production";
    delete env.PICKUP_ENCRYPTION_KEY;
    expect(() => config.pickupEncryptionSecret).toThrow(/PICKUP_ENCRYPTION_KEY/);
    env.PICKUP_ENCRYPTION_KEY = "too-short";
    expect(() => config.pickupEncryptionSecret).toThrow(/PICKUP_ENCRYPTION_KEY/);
    env.PICKUP_ENCRYPTION_KEY = "x".repeat(40);
    expect(config.pickupEncryptionSecret).toHaveLength(40);
  });
  it("allows a dev key outside production and during the build", () => {
    env.NODE_ENV = "development";
    delete env.PICKUP_ENCRYPTION_KEY;
    expect(config.pickupEncryptionSecret).toMatch(/dev-only/);
    env.NODE_ENV = "production";
    env.NEXT_PHASE = "phase-production-build";
    expect(config.pickupEncryptionSecret).toMatch(/dev-only/);
  });
  it("defaults to the proposed policy: purge after 7 days, visible 24 hours before, overdue after 2 hours", () => {
    delete env.PICKUP_PURGE_DAYS;
    delete env.PICKUP_VISIBLE_HOURS_BEFORE;
    expect([config.pickupPurgeDays, config.pickupVisibleHoursBefore, config.pickupOverdueHours]).toEqual([7, 24, 2]);
    env.PICKUP_PURGE_DAYS = "14";
    expect(config.pickupPurgeDays).toBe(14);
  });
});
