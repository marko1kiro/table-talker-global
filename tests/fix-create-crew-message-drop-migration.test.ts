import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const sql = readFileSync(
  new URL(
    "../supabase/migrations/20260829000001_fix_create_crew_message_drop.sql",
    import.meta.url,
  ),
  "utf8",
);

// Context: 20260829000000_remove_remote_command_heartbeat.sql dropped
// create_crew_message with a stale 4-parameter signature
// (uuid, text, uuid, bigint) that was never the live signature in this
// database — it was only an intermediate draft signature from
// 20260822100020_crew_messages_restaurant_id.sql. The live signature,
// established by 20260823100000_fix_tenant_rpcs.sql, is the 3-parameter
// form (uuid, text, bigint). Because `drop function if exists` silently
// no-ops on a signature mismatch, that drop never actually removed the
// live function, leaving it orphaned (its body still references the
// now-dropped public.crew_messages table) and still exposed via
// PostgREST. This migration corrects that by dropping the correct,
// live signature. It was applied directly to the production database
// and is captured here to keep the migration history file-backed and
// reproducible for fresh databases.
it("drops create_crew_message with its correct, live 3-parameter signature", () => {
  expect(sql).toMatch(/drop function if exists public\.create_crew_message\(uuid, text, bigint\)/i);
});

it("does not repeat the stale 4-parameter signature", () => {
  expect(sql).not.toMatch(/create_crew_message\(uuid, text, uuid, bigint\)/i);
});
