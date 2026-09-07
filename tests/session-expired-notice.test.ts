import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("Session Expired Notice & Handling", () => {
  it("has SessionExpiredNotice component exported from components", () => {
    const filePath = join(process.cwd(), "src/components/SessionExpiredNotice.tsx");
    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("Sesi Anda Telah Berakhir");
    expect(content).toContain("Login Ulang");
  });

  it("handles INVALID_SESSION code in kasir dashboard", () => {
    const filePath = join(process.cwd(), "src/routes/kasir/index.tsx");
    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("SessionExpiredNotice");
    expect(content).toContain("INVALID_SESSION");
  });

  it("handles INVALID_SESSION code in satgas dashboard", () => {
    const filePath = join(process.cwd(), "src/routes/satgas/index.tsx");
    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("SessionExpiredNotice");
    expect(content).toContain("INVALID_SESSION");
  });

  it("handles INVALID_SESSION code in clear-up dashboard", () => {
    const filePath = join(process.cwd(), "src/routes/clear-up/index.tsx");
    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("SessionExpiredNotice");
    expect(content).toContain("INVALID_SESSION");
  });

  it("handles INVALID_SESSION code in manager dashboard", () => {
    const filePath = join(process.cwd(), "src/routes/manager/index.tsx");
    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("SessionExpiredNotice");
    expect(content).toContain("INVALID_SESSION");
  });
});
