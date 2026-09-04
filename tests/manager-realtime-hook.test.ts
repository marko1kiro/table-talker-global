import { describe, expect, it } from "vitest";
import { createTableOccupancyRealtimeController } from "../src/hooks/use-table-occupancy-realtime";

describe("realtime controller bind rpc", () => {
  it("defaults to the crew bind rpc", () => {
    let called = "";
    const client = {
      rpc: async (fn: string) => {
        called = fn;
        return { data: true, error: null };
      },
      channel: () => ({ on: () => ({ subscribe: () => undefined }) }),
      removeChannel: () => undefined,
    };
    createTableOccupancyRealtimeController({
      client: client as never,
      restaurantId: "r-1",
      sessionToken: "tok",
      refetch: () => undefined,
    });
    expect(called).toBe("bind_role_session_realtime");
  });
  it("uses the manager bind rpc when provided", () => {
    let called = "";
    const client = {
      rpc: async (fn: string) => {
        called = fn;
        return { data: true, error: null };
      },
      channel: () => ({ on: () => ({ subscribe: () => undefined }) }),
      removeChannel: () => undefined,
    };
    createTableOccupancyRealtimeController({
      client: client as never,
      restaurantId: "r-1",
      sessionToken: "tok",
      refetch: () => undefined,
      bindRpc: "bind_manager_session_realtime",
    });
    expect(called).toBe("bind_manager_session_realtime");
  });
});
