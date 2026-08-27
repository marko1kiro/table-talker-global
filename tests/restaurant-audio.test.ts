import { describe, expect, it, vi } from "vitest";
import { serveRestaurantAudio } from "../src/lib/restaurant-audio.server";

const RESTAURANT_ID = "33916a05-7e95-42fa-bc3c-050bed2402c5";
const OTHER_RESTAURANT_ID = "d2705dec-1dd6-48f2-9f36-870af1cbd947";
const CONTENT_HASH = "a".repeat(64);

const grant = {
  version: 1 as const,
  restaurantId: RESTAURANT_ID,
  audioId: "table:1",
  contentHash: CONTENT_HASH,
  byteSize: 4,
  expiresAt: Date.now() + 60_000,
};

function request(token = "signed-download-grant", restaurantId = RESTAURANT_ID) {
  return new Request(`https://table-talker.test/api/audio/table%3A1?restaurantId=${restaurantId}`, {
    headers: { "X-Audio-Grant": token },
  });
}

describe("restaurant audio delivery", () => {
  it("rejects requests without an audio download grant", async () => {
    const readObject = vi.fn();
    const response = await serveRestaurantAudio(
      new Request(`https://table-talker.test/api/audio/table%3A1?restaurantId=${RESTAURANT_ID}`),
      "table:1",
      { verifyGrant: vi.fn(), readObject },
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(readObject).not.toHaveBeenCalled();
  });

  it("prevents a grant from reading another restaurant's audio", async () => {
    const readObject = vi.fn();
    const response = await serveRestaurantAudio(
      request("signed-download-grant", OTHER_RESTAURANT_ID),
      "table:1",
      {
        verifyGrant: () => grant,
        readObject,
      },
    );

    expect(response.status).toBe(401);
    expect(readObject).not.toHaveBeenCalled();
  });

  it("prevents a grant from reading another audio ID", async () => {
    const readObject = vi.fn();
    const response = await serveRestaurantAudio(request(), "table:2", {
      verifyGrant: () => grant,
      readObject,
    });

    expect(response.status).toBe(401);
    expect(readObject).not.toHaveBeenCalled();
  });

  it("serves only the immutable object named by a verified grant", async () => {
    const readObject = vi.fn(async () => new Uint8Array([1, 2, 3, 4]));
    const response = await serveRestaurantAudio(request(), "table:1", {
      verifyGrant: () => grant,
      readObject,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("audio/mpeg");
    expect(response.headers.get("cache-control")).toContain("private");
    expect(response.headers.get("x-content-hash")).toBe(CONTENT_HASH);
    expect(readObject).toHaveBeenCalledWith(
      `restaurants/${RESTAURANT_ID}/table_1/${CONTENT_HASH}.mp3`,
    );
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it("rejects an R2 object whose size differs from signed metadata", async () => {
    const response = await serveRestaurantAudio(request(), "table:1", {
      verifyGrant: () => grant,
      readObject: async () => new Uint8Array([1, 2]),
    });

    expect(response.status).toBe(502);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
