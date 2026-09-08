import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("staff login route", () => {
  const text = () => read("../src/routes/manager/login.tsx");
  it("collects a single staff ID + password and routes by authoritative role", () => {
    expect(text()).toContain("loginStaff");
    expect(text()).toContain('role === "manager"');
    expect(text()).toContain('navigate({ to: "/am" })');
    expect(text()).toContain('navigate({ to: "/manager" })');
  });
  it("no longer offers Manager self-registration", () => {
    expect(text()).not.toContain("register");
    expect(text()).not.toContain("ID MANAGER BARU");
  });
  it("links to the public forgot-password flow", () => {
    expect(text()).toContain("/manager/forgot");
  });
  it("uses TailAdmin auth primitives with a show/hide password toggle", () => {
    expect(text()).toContain("AuthLayout");
    expect(text()).toContain("IconField");
    expect(text()).toContain("showPassword");
    expect(text()).toContain("EyeOff");
  });
  it("gates submit until both fields are filled", () => {
    expect(text()).toContain("canSubmit");
    expect(text()).toContain("disabled={!canSubmit || busy}");
  });
});

describe("manager self-registration removal", () => {
  it("the register route file no longer exists", () => {
    expect(existsSync(new URL("../src/routes/manager/register.tsx", import.meta.url))).toBe(false);
  });
  it("no server module exports a public Manager registration action", () => {
    const auth = read("../src/lib/manager-auth.server.ts");
    expect(auth).not.toContain("registerManager");
  });
  it("no active source references the register route or RPC", () => {
    const files = [
      "../src/lib/manager-auth.server.ts",
      "../src/routes/manager/login.tsx",
      "../src/routes/index.tsx",
    ];
    for (const file of files) {
      expect(read(file)).not.toContain("register_manager");
    }
  });
});
