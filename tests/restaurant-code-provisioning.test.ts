import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

it("provisions a plain-text code through service-role RPC without printing it", () => {
  const script = source("scripts/provision-restaurant-code.mjs");
  expect(script).not.toContain("RESTAURANT_CODE_ENCRYPTION_KEY");
  expect(script).toContain("--restaurant-id");
  expect(script).toContain("RESTAURANT_CODE_FILE");
  expect(script).not.toContain('option("--code")');
  expect(script).not.toContain("--display-name");
  expect(script).toContain("statSync(file).mode & 0o077");
  expect(script).toContain('process.argv.includes("--code-stdin")');
  expect(script).toContain("process.stdin.isTTY");
  expect(script).toContain('execFileSync("icacls"');
  expect(script).toContain('"/getowner"');
  expect(script).toContain("process.env.USERNAME");
  expect(script).toContain("INSECURE_CODE_FILE");
  expect(script).not.toContain("hashRestaurantCode");
  expect(script).not.toContain("encryptRestaurantCode");
  expect(script).not.toContain("decryptRestaurantCode");
  expect(script).toContain('rpc("rotate_restaurant_credentials"');
  expect(script).toContain('select("id, code")');
  expect(script).not.toMatch(/console\.(log|error).*\b(code|hash|ciphertext|encrypted)\b/i);
});

it("accepts one piped code line without printing it", () => {
  const code = "PILOT77";
  // Deliberately unset the server credentials the script needs, even if the
  // process running this test (e.g. a Vercel build) has real ones exported —
  // this test exercises the "missing config" failure path, not live provisioning.
  const env = { ...process.env };
  delete env.SUPABASE_URL;
  delete env.SUPABASE_SERVICE_ROLE_KEY;
  const result = spawnSync(
    process.execPath,
    [
      "scripts/provision-restaurant-code.mjs",
      "--restaurant-id",
      "00000000-0000-4000-8000-000000000001",
      "--code-stdin",
    ],
    { cwd: new URL("..", import.meta.url), encoding: "utf8", input: `${code}\r\n`, env },
  );

  expect(result.status).toBe(1);
  expect(result.stderr).toContain("MISSING_SERVER_CONFIGURATION");
  expect(`${result.stdout}\n${result.stderr}`).not.toContain(code);
});

it("documents plain-text rollout without any encryption-key material", () => {
  const env = source(".env.example");
  const readme = source("README.md");
  expect(env).not.toContain("RESTAURANT_CODE_ENCRYPTION_KEY");
  expect(readme).not.toContain("RESTAURANT_CODE_ENCRYPTION_KEY");
  expect(readme).toContain("provision-restaurant-code.mjs");
  expect(readme).toContain("plain text");
  expect(`${env}\n${readme}`).not.toContain("KAMPUNG-BULU");
});
