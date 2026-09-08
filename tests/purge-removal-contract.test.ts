import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20260909000000_drop_super_admin_purge_restaurant_test_data.sql",
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
  it("final migration revokes privileges from every grantee before dropping", () => {
    expect(migration).toMatch(
      /revoke all on function public\.super_admin_purge_restaurant_test_data\(uuid\) from public, anon, authenticated, service_role/i,
    );
  });

  it("final migration drops the purge RPC with its only live signature (uuid)", () => {
    expect(migration).toMatch(
      /drop function if exists public\.super_admin_purge_restaurant_test_data\(uuid\)/i,
    );
  });

  it("final migration does not drop or modify any table or data", () => {
    expect(migration).not.toMatch(/drop table/i);
    expect(migration).not.toMatch(/delete from/i);
    expect(migration).not.toMatch(/truncate/i);
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
