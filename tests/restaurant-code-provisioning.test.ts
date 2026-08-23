import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

it("provisions derived credentials through service-role RPC without printing code values", () => {
  const script = source("scripts/provision-restaurant-code.mjs");
  expect(script).toContain("RESTAURANT_CODE_ENCRYPTION_KEY");
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
  expect(script).toContain("hashRestaurantCode");
  expect(script).toContain("encryptRestaurantCode");
  expect(script).toContain('rpc("rotate_restaurant_credentials"');
  expect(script).toContain('select("id, code_hash, code_encrypted")');
  expect(script).toContain("decryptRestaurantCode");
  expect(script).not.toMatch(/console\.(log|error).*\b(code|hash|ciphertext|encrypted)\b/i);
});

it("accepts one piped code line without printing it", () => {
  const code = "PILOT7";
  const result = spawnSync(
    process.execPath,
    ["scripts/provision-restaurant-code.mjs", "--restaurant-id", "00000000-0000-4000-8000-000000000001", "--code-stdin"],
    { cwd: new URL("..", import.meta.url), encoding: "utf8", input: `${code}\r\n` },
  );

  expect(result.status).toBe(1);
  expect(result.stderr).toContain("INVALID_KEY");
  expect(`${result.stdout}\n${result.stderr}`).not.toContain(code);
});

it("documents server-only key rules and staged rollout without credential values", () => {
  const env = source(".env.example");
  const readme = source("README.md");
  expect(env).toContain("RESTAURANT_CODE_ENCRYPTION_KEY=");
  expect(env).toContain("base64url");
  expect(env).not.toContain("VITE_RESTAURANT_CODE_ENCRYPTION_KEY");
  expect(readme).toContain("provision-restaurant-code.mjs");
  expect(readme).toContain("20260823120000_remove_legacy_restaurant_code.sql");
  expect(`${env}\n${readme}`).not.toContain("KAMPUNG-BULU");
});
