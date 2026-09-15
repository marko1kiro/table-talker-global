import { describe, expect, it } from "vitest";

describe("am table scope RPCs", () => {
  it("rejects restaurant outside AM scope", async () => {
    const { amTableSnapshotCore } = await import("../../src/lib/am-tables.server");
    const r = await amTableSnapshotCore({ amId: "am-1", restaurantId: "resto-luar" }, async () => ({
      data: null,
      error: { message: "NOT_AUTHORIZED" },
    }));
    expect(r.ok).toBe(false);
  });
  it("accepts in-scope snapshot rows", async () => {
    const { amTableSnapshotCore } = await import("../../src/lib/am-tables.server");
    const r = await amTableSnapshotCore({ amId: "am-1", restaurantId: "r1" }, async () => ({
      data: [{ table_number: 1, status: "terisi" }],
      error: null,
    }));
    expect(r.ok).toBe(true);
  });
  it("binds AM realtime channel via anon-authed rpc", async () => {
    const { amBindTableRealtimeCore } = await import("../../src/lib/am-tables.server");
    const calls: { fn: string; params: Record<string, unknown> }[] = [];
    const ok = await amBindTableRealtimeCore({ amId: "am-1", restaurantId: "r1" }, async (fn, params) => {
      calls.push({ fn, params });
      return { data: true, error: null };
    });
    expect(ok.ok).toBe(true);
    expect(calls[0]?.fn).toBe("bind_am_table_realtime");
    expect(calls[0]?.params).toEqual({ p_am_id: "am-1", p_restaurant_id: "r1" });
    const denied = await amBindTableRealtimeCore({ amId: "am-1", restaurantId: "r1" }, async () => ({
      data: null,
      error: { message: "NOT_AUTHORIZED" },
    }));
    expect(denied).toEqual({ ok: false, code: "NOT_AUTHORIZED" });
  });
});
