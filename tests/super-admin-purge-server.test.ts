import { describe, expect, it } from "vitest";
import { purgeRestaurantTestDataCore } from "../src/lib/admin-restaurants.server";

describe("purgeRestaurantTestDataCore", () => {
  it("invokes RPC and returns ok with revision", async () => {
    const rpc = async (fn: string, params: Record<string, unknown>) => {
      if (
        fn === "super_admin_purge_restaurant_test_data" &&
        params.p_restaurant_id === "00000000-0000-0000-0000-000000000001"
      ) {
        return { data: { ok: true, revision: 12 }, error: null };
      }
      return { data: null, error: { message: "unknown rpc" } };
    };
    const res = await purgeRestaurantTestDataCore(
      { restaurantId: "00000000-0000-0000-0000-000000000001" },
      rpc,
    );
    expect(res).toEqual({ ok: true, revision: 12 });
  });

  it("handles RPC error gracefully", async () => {
    const rpc = async () => ({
      data: null,
      error: { message: "database error" },
    });
    const res = await purgeRestaurantTestDataCore(
      { restaurantId: "00000000-0000-0000-0000-000000000001" },
      rpc,
    );
    expect(res).toEqual({ error: "Gagal mereset data testing." });
  });
});
