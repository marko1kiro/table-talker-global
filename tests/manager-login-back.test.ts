import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const loginSource = readFileSync(
  new URL("../src/routes/manager/login.tsx", import.meta.url),
  "utf8",
);

describe("Manager login back button", () => {
  it("menyediakan link Kembali ke home", () => {
    expect(loginSource).toContain('to="/"');
    expect(loginSource).toContain("Kembali");
    expect(loginSource).toContain("ArrowLeft");
  });
});
