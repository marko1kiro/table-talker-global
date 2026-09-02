import { describe, expect, it, vi } from "vitest";
import { createTableOccupancyRealtimeController } from "../src/hooks/use-table-occupancy-realtime";

const RESTAURANT_ID = "33916a05-7e95-42fa-bc3c-050bed2402c5";
const SESSION_TOKEN = "role-session-token";

function fakeChannel() {
  const channel = {
    on: vi.fn(() => channel),
    subscribe: vi.fn(() => channel),
  };
  return channel;
}

function fakeClient(bindResult: { data: boolean | null; error: { message: string } | null }) {
  const channel = fakeChannel();
  return {
    client: {
      rpc: vi.fn().mockResolvedValue(bindResult),
      channel: vi.fn(() => channel),
      removeChannel: vi.fn(),
    },
    channel,
  };
}

describe("private table occupancy realtime authorization", () => {
  it("binds the authenticated role session before opening a private channel", async () => {
    const { client } = fakeClient({ data: true, error: null });

    createTableOccupancyRealtimeController({
      client,
      restaurantId: RESTAURANT_ID,
      sessionToken: SESSION_TOKEN,
      refetch: vi.fn(),
    });

    expect(client.channel).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(client.rpc).toHaveBeenCalledWith("bind_role_session_realtime", {
        p_restaurant_id: RESTAURANT_ID,
        p_session_token: SESSION_TOKEN,
      });
    });
    await vi.waitFor(() => {
      expect(client.channel).toHaveBeenCalledWith(`table-occupancy:${RESTAURANT_ID}`, {
        config: { private: true },
      });
    });
  });

  it("fails closed to polling when role-session binding is rejected", async () => {
    const { client } = fakeClient({ data: null, error: { message: "INVALID_SESSION" } });
    const onStatusChange = vi.fn();

    createTableOccupancyRealtimeController({
      client,
      restaurantId: RESTAURANT_ID,
      sessionToken: SESSION_TOKEN,
      refetch: vi.fn(),
      onStatusChange,
    });

    await vi.waitFor(() => expect(client.rpc).toHaveBeenCalledOnce());
    expect(client.channel).not.toHaveBeenCalled();
    expect(onStatusChange).toHaveBeenCalledWith("CHANNEL_ERROR");
  });

  it("does not subscribe if disposed while binding is in flight", async () => {
    let resolveBinding!: (value: { data: boolean; error: null }) => void;
    const binding = new Promise<{ data: boolean; error: null }>((resolve) => {
      resolveBinding = resolve;
    });
    const { client } = fakeClient({ data: true, error: null });
    client.rpc.mockReturnValueOnce(binding);

    const controller = createTableOccupancyRealtimeController({
      client,
      restaurantId: RESTAURANT_ID,
      sessionToken: SESSION_TOKEN,
      refetch: vi.fn(),
    });
    controller.dispose();
    resolveBinding({ data: true, error: null });
    await binding;
    await Promise.resolve();

    expect(client.channel).not.toHaveBeenCalled();
  });
});
