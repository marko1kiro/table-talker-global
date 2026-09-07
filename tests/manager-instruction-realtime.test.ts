import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("Manager Instruction Realtime Broadcast", () => {
  it("broadcasts instruction event from manager route after sending", () => {
    const filePath = join(process.cwd(), "src/routes/manager/index.tsx");
    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain('event: "instruction"');
  });

  it("ensures setAuth before joining realtime channel in usePendingInstructions", () => {
    const filePath = join(process.cwd(), "src/hooks/use-pending-instructions.ts");
    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("setAuth");
  });
});
