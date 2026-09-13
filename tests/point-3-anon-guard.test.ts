// Poin 3 Task 7 (spec §6): the anonymous-auth pathway is BANNED in our own
// source. The GoTrue anonymous provider stays OFF forever; no client module
// may ever call it again. Also asserts the superseded carrier module is fully
// gone (zero supabase-browser references).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcRoot = fileURLToPath(new URL("../src", import.meta.url));

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((f) => /\.(ts|tsx)$/.test(f))
    .map((f) => join(dir, f));
}

const files = listSourceFiles(srcRoot);

describe("Poin 3 anon ban", () => {
  it("scans a non-empty source tree", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("no src file references the anonymous sign-in flow", () => {
    for (const file of files) {
      expect(readFileSync(file, "utf8"), file).not.toContain("signInAnonymously");
    }
  });

  it("no src file imports the deleted supabase-browser module", () => {
    for (const file of files) {
      expect(readFileSync(file, "utf8"), file).not.toContain("supabase-browser");
    }
  });
});
