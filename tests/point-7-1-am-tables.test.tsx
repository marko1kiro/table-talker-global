import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("AM tables read-only", () => {
  it("meja route has no mutation imports", () => {
    const src = readFileSync("src/routes/am/meja.tsx", "utf8");
    expect(src).not.toMatch(/set_table_|create_escort|confirm_escort|claim_role_session/);
  });
});
