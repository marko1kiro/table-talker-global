import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = (f: string) =>
  readFileSync(new URL(`../src/components/dashboard/${f}`, import.meta.url), "utf8");

describe("ThemeToggle", () => {
  it("consumes theme context and shows sun/moon with an aria-label", () => {
    const s = src("ThemeToggle.tsx");
    expect(s).toContain("useThemeValue");
    expect(s).toContain("Moon");
    expect(s).toContain("Sun");
    expect(s).toContain("aria-label");
    expect(s).toContain("onClick={toggle}");
  });
});

describe("ProfileMenu", () => {
  it("shows avatar + name and a menu with disabled password + logout", () => {
    const s = src("ProfileMenu.tsx");
    expect(s).toContain("UserRound");
    expect(s).toContain("ChevronDown");
    expect(s).toContain("Ganti password");
    expect(s).toContain("Segera hadir");
    expect(s).toContain("disabled");
    expect(s).toContain("onLogout");
    expect(s).toContain("Keluar");
  });
  it("shows the manager ID below the name in the dropdown", () => {
    const s = src("ProfileMenu.tsx");
    expect(s).toContain("idManager");
    expect(s).toContain("ID:");
  });
  it("makes the ID row and password item conditional", () => {
    const s = src("ProfileMenu.tsx");
    expect(s).toContain("idManager &&");
    expect(s).toContain("canChangePassword");
  });
  it("supports extras rows in the dropdown (rendered above logout)", () => {
    const s = src("ProfileMenu.tsx");
    expect(s).toContain("extras");
  });
});

describe("RoleEmblem", () => {
  it("renders a brand-blue uppercase pill", () => {
    const s = src("RoleEmblem.tsx");
    expect(s).toContain("bg-brand-500");
    expect(s).toContain("uppercase");
    expect(s).toContain("{label}");
  });
});
