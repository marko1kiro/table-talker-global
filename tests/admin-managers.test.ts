import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("admin-managers server fn", () => {
  const text = () =>
    readFileSync(new URL("../src/lib/admin-managers.server.ts", import.meta.url), "utf8");
  it("guards both actions behind requireSuperAdmin", () => {
    expect(text()).toContain("requireSuperAdmin");
    expect(text()).toContain("listManagers");
    expect(text()).toContain("disableManager");
  });
  it("disable sets status nonaktif and deletes live sessions", () => {
    expect(text()).toContain('status: "nonaktif"');
    expect(text()).toContain('from("manager_sessions")');
    expect(text()).toContain(".delete()");
  });
});

describe("super-admin managers route", () => {
  const text = () =>
    readFileSync(new URL("../src/routes/super-admin/managers.tsx", import.meta.url), "utf8");
  it("lists managers and offers a Nonaktifkan action", () => {
    expect(text()).toContain("listManagers");
    expect(text()).toContain("Nonaktifkan");
    expect(text()).toContain("disableManager");
  });
});
