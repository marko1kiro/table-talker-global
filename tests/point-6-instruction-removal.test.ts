// Poin 6 S1 contract: the Manager->Crew instruction feature must be GONE from
// the browser bundle. Source-scan style (node env), like the client-asset guards
// in tests/restaurant-login-build.test.ts.
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
  "@/lib/crew-instructions.server",
  "@/lib/manager-instructions.server",
  "@/lib/instruction-domain",
  "@/hooks/use-pending-instructions",
  "@/components/InstructionBanner",
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
