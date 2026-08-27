import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { serveRestaurantAudio } from "../src/lib/restaurant-audio.server";

const RESTAURANT_ID = "33916a05-7e95-42fa-bc3c-050bed2402c5";

function request(token = "tenant-token") {
  return new Request(
    `https://table-talker.test/api/audio/table%3A1?restaurantId=${RESTAURANT_ID}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
}

function serviceClient() {
  const from = vi.fn((table: string) => {
    const result =
      table === "restaurants"
        ? { data: { catalog_version: 1 }, error: null }
        : { data: { content_hash: "a".repeat(64), byte_size: 4 }, error: null };
    const builder = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi.fn(async () => result),
    };
    builder.select.mockReturnValue(builder);
    builder.eq.mockReturnValue(builder);
    return builder;
  });

  return { client: { from } as unknown as SupabaseClient, from };
}

describe("restaurant audio delivery", () => {
  it("rejects requests without a bearer tenant session", async () => {
    const response = await serveRestaurantAudio(
      new Request(`https://table-talker.test/api/audio/table%3A1?restaurantId=${RESTAURANT_ID}`),
      "table:1",
      { getClient: () => null },
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("prevents a valid tenant from reading another restaurant's audio", async () => {
    const { client, from } = serviceClient();
    const readObject = vi.fn();

    const response = await serveRestaurantAudio(request(), "table:1", {
      getClient: () => client,
      verifySession: async () => ({
        restaurantId: "d2705dec-1dd6-48f2-9f36-870af1cbd947",
        codeVersion: 1,
      }),
      readObject,
    });

    expect(response.status).toBe(401);
    expect(from).not.toHaveBeenCalled();
    expect(readObject).not.toHaveBeenCalled();
  });

  it("serves only the active manifest object from R2", async () => {
    const { client, from } = serviceClient();
    const readObject = vi.fn(async () => new Uint8Array([1, 2, 3, 4]));

    const response = await serveRestaurantAudio(request(), "table:1", {
      getClient: () => client,
      verifySession: async () => ({ restaurantId: RESTAURANT_ID, codeVersion: 1 }),
      readObject,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("audio/mpeg");
    expect(response.headers.get("cache-control")).toContain("private");
    expect(from).toHaveBeenNthCalledWith(1, "restaurants");
    expect(from).toHaveBeenNthCalledWith(2, "audio_manifests");
    expect(readObject).toHaveBeenCalledWith(
      `restaurants/${RESTAURANT_ID}/table_1/${"a".repeat(64)}.mp3`,
    );
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it("rejects an R2 object whose size differs from trusted manifest metadata", async () => {
    const { client } = serviceClient();

    const response = await serveRestaurantAudio(request(), "table:1", {
      getClient: () => client,
      verifySession: async () => ({ restaurantId: RESTAURANT_ID, codeVersion: 1 }),
      readObject: async () => new Uint8Array([1, 2]),
    });

    expect(response.status).toBe(502);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
