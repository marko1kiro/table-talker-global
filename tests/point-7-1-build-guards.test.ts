import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

describe("7.1 guards", () => {
  it("no AM route imports occupancy mutation modules", () => {
    const src =
      readdirSync("src/routes/am")
        .map((f) => readFileSync(`src/routes/am/${f}`, "utf8"))
        .join("\n") + readFileSync("src/components/am/AmRestoTabs.tsx", "utf8");
    expect(src).not.toMatch(/table-occupancy\.server|set_table_|bind_role_session/);
  });
  it("adds exactly the one 7.1b scope migration", () => {
    const files = readdirSync("supabase/migrations").filter((f) =>
      /_am_table_scope|_am_dashboard/.test(f),
    );
    expect(files).toEqual(["20260915190000_am_table_scope.sql"]);
  });
  it("7.1b pages carry real content, not stubs", () => {
    for (const f of ["audit.tsx", "meja.tsx", "statistik.tsx", "leaderboard.tsx"]) {
      const src = readFileSync(`src/routes/am/${f}`, "utf8");
      expect(src).toContain("/am/");
    }
    expect(readFileSync("src/routes/am/meja.tsx", "utf8")).toMatch(
      /tanpa aksi perubahan status|Read-only/,
    );
    expect(readFileSync("src/routes/am/statistik.tsx", "utf8")).toMatch(/BarChart/);
    expect(readFileSync("src/routes/am/leaderboard.tsx", "utf8")).toMatch(/Peringkat|preset/);
    for (const f of ["meja.tsx", "statistik.tsx", "leaderboard.tsx"]) {
      expect(readFileSync(`src/routes/am/${f}`, "utf8")).not.toContain("Segera hadir di 7.1b");
    }
  });
});
