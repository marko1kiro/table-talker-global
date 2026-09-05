import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = () =>
  readFileSync(new URL("../src/routes/clear-up/index.tsx", import.meta.url), "utf8");

describe("clear-up route (SP2)", () => {
  it("uses CrewShell + notification center, drops CrewHeader/useNoticeQueue, dark grid", () => {
    const s = src();
    expect(s).toContain("CrewShell");
    expect(s).toContain("useNotificationCenter");
    expect(s).not.toContain("<CrewHeader");
    expect(s).not.toContain("useNoticeQueue");
    expect(s).toContain('roleLabel="CLEAR UP"');
    expect(s).toContain("dark:bg-red-500/10");
  });
});
