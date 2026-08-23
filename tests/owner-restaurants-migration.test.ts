import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const sql = readFileSync(
  new URL("../supabase/migrations/20260824002000_owner_restaurant_catalog.sql", import.meta.url),
  "utf8",
);

it("keeps owner aggregate and detail RPC service-role-only", () => {
  expect(sql).toContain("function public.owner_restaurant_list()");
  expect(sql).toContain("function public.owner_restaurant_detail(p_restaurant_id uuid)");
  expect(sql).toContain("grant execute on function public.owner_restaurant_list() to service_role");
  expect(sql).toContain(
    "grant execute on function public.owner_restaurant_detail(uuid) to service_role",
  );
});

it("guards catalog IDs after pilot validation", () => {
  expect(sql).toContain("existing audio manifest catalog IDs are invalid");
  expect(sql).toContain("table:([1-9]|[1-9][0-9]|100)");
  expect(sql).toContain("custom:[a-z0-9][a-z0-9_-]{0,99}");
  expect(sql).toContain("add constraint audio_manifests_audio_id_check");
});
