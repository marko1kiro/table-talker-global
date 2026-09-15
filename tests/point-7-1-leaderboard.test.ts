import { describe, expect, it } from "vitest";
import { rankRestos } from "../src/lib/am-leaderboard";

describe("rankRestos", () => {
  it("sorts desc by guests, ties by name", () => {
    expect(
      rankRestos([
        { id: "b", name: "B", guests: 5 },
        { id: "a", name: "A", guests: 5 },
        { id: "c", name: "C", guests: 9 },
      ]).map((r) => r.id),
    ).toEqual(["c", "a", "b"]);
  });
});
