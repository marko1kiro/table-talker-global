import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// M-06/M-07 (Fase 3) originally required buildCommand = "npm run verify" so a
// broken gate could not deploy. R4-G supersedes that contract: the quality
// gate moved to GitHub CI as a REQUIRED check (tests + typecheck + lint +
// build), and Vercel's build step now runs `npm run build` only — running the
// DB-integration part of the gate inside the Vercel build sandbox was the
// source of flaky deploys. Deploys are still gated: a red CI check blocks the
// branch, and `npm ci` keeps installs reproducible.
//
// check:edge (deno check) is deliberately NOT part of this chain: Vercel's
// build image has no `deno` binary, and the edge function it checks isn't
// part of what Vercel builds/deploys. Including it here previously broke
// every single Vercel deploy.
const vercelConfig = () =>
  JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));

describe("vercel.json: deploy pipeline enforces the full quality gate", () => {
  it("installs with npm ci and builds with npm run build (gate lives in CI, R4-G)", () => {
    const config = vercelConfig();
    expect(config.installCommand).toBe("npm ci");
    expect(config.buildCommand).toBe("npm run build");
  });

  it("package.json's verify script still runs test, typecheck, lint, then build in order", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    const verify: string = pkg.scripts.verify;
    const order = ["npm test", "npm run typecheck", "npm run lint", "npm run build"];
    let cursor = -1;
    for (const step of order) {
      const index = verify.indexOf(step);
      expect(index).toBeGreaterThan(cursor);
      cursor = index;
    }
  });
});
