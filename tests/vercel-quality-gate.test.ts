import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// M-06/M-07 (Fase 3): Vercel deploys ran `npm run build` directly, so a
// broken test suite / typecheck / lint could still deploy to production --
// `npm run verify` existed in package.json but was never wired into the
// actual deploy pipeline. Vercel's buildCommand must run the full quality
// gate (tests + typecheck + edge-function check + lint + build), not just
// the bare build step, so a failing gate blocks the deploy.
const vercelConfig = () =>
  JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));

describe("vercel.json: deploy pipeline enforces the full quality gate", () => {
  it("runs npm run verify as the build command, not a bare build", () => {
    const config = vercelConfig();
    expect(config.buildCommand).toBe("npm run verify");
  });

  it("package.json's verify script still runs test, typecheck, edge check, lint, then build in order", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    const verify: string = pkg.scripts.verify;
    const order = [
      "npm test",
      "npm run typecheck",
      "npm run check:edge",
      "npm run lint",
      "npm run build",
    ];
    let cursor = -1;
    for (const step of order) {
      const index = verify.indexOf(step);
      expect(index).toBeGreaterThan(cursor);
      cursor = index;
    }
  });
});
