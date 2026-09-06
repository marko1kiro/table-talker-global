import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("consistent footer across all pages", () => {
  it("ManagerLayout menggunakan Footer component", () => {
    const layout = read("../src/components/ManagerLayout.tsx");
    expect(layout).toContain('from "@/components/Footer"');
    expect(layout).toContain("<Footer");
  });

  it("Kasir menggunakan Footer component", () => {
    const kasir = read("../src/routes/kasir/index.tsx");
    expect(kasir).toContain('from "@/components/Footer"');
    expect(kasir).toContain("<Footer");
  });

  it("CrewShell memiliki Footer", () => {
    const crew = read("../src/components/dashboard/CrewShell.tsx");
    expect(crew).toContain('from "@/components/Footer"');
    expect(crew).toContain("<Footer");
  });

  it("Super Admin route memiliki Footer", () => {
    const owner = read("../src/routes/super-admin/route.tsx");
    expect(owner).toContain('from "@/components/Footer"');
    expect(owner).toContain("<Footer");
  });

  it("Login Manager memiliki Footer", () => {
    const login = read("../src/routes/manager/login.tsx");
    expect(login).toContain('from "@/components/Footer"');
    expect(login).toContain("<Footer");
  });

  it("Register Manager memiliki Footer", () => {
    const reg = read("../src/routes/manager/register.tsx");
    expect(reg).toContain('from "@/components/Footer"');
    expect(reg).toContain("<Footer");
  });

  it("Footer memiliki tagline Simplify Your Mind", () => {
    const footer = read("../src/components/Footer.tsx");
    expect(footer).toMatch(/simplify your mind/i);
  });
});
