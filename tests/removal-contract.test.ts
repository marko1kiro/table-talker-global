import { existsSync, readFileSync } from "node:fs";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const removedFiles = [
  "src/hooks/use-remote-crew.ts",
  "src/hooks/use-crew-message.ts",
  "src/components/CrewMessageOverlay.tsx",
  "src/routes/super-admin/broadcast.tsx",
  "src/lib/owner-broadcast.server.ts",
  "src/lib/owner-broadcast-domain.ts",
  "src/lib/owner-broadcast-idempotency.server.ts",
  "src/lib/owner-broadcast-retry.ts",
  "src/lib/crew-message-domain.ts",
];

it("removed heartbeat/remote-command/broadcast files no longer exist", () => {
  for (const file of removedFiles) expect(existsSync(file)).toBe(false);
});

const removedTestFiles = [
  "tests/use-remote-crew.test.ts",
  "tests/remote-audio-hook.test.ts",
  "tests/remote-commands-restaurant-id.test.ts",
  "tests/owner-broadcast-domain.test.ts",
  "tests/owner-broadcast-idempotency.test.ts",
  "tests/owner-broadcast-retry.test.ts",
  "tests/owner-broadcast-source.test.ts",
  "tests/owner-broadcast-preview.test.ts",
  "tests/crew-message-integration.test.ts",
  "tests/crew-messages-restaurant-id.test.ts",
  "tests/crew-message-domain.test.ts",
  "tests/restaurant-code-crew-flow.test.ts",
];

// These test files intentionally assert on the literal text content of
// historical, never-edited migration files (per the migration immutability
// convention: "do not edit historical migration files; add a new migration
// that alters the function"). They will legitimately keep containing banned
// tokens forever as an accurate historical record, so they are exempt from
// the banned-token sweep below.
const historicalMigrationTestExemptions = [
  "tests/owner-retention-source.test.ts",
  "tests/remote-audio-migration.test.ts",
  "tests/table-100-min-upload-migration.test.ts",
  "tests/tenant-rpc-fixes.test.ts",
  "tests/audit-database-remediation.test.ts",
  // Mixed file: mostly asserts historical migration text, but also has one
  // test block asserting against src/hooks/use-remote-crew.ts (which is
  // deleted in Task 3). That specific block is edited/removed in Task 3;
  // this file-level exemption covers the legitimate historical assertions.
  "tests/auth-telemetry-hardening.test.ts",
  // Task 2's own contract test for the NEW removal migration file: it must
  // quote the exact banned RPC/table names to assert the migration drops
  // them, so it legitimately contains those tokens forever.
  "tests/removal-migration.test.ts",
  // Contract test for the 20260829000001 fix-up migration: its explanatory
  // comment legitimately references the now-dropped public.crew_messages
  // table to document why create_crew_message was orphaned, so it
  // legitimately contains that banned token forever.
  "tests/fix-create-crew-message-drop-migration.test.ts",
  // Contains a legitimate negative assertion
  // (expect(source).not.toContain("owner_broadcast_deliveries")) whose
  // literal text includes the banned token; the assertion itself is what
  // proves the removal, so it must keep quoting the token forever.
  "tests/owner-history-error-source.test.ts",
];

it("removed obsolete test files no longer exist", () => {
  for (const file of removedTestFiles) expect(existsSync(file)).toBe(false);
});

const bannedTokens = [
  "heartbeat_crew_session",
  "create_remote_command",
  "ack_remote_command",
  "claim_pending_remote_command",
  "expire_remote_commands",
  "cleanup_remote_commands",
  "remote_commands",
  "crew_messages",
  "owner-broadcast",
  "owner_broadcasts",
  "owner_broadcast_deliveries",
  "owner_broadcast_targets",
  "owner_broadcast_recipients",
  "owner_broadcast_rate_limits",
  "active_crew_devices",
  "use-remote-crew",
  "use-crew-message",
  "CrewMessageOverlay",
];

function listFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) files.push(...listFiles(full));
    else files.push(full);
  }
  return files;
}

it("no remaining src reference to removed RPCs/tables/identifiers", () => {
  const files = listFiles("src").filter((file) => /\.(ts|tsx)$/.test(file));
  const offenders: string[] = [];
  for (const file of files) {
    const content = readFileSync(file, "utf8");
    for (const token of bannedTokens) {
      if (content.includes(token)) offenders.push(`${file}: ${token}`);
    }
  }
  expect(offenders).toEqual([]);
});

it("no remaining test reference to removed RPCs/tables/identifiers (excluding this file)", () => {
  const files = listFiles("tests").filter(
    (file) =>
      /\.(ts|tsx)$/.test(file) &&
      !file.endsWith("removal-contract.test.ts") &&
      !historicalMigrationTestExemptions.some((exempt) => file.endsWith(exempt)),
  );
  const offenders: string[] = [];
  for (const file of files) {
    const content = readFileSync(file, "utf8");
    for (const token of bannedTokens) {
      if (content.includes(token)) offenders.push(`${file}: ${token}`);
    }
  }
  expect(offenders).toEqual([]);
});

describe("removal migration exists", () => {
  it("new destructive removal migration file exists", () => {
    expect(
      existsSync("supabase/migrations/20260829000000_remove_remote_command_heartbeat.sql"),
    ).toBe(true);
  });

  // 20260829000000 dropped create_crew_message using a stale 4-parameter
  // signature that was never actually live, silently no-op'ing and leaving
  // the real (3-parameter) function orphaned. This follow-up migration
  // corrects that with the correct, live signature.
  it("fix-up migration for the create_crew_message signature mismatch exists", () => {
    expect(existsSync("supabase/migrations/20260829000001_fix_create_crew_message_drop.sql")).toBe(
      true,
    );
  });
});
