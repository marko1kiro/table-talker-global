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

it("invalidates the channel synchronously and blocks late subscription after cleanup", () => {
  expect(hookSource).toMatch(/activatePresence:\s*\(\)\s*=>\s*\{\s*if \(!active\) return;/);
  expect(hookSource).toMatch(
    /const currentChannel = channel;\s*channel = null;\s*if \(currentChannel\) void client\.removeChannel\(currentChannel\)/,
  );
  expect(hookSource).toMatch(
    /claim_pending_remote_command"\);\s*if \(!active\) return;[\s\S]*if \(data\) await processor\.process/,
  );
  expect(hookSource).toMatch(
    /\(\{ new: row \}\) => \{\s*if \(!active \|\| channel !== nextChannel\) return;/,
  );
  expect(hookSource).toContain(
    'isVisible: () => active && document.visibilityState === "visible"',
  );
});
