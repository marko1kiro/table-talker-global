import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";

it("defines truthful verification scripts", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  ) as { scripts: Record<string, string> };

  expect(packageJson.scripts.typecheck).toBe("tsc --noEmit");
  expect(packageJson.scripts["check:edge"]).toBe(
    "deno check supabase/functions/owner-retention/index.ts",
  );
  // check:edge (deno check) is intentionally excluded from the Vercel-gating
  // `verify` chain: Vercel's build image has no `deno` binary, and the edge
  // function it checks isn't part of what Vercel builds/deploys anyway. The
  // `check:edge` script itself remains available for local/manual use.
  expect(packageJson.scripts.verify).toBe(
    "npm test && npm run typecheck && npm run lint && npm run build",
  );

  for (const script of Object.values(packageJson.scripts)) {
    expect(script).not.toMatch(/\|\|\s*true|\b(skip|ignore|pass)\b/i);
  }
});

it("fails test runs when no tests are discovered", async () => {
  const vitestConfig = await readFile(new URL("../vitest.config.ts", import.meta.url), "utf8");

  expect(vitestConfig).not.toMatch(/passWithNoTests\s*:\s*true/);
});

it("pins Edge Supabase client imports", async () => {
  const edgeEntry = await readFile(
    new URL("../supabase/functions/owner-retention/index.ts", import.meta.url),
    "utf8",
  );

  expect(edgeEntry).toContain("https://esm.sh/@supabase/supabase-js@2.112.3");
  expect(edgeEntry).not.toContain('https://esm.sh/@supabase/supabase-js@2"');
});
