import { describe, expect, it } from "vitest";
import { selectResetDecisions } from "../src/lib/am-password-history";

describe("selectResetDecisions", () => {
  const entries = [
    { action: "manager_reset.decide", restaurant_id: "r1", result: "ok" },
    { action: "manager.create", restaurant_id: "r1", result: "ok" },
    { action: "manager_reset.decide", restaurant_id: "r2", result: "fail" },
  ];
  it("keeps only decide actions for picked resto", () => {
    expect(selectResetDecisions(entries, "r1")).toHaveLength(1);
  });
});
