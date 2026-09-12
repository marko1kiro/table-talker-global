// R4-G (round 4 review): the Vercel build must run the APPLICATION build only
// — never the disposable-Postgres integration suite (Vercel builds execute as
// root and embedded PostgreSQL refuses to start). The full quality gate stays
// in GitHub Actions + local non-root runs. This contract test executes the
// real config file, not a copy.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));
const vercel = JSON.parse(readFileSync(`${root}vercel.json`, "utf8")) as {
  framework?: string;
  buildCommand?: string;
  installCommand?: string;
  headers?: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
};
const pkg = JSON.parse(readFileSync(`${root}package.json`, "utf8")) as {
  scripts: Record<string, string>;
};

describe("R4-G: Vercel build stays out of the DB integration suite", () => {
  it("installs deterministically from the lockfile", () => {
    expect(vercel.installCommand).toBe("npm ci");
  });

  it("builds the app only — never runs the full verify/test gate", () => {
    expect(vercel.buildCommand).toBe("npm run build");
    expect(pkg.scripts.build).toContain("vite build");
  });

  it("the full quality gate (verify incl. tests) remains wired for CI/local", () => {
    expect(pkg.scripts.verify).toContain("npm test");
    const ci = readFileSync(`${root}.github/workflows/ci.yml`, "utf8");
    expect(ci).toContain("npm run verify");
  });

  it("no env/secret fields were added to vercel.json", () => {
    for (const banned of ["env", "TEST_DATABASE_URL", "SERVICE_ROLE", "ANON_KEY", "PASSWORD"]) {
      expect(JSON.stringify(vercel), banned).not.toContain(banned);
    }
  });

  it("security headers survive untouched", () => {
    const all = (vercel.headers ?? []).flatMap((entry) => entry.headers.map((h) => h.key));
    for (const key of [
      "X-Frame-Options",
      "X-Content-Type-Options",
      "Referrer-Policy",
      "Permissions-Policy",
    ]) {
      expect(all, key).toContain(key);
    }
  });
});
