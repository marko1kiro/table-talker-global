import { describe, expect, it } from "vitest";
import { hashManagerPassword, verifyManagerPassword } from "../src/lib/manager-password.server";

describe("manager password hashing", () => {
  it("round-trips a correct password", async () => {
    const stored = await hashManagerPassword("rahasia123");
    expect(stored).toMatch(/^[a-f0-9]{32}:[a-f0-9]{128}$/);
    expect(await verifyManagerPassword("rahasia123", stored)).toBe(true);
  });
  it("rejects a wrong password", async () => {
    const stored = await hashManagerPassword("rahasia123");
    expect(await verifyManagerPassword("salah", stored)).toBe(false);
  });
  it("uses a fresh salt each time", async () => {
    const a = await hashManagerPassword("same");
    const b = await hashManagerPassword("same");
    expect(a).not.toBe(b);
    expect(await verifyManagerPassword("same", a)).toBe(true);
    expect(await verifyManagerPassword("same", b)).toBe(true);
  });
  it("returns false for a malformed stored hash", async () => {
    expect(await verifyManagerPassword("x", "not-a-hash")).toBe(false);
  });
});
