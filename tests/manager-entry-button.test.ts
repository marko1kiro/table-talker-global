import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Poin 3 Task 9 (hard cutover): the manager entry moved out of the deleted
// RoleLoginFlow and onto the homepage itself, so it shows on EVERY crew step
// (boot, email, otp, waiting, kick, disabled) rather than only the first.
const text = () => readFileSync(new URL("../src/routes/index.tsx", import.meta.url), "utf8");

describe("manager entry button", () => {
  it("offers a separated manager login alongside the crew flow", () => {
    expect(text()).toContain("Login Manager");
    expect(text()).toContain('to="/manager/login"');
  });
});
