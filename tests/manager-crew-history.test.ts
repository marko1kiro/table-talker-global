import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("manager crew history", () => {
  it("menambahkan RPC get_manager_crew_history dan men-drop RPC lama", () => {
    const migrations = readdirSync(new URL("../supabase/migrations/", import.meta.url));
    const file = migrations.find((f) => f.includes("manager_crew_history"));
    expect(file).toBeDefined();
    const sql = read(`../supabase/migrations/${file}`);
    expect(sql).toContain("get_manager_crew_history");
    expect(sql).toContain("'Asia/Jakarta'");
    expect(sql).toContain(
      "grant execute on function public.get_manager_crew_history(text, date) to authenticated",
    );
    expect(sql).toContain("drop function if exists public.get_manager_active_crew(text)");
  });

  it("menyediakan server fn getManagerCrewHistory dengan validator tanggal", () => {
    const server = read("../src/lib/manager-dashboard.server.ts");
    expect(server).toContain("getManagerCrewHistory");
    expect(server).toContain("p_date");
    expect(server).toMatch(/date:\s*z\s*\.\s*string\(\)\s*\.\s*regex\(/);
    expect(server).toContain("isActive");
    expect(server).not.toContain("getManagerActiveCrew");
  });

  it("menu crew memakai query riwayat ber-scope", () => {
    const page = read("../src/routes/manager/index.tsx");
    expect(page).toContain("getManagerCrewHistory");
    expect(page).toContain("manager-crew-history");
    expect(page).toContain("crew-history-scope");
    expect(page).not.toContain("getManagerActiveCrew");
  });
});
