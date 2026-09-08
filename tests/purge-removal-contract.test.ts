import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationDir = new URL("../supabase/migrations/", import.meta.url);

const tombstone = readFileSync(
  new URL(
    "../supabase/migrations/20260908010000_fix_purge_restaurant_test_data.sql",
    import.meta.url,
  ),
  "utf8",
);
const finalMigration = readFileSync(
  new URL(
    "../supabase/migrations/20260908195839_drop_super_admin_purge_restaurant_test_data.sql",
    import.meta.url,
  ),
  "utf8",
);
const server = readFileSync(
  new URL("../src/lib/admin-restaurants.server.ts", import.meta.url),
  "utf8",
);
const ui = readFileSync(
  new URL("../src/routes/super-admin/restaurants/$id.tsx", import.meta.url),
  "utf8",
);

describe("super admin purge removal contract", () => {
  it("20260908010000 is a tombstone: no DDL/DML, only a safe no-op", () => {
    expect(tombstone).not.toMatch(/create\s+(or\s+replace\s+)?function/i);
    expect(tombstone).not.toMatch(/\bgrant\b/i);
    expect(tombstone).not.toMatch(/\bdelete\b/i);
    expect(tombstone).not.toMatch(/truncate/i);
    expect(tombstone).not.toMatch(/drop\s+table/i);
    expect(tombstone).toMatch(/do\s*\$\$/i);
  });

  it("final migration revokes privileges from every grantee before dropping", () => {
    expect(finalMigration).toMatch(
      /revoke all on function public\.super_admin_purge_restaurant_test_data\(uuid\) from public, anon, authenticated, service_role/i,
    );
  });

  it("final migration drops the purge RPC with its only live signature (uuid)", () => {
    expect(finalMigration).toMatch(
      /drop function if exists public\.super_admin_purge_restaurant_test_data\(uuid\)/i,
    );
  });

  it("final migration does not drop or modify any table or data", () => {
    expect(finalMigration).not.toMatch(/drop table/i);
    expect(finalMigration).not.toMatch(/delete from/i);
    expect(finalMigration).not.toMatch(/truncate/i);
  });

  it("no migration outside the applied historical ones can (re)create the purge RPC", () => {
    // Only these two already-applied migrations may mention creating the
    // function (historical record). Every other migration — including the
    // tombstone 20260908010000 and everything pending — must be clean.
    const allowed = [
      "20260907130000_super_admin_purge_test_data.sql",
      "20260907150000_manager_instructions.sql",
    ];
    for (const file of readdirSync(migrationDir)) {
      if (!file.endsWith(".sql") || allowed.includes(file)) continue;
      const content = readFileSync(new URL(file, migrationDir), "utf8");
      expect(content, `${file} must not (re)create the purge RPC`).not.toMatch(
        /create\s+(or\s+replace\s+)?function\s+public\.super_admin_purge_restaurant_test_data/i,
      );
    }
  });

  it("active server source no longer exports or calls the purge RPC", () => {
    expect(server).not.toContain("purgeRestaurantTestData");
    expect(server).not.toContain("super_admin_purge_restaurant_test_data");
  });

  it("active UI no longer imports or offers the bulk reset/purge action", () => {
    expect(ui).not.toContain("purge");
    expect(ui).not.toContain("Reset Data Testing");
  });
});
