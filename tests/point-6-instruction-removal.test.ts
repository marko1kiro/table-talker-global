// Poin 6 S1 contract: the Manager->Crew instruction feature must be GONE from
// src/ (source-scan bundle proxy; built-asset guards live in
// tests/restaurant-login-build.test.ts).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function listSources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory()
      ? listSources(full)
      : /\.(ts|tsx)$/.test(name)
        ? [full]
        : [];
  });
}

const FORBIDDEN = [
  "crew-instructions.server",
  "manager-instructions.server",
  "instruction-domain",
  "use-pending-instructions",
  "InstructionBanner",
  "KIRIM INSTRUKSI",
  "mgr-instr",
  "instruction-thread",
  "manager-active-crew-msg",
];

describe("Poin 6 S1: instruction feature fully removed from src/", () => {
  it("no source file references any instruction module or marker", () => {
    const offenders: string[] = [];
    for (const file of listSources(join(process.cwd(), "src"))) {
      const source = readFileSync(file, "utf8");
      for (const needle of FORBIDDEN) {
        if (source.includes(needle)) offenders.push(`${file} :: ${needle}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
