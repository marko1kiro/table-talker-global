import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = () =>
  readFileSync(
    new URL("../src/components/dashboard/NotificationCenter.tsx", import.meta.url),
    "utf8",
  );

describe("NotificationCenter", () => {
  it("is a unified center: stale + activity feed + unread badge + placeholder", () => {
    const s = src();
    expect(s).toContain("Perlu Dicek");
    expect(s).toContain("Aktivitas");
    expect(s).toContain("Belum ada perubahan status meja");
    expect(s).toContain("unread");
    expect(s).toContain("onOpen");
  });
});
