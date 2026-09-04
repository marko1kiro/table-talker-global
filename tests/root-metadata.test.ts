import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = () => readFileSync(new URL("../src/routes/__root.tsx", import.meta.url), "utf8");

describe("root metadata reflects the current app (not the soundboard era)", () => {
  it("drops the old soundboard description", () => {
    expect(root()).not.toContain("Soundboard panggilan meja");
  });
  it("describes table call + realtime occupancy + manager monitoring", () => {
    const s = root();
    expect(s).toContain("status meja");
    expect(s).toContain("realtime");
    expect(s).toContain("manager");
  });
  it("carries a complete Open Graph + Twitter + identity set", () => {
    const s = root();
    for (const key of [
      "og:type",
      "og:site_name",
      "og:title",
      "og:description",
      "og:image",
      "og:url",
      "twitter:card",
      "twitter:title",
      "twitter:description",
      "application-name",
      "author",
    ]) {
      expect(s).toContain(key);
    }
  });
});
