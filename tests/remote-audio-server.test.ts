import { expect, it } from "vitest";
import { buildCommandPayload, validateCommandRequest } from "../src/lib/remote-audio.server";

it("rejects invalid targets and non-catalog audio", () => {
  expect(
    validateCommandRequest({ targetSessionId: "bad", audioId: "table:7" }, [], ["table:7"]),
  ).toEqual({ error: "Target crew tidak valid." });
  expect(
    validateCommandRequest(
      {
        targetSessionId: "d2719c7e-5b88-4ee3-8a45-7c95305a3023",
        audioId: "announcement:missing",
      },
      [{ id: "d2719c7e-5b88-4ee3-8a45-7c95305a3023", eligible: true }],
      ["table:7"],
    ),
  ).toEqual({ error: "Audio tidak tersedia." });
});

it("sets an exact five-second command TTL", () => {
  expect(buildCommandPayload("crew-id", "table:7", 0)).toEqual({
    target_session_id: "crew-id",
    audio_id: "table:7",
    actor: "super-admin",
    created_at: "1970-01-01T00:00:00.000Z",
    expires_at: "1970-01-01T00:00:05.000Z",
  });
});
