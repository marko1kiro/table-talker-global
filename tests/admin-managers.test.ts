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
  it("disable routes through the audit+revoke RPC (no direct table writes)", () => {
    expect(text()).toContain('p_new_status: "nonaktif"');
    expect(text()).toContain('rpc("set_manager_status"');
    expect(text()).not.toContain('from("manager_sessions")');
    expect(text()).not.toContain(".delete()");
  });
  it("Super Admin can create/rename/enable managers (no self-registration)", () => {
    expect(text()).toContain("saCreateManager");
    expect(text()).toContain("saRenameManager");
    expect(text()).toContain("enableManager");
    expect(text()).toContain("create_manager_account");
    expect(text()).not.toContain("register");
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
