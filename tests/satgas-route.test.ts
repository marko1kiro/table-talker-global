import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = () => readFileSync(new URL("../src/routes/satgas/index.tsx", import.meta.url), "utf8");

describe("satgas route (SP2)", () => {
  it("uses CrewShell + notification center, drops CrewHeader/useNoticeQueue, dark grid/escort", () => {
    const s = src();
    expect(s).toContain("CrewShell");
    expect(s).toContain("useNotificationCenter");
    expect(s).not.toContain("<CrewHeader");
    expect(s).not.toContain("useNoticeQueue");
    expect(s).toContain('roleLabel="SATGAS"');
    expect(s).toContain("dark:bg-amber-500/10");
    expect(s).toContain("dark:bg-emerald-500/10");
  });
});
