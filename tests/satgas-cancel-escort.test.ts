import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = () =>
  readFileSync(new URL("../src/routes/satgas/index.tsx", import.meta.url), "utf8");

describe("Satgas cancel-escort UI", () => {
  it("shows a Batalkan Escort confirmation dialog", () => {
    const text = source();
    expect(text).toContain("Batalkan Escort untuk Meja");
    expect(text).toContain("cancelMutation.mutate");
  });
  it("no longer disables escorted tables (occupied/pending only)", () => {
    const text = source();
    expect(text).toContain("disabled={occupied || isPending}");
    expect(text).toContain("aria-disabled={occupied || isPending}");
  });
});
