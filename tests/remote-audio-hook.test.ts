import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const hookSource = readFileSync(new URL("../src/hooks/use-remote-crew.ts", import.meta.url), "utf8");

it("claims a pending command after realtime subscribes", () => {
  expect(hookSource).toContain('client.rpc("claim_pending_remote_command")');
  expect(hookSource).toMatch(
    /activatePresence:\s*\(\)\s*=>\s*\{[\s\S]*catchUp\(\)[\s\S]*activatePresence\(\)/,
  );
  expect(hookSource).toMatch(/if \(data\) await processor\.process\(toRemoteCommand\(/);
});
