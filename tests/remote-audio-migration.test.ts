import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  import.meta.dirname,
  "../supabase/migrations/20260812000000_super_admin_remote_audio.sql",
);
const operationsPath = resolve(import.meta.dirname, "../docs/supabase-super-admin-remote-audio.md");

function migration(): string {
  return readFileSync(migrationPath, "utf8");
}

function operations(): string {
  return readFileSync(operationsPath, "utf8");
}

describe("remote audio Supabase migration", () => {
  it("defines auth-bound sessions with atomic fresh-online name claims", () => {
    expect(migration()).toMatch(/create table public\.crew_sessions/i);
    expect(migration()).toMatch(/values\s*\(\s*auth\.uid\(\), p_normalized_name/i);
    expect(migration()).toMatch(
      /create unique index crew_sessions_online_name_key[\s\S]*where connection_state = 'connected'/i,
    );
    expect(migration()).toMatch(
      /update public\.crew_sessions[\s\S]*last_seen <= now\(\) - interval '30 seconds'/i,
    );
  });

  it("forces hidden heartbeats offline", () => {
    expect(migration()).toMatch(
      /connection_state = case when p_visibility_state = 'visible' then p_connection_state else 'disconnected' end/i,
    );
    expect(migration()).toMatch(
      /offline_at = case when p_visibility_state = 'visible' and p_connection_state = 'connected' then null else now\(\) end/i,
    );
  });

  it("enforces five-second command delivery and targeted acknowledgement", () => {
    expect(migration()).toMatch(
      /audio_id text not null check \(audio_id ~ '\^\(table:\(\[1-9\]\|\[1-6\]\[0-9\]\|70\)\|announcement:\(seating\|himbauan-barang-bawaan-pelanggan\|outside-food\|no-smoking\|larangan-gabung-meja\|jam-buka-resto\)\)\$'/i,
    );
    expect(migration()).toMatch(/check \(expires_at = created_at \+ interval '5 seconds'\)/i);
    expect(migration()).toMatch(
      /target_session_id = auth\.uid\(\)\s+and status = 'sent'\s+and expires_at > now\(\)/i,
    );
  });

  it("defaults to RLS denial, grants RPCs only, and configures idempotent realtime plus retention", () => {
    expect(migration()).toMatch(
      /enable row level security[\s\S]*revoke all on public\.crew_sessions, public\.remote_commands from anon, authenticated/i,
    );
    expect(migration()).toMatch(/create policy "crew reads own session"[\s\S]*id = auth\.uid\(\)/i);
    expect(migration()).toMatch(
      /create policy "crew reads targeted commands"[\s\S]*target_session_id = auth\.uid\(\)/i,
    );
    expect(migration()).toMatch(
      /grant execute on function public\.claim_crew_session[\s\S]*to authenticated/i,
    );
    expect(migration()).toMatch(
      /grant execute on function public\.expire_remote_commands\(\), public\.cleanup_remote_commands\(\) to service_role/i,
    );
    expect(migration()).toMatch(
      /do \$\$[\s\S]*alter publication supabase_realtime add table public\.remote_commands[\s\S]*duplicate_object/i,
    );
    expect(migration()).toMatch(/created_at < now\(\) - interval '7 days'/i);
    expect(migration()).toMatch(
      /create index remote_commands_sent_expires_at_idx on public\.remote_commands \(expires_at\) where status = 'sent'/i,
    );
    expect(migration()).toMatch(/create extension if not exists pg_cron/i);
  });

  it("documents expiry as authoritative before minute-level audit updates", () => {
    expect(operations()).toMatch(
      /`sent` commands with `expires_at <= now\(\)` as expired immediately/i,
    );
    expect(operations()).toMatch(/must never play/i);
    expect(operations()).toMatch(/server snapshot/i);
    expect(operations()).toMatch(/minute cron only persists the audit status eventually/i);
  });
});
