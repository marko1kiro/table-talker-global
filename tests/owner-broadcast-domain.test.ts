import { describe, expect, it } from "vitest";
import {
  ALL_CONFIRMATION,
  groupBroadcastResults,
  validateBroadcastRequest,
} from "../src/lib/owner-broadcast-domain";

describe("owner broadcast domain", () => {
  it("requires exact all-restaurants confirmation", () => {
    expect(ALL_CONFIRMATION).toBe("BROADCAST SEMUA");
    expect(
      validateBroadcastRequest({ scope: "all", message: "Tes", confirmation: "broadcast semua" }),
    ).toEqual({ ok: false, code: "CONFIRMATION_REQUIRED" });
    expect(
      validateBroadcastRequest({ scope: "all", message: "Tes", confirmation: ALL_CONFIRMATION }),
    ).toMatchObject({ ok: true, message: "Tes" });
  });

  it("requires restaurant scope and bounds message to crew contract", () => {
    expect(validateBroadcastRequest({ scope: "restaurant", message: "Tes" })).toEqual({
      ok: false,
      code: "RESTAURANT_REQUIRED",
    });
    expect(
      validateBroadcastRequest({
        scope: "restaurant",
        restaurantId: "fe1b9465-bf18-416d-8909-f7c5aaa664ea",
        message: "x".repeat(201),
      }),
    ).toEqual({ ok: false, code: "INVALID_MESSAGE" });
  });

  it("summarizes partial restaurant outcomes", () => {
    expect(
      groupBroadcastResults([
        { delivered: 2, failed: 0, rejected: 0, expired: 0 },
        { delivered: 0, failed: 1, rejected: 0, expired: 0 },
      ]),
    ).toEqual({ delivered: 2, failed: 1, rejected: 0, expired: 0, partial: true });
  });
});
