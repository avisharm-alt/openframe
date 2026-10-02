import { describe, expect, it } from "vitest";
import { emailPolicyError } from "@/lib/email-policy";

const uwo = ["uwo.ca"];

describe("email domain policy", () => {
  it("allows plain addresses on an allowed domain, case-insensitively", () => {
    expect(emailPolicyError("jsmith45@uwo.ca", uwo)).toBeNull();
    expect(emailPolicyError("  JSmith45@UWO.CA ", uwo)).toBeNull();
  });
  it("rejects other domains and look-alikes", () => {
    for (const bad of ["a@gmail.com", "a@uwo.ca.evil.com", "uwo.ca@evil.com", "a@evil-uwo.ca", "a@mail.uwo.ca", "a@uwo.ca@evil.com", "@uwo.ca", "uwo.ca", ""]) {
      expect(emailPolicyError(bad, uwo), bad).toMatch(/limited to @uwo\.ca|plain university/);
    }
  });
  it("rejects +aliases so one mailbox is one account", () => {
    expect(emailPolicyError("jsmith45+x@uwo.ca", uwo)).toMatch(/alias/);
  });
  it("is unrestricted when no domains are configured (local/demo only)", () => {
    expect(emailPolicyError("anyone@example.com", [])).toBeNull();
  });
  it("supports several domains", () => {
    expect(emailPolicyError("a@uwo.ca", ["uwo.ca", "example.edu"])).toBeNull();
    expect(emailPolicyError("a@example.edu", ["uwo.ca", "example.edu"])).toBeNull();
    expect(emailPolicyError("a@gmail.com", ["uwo.ca", "example.edu"])).toMatch(/@uwo\.ca or @example\.edu/);
  });
});
