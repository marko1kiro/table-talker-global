import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

describe("Favicon assets and root configuration", () => {
  it("verifies favicon files exist in public directory", () => {
    const publicDir = join(process.cwd(), "public");
    expect(existsSync(join(publicDir, "favicon.ico"))).toBe(true);
    expect(existsSync(join(publicDir, "favicon-16x16.png"))).toBe(true);
    expect(existsSync(join(publicDir, "favicon-32x32.png"))).toBe(true);
    expect(existsSync(join(publicDir, "apple-touch-icon.png"))).toBe(true);
  });

  it("includes all responsive favicon links in root route", () => {
    const rootPath = join(process.cwd(), "src/routes/__root.tsx");
    const content = readFileSync(rootPath, "utf-8");
    expect(content).toContain("/favicon.ico");
    expect(content).toContain("/favicon-32x32.png");
    expect(content).toContain("/favicon-16x16.png");
    expect(content).toContain("/apple-touch-icon.png");
  });
});
