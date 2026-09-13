import { describe, expect, it } from "vitest";
import { CREW_ROLE_LABELS, CREW_ROLE_ORDER } from "../src/lib/role-session-domain";

describe("CREW_ROLE_ORDER / CREW_ROLE_LABELS", () => {
  it("lists exactly the 4 roles in the spec's picker order: SS, Kasir, Satgas, Clear Up", () => {
    expect(CREW_ROLE_ORDER).toEqual(["ss", "kasir", "satgas", "clear_up"]);
  });

  it("provides an Indonesian display label for every role", () => {
    expect(CREW_ROLE_LABELS).toEqual({
      ss: "SS",
      kasir: "Kasir",
      satgas: "Satgas",
      clear_up: "Clear Up",
    });
  });
});
