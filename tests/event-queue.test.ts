import { describe, expect, it } from "vitest";
import { generateEventId, generateDeviceId } from "../src/lib/event-queue";

describe("event-queue", () => {
  it("generateEventId returns UUID v4 format", () => {
    const id = generateEventId();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("generateDeviceId returns string", () => {
    const id = generateDeviceId();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });
});
