import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = () => readFileSync(new URL("../src/routes/kasir/index.tsx", import.meta.url), "utf8");

describe("kasir route (SP2)", () => {
  it("uses CrewShell + notification center, drops CrewHeader/useNoticeQueue, dark grid", () => {
    const s = src();
    expect(s).toContain("CrewShell");
    expect(s).toContain("useNotificationCenter");
    expect(s).not.toContain("<CrewHeader");
    expect(s).not.toContain("useNoticeQueue");
    expect(s).toContain('roleLabel="KASIR"');
    expect(s).toContain("dark:bg-emerald-500/10");
  });
});
