import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

describe("7.1a build guards", () => {
  it("no AM route imports occupancy mutation modules", () => {
    const src = readdirSync("src/routes/am").map((f) =>
      readFileSync(`src/routes/am/${f}`, "utf8"),
    ).join("\n") + readFileSync("src/components/am/AmRestoTabs.tsx", "utf8");
    expect(src).not.toMatch(/table-occupancy\.server|set_table_|bind_role_session/);
  });
  it("adds zero migrations", () => {
    const files = readdirSync("supabase/migrations").filter((f) => /_am_table_scope|_am_dashboard/.test(f));
    expect(files).toEqual([]);
  });
  it("has audit + 3 stub routes with honest 7.1b copy", () => {
    for (const f of ["audit.tsx", "meja.tsx", "statistik.tsx", "leaderboard.tsx"]) {
      const src = readFileSync(`src/routes/am/${f}`, "utf8");
      expect(src).toContain("/am/");
    }
    for (const f of ["meja.tsx", "statistik.tsx", "leaderboard.tsx"]) {
      expect(readFileSync(`src/routes/am/${f}`, "utf8")).toContain("Segera hadir di 7.1b");
    }
  });
});
