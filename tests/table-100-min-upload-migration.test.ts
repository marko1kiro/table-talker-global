import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const migrationPath = new URL(
  "../supabase/migrations/20260828200000_table_100_and_min_upload_1kb.sql",
  import.meta.url,
);

function migration(): string {
  return readFileSync(migrationPath, "utf8");
}

it("raises the legacy remote_commands table ceiling from 70 to 100", () => {
  const source = migration();
  expect(source).toMatch(/drop constraint if exists remote_commands_audio_id_check/i);
  expect(source).toMatch(
    /add constraint remote_commands_audio_id_check\s+check \(audio_id ~ '\^\(table:\(\[1-9\]\|\[1-9\]\[0-9\]\|100\)\|announcement:/i,
  );
  expect(source).not.toMatch(/\[1-6\]\[0-9\]\|70/);
});

it("redefines create_remote_command with the 1-100 table pattern", () => {
  const source = migration();
  expect(source).toMatch(/create or replace function public\.create_remote_command\(/i);
  expect(source).toMatch(
    /p_audio_id !~ '\^\(table:\(\[1-9\]\|\[1-9\]\[0-9\]\|100\)\|announcement:/i,
  );
  expect(source).toMatch(
    /grant execute on function public\.create_remote_command\(uuid, text, text\) to service_role/i,
  );
});

it("lowers mutate_catalog's minimum upload size from 1 MB to 1 KB while keeping the 10 MB max", () => {
  const source = migration();
  expect(source).toMatch(/create or replace function public\.mutate_catalog\(/i);
  expect(source).toMatch(/not between 1024 and 10485760/i);
  expect(source).not.toMatch(/not between 1048576 and 10485760/i);
});
