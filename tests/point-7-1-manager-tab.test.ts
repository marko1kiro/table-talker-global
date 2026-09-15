import { describe, expect, it } from "vitest";
import { filterManagersByResto } from "../src/lib/am-manager-filter";

describe("filterManagersByResto", () => {
  const rows = [
    { restaurant_id: "r1" },
    { restaurant_id: "r2" },
    { restaurant_id: "r1" },
  ];
  it("returns only picked resto rows", () => {
    expect(filterManagersByResto(rows, "r1")).toHaveLength(2);
  });
  it("returns all when pick is null", () => {
    expect(filterManagersByResto(rows, null)).toHaveLength(3);
  });
});
