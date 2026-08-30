import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const sql = readFileSync(
  new URL("../supabase/migrations/20260829010000_table_occupancy_schema.sql", import.meta.url),
  "utf8",
);

it("creates table_occupancy_state as the restaurant-scoped, RLS-locked 2-state machine", () => {
  expect(sql).toMatch(/create table public\.table_occupancy_state/i);
  expect(sql).toMatch(
    /restaurant_id uuid not null references public\.restaurants\s*\(\s*id\s*\)\s*on delete cascade/i,
  );
  expect(sql).toMatch(/table_number integer not null check \(table_number between 1 and 100\)/i);
  expect(sql).toMatch(
    /status text not null default 'kosong' check \(status in \('kosong', 'terisi'\)\)/i,
  );
  expect(sql).toMatch(
    /occupied_source text check \(occupied_source in \('qr_scan', 'kasir', 'satgas_escort'\)\)/i,
  );
  expect(sql).toMatch(/primary key \(restaurant_id, table_number\)/i);
  expect(sql).toMatch(/alter table public\.table_occupancy_state enable row level security/i);
  expect(sql).toMatch(
    /revoke all on public\.table_occupancy_state from public, anon, authenticated/i,
  );
});

it("creates qr_scan_events as a restaurant-scoped, RLS-locked audit log", () => {
  expect(sql).toMatch(/create table public\.qr_scan_events/i);
  expect(sql).toMatch(
    /qr_scan_events[\s\S]*?restaurant_id uuid not null references public\.restaurants\s*\(\s*id\s*\)\s*on delete cascade/i,
  );
  expect(sql).toMatch(/table_number integer not null check \(table_number between 1 and 100\)/i);
  expect(sql).toMatch(
    /create index qr_scan_events_restaurant_time_idx on public\.qr_scan_events \(restaurant_id, scanned_at\)/i,
  );
  expect(sql).toMatch(/alter table public\.qr_scan_events enable row level security/i);
  expect(sql).toMatch(/revoke all on public\.qr_scan_events from public, anon, authenticated/i);
});

it("creates table_escort_intents as a restaurant-scoped, actor-owned, auto-expiring intent log", () => {
  expect(sql).toMatch(/create table public\.table_escort_intents/i);
  expect(sql).toMatch(
    /table_escort_intents[\s\S]*?restaurant_id uuid not null references public\.restaurants\s*\(\s*id\s*\)\s*on delete cascade/i,
  );
  expect(sql).toMatch(/actor_session_id uuid not null/i);
  expect(sql).toMatch(/expires_at timestamptz not null/i);
  expect(sql).toMatch(/resolved boolean not null default false/i);
  expect(sql).toMatch(
    /create index table_escort_intents_actor_idx on public\.table_escort_intents \(actor_session_id, resolved\)/i,
  );
  expect(sql).toMatch(/alter table public\.table_escort_intents enable row level security/i);
  expect(sql).toMatch(
    /revoke all on public\.table_escort_intents from public, anon, authenticated/i,
  );
});

it("creates crew_role_sessions as a restaurant-scoped audit trail for all 4 field roles", () => {
  expect(sql).toMatch(/create table public\.crew_role_sessions/i);
  expect(sql).toMatch(
    /crew_role_sessions[\s\S]*?restaurant_id uuid not null references public\.restaurants\s*\(\s*id\s*\)\s*on delete cascade/i,
  );
  expect(sql).toMatch(
    /role text not null check \(role in \('ss', 'kasir', 'satgas', 'clear_up'\)\)/i,
  );
  expect(sql).toMatch(
    /display_name text not null check \(char_length\(display_name\) between 1 and 40\)/i,
  );
  expect(sql).toMatch(/checked_in_at timestamptz not null/i);
  expect(sql).toMatch(
    /create index crew_role_sessions_restaurant_role_idx\s+on public\.crew_role_sessions \(restaurant_id, role, checked_in_at\)/i,
  );
  expect(sql).toMatch(/alter table public\.crew_role_sessions enable row level security/i);
  expect(sql).toMatch(/revoke all on public\.crew_role_sessions from public, anon, authenticated/i);
});

it("creates role_session_tokens as an opaque, hashed, restaurant-scoped token store", () => {
  expect(sql).toMatch(/create table public\.role_session_tokens/i);
  expect(sql).toMatch(/token_hash text primary key check \(token_hash ~ '\^\[a-f0-9\]\{64\}\$'\)/i);
  expect(sql).toMatch(
    /role_session_tokens[\s\S]*?restaurant_id uuid not null references public\.restaurants\s*\(\s*id\s*\)\s*on delete cascade/i,
  );
  expect(sql).toMatch(
    /role_session_id uuid not null references public\.crew_role_sessions\s*\(\s*id\s*\)\s*on delete cascade/i,
  );
  expect(sql).toMatch(
    /role text not null check \(role in \('ss', 'kasir', 'satgas', 'clear_up'\)\)/i,
  );
  expect(sql).toMatch(/expires_at timestamptz not null/i);
  expect(sql).toMatch(
    /create index role_session_tokens_session_idx on public\.role_session_tokens \(role_session_id, expires_at\)/i,
  );
  expect(sql).toMatch(/alter table public\.role_session_tokens enable row level security/i);
  expect(sql).toMatch(
    /revoke all on public\.role_session_tokens from public, anon, authenticated/i,
  );
});

it("adds retention cleanup functions for qr_scan_events (30d) and table_escort_intents (90d)", () => {
  expect(sql).toMatch(/create (?:or replace )?function public\.cleanup_qr_scan_events\(\)/i);
  expect(sql).toMatch(
    /delete from public\.qr_scan_events where scanned_at < now\(\) - interval '30 days'/i,
  );
  expect(sql).toMatch(
    /revoke all on function public\.cleanup_qr_scan_events\(\) from public, anon, authenticated/i,
  );

  expect(sql).toMatch(/create (?:or replace )?function public\.cleanup_table_escort_intents\(\)/i);
  expect(sql).toMatch(
    /delete from public\.table_escort_intents where expires_at < now\(\) - interval '90 days'/i,
  );
  expect(sql).toMatch(
    /revoke all on function public\.cleanup_table_escort_intents\(\) from public, anon, authenticated/i,
  );
});

it("adds a nullable esb_app_id column to restaurants for future QR Interceptor tenant mapping", () => {
  expect(sql).toMatch(/alter table public\.restaurants add column if not exists esb_app_id text/i);
});

it("grants no direct table privileges to public/anon/authenticated roles anywhere in the migration", () => {
  // Every new table must be mutated only via RPCs added in Task 6, never
  // directly from the client. This is a defense-in-depth sweep: fail if any
  // `grant ... to anon` or `grant ... to authenticated` sneaks onto one of
  // the five new tables in this migration.
  const newTables = [
    "table_occupancy_state",
    "qr_scan_events",
    "table_escort_intents",
    "crew_role_sessions",
    "role_session_tokens",
  ];
  for (const table of newTables) {
    const grantToClientPattern = new RegExp(
      `grant\\s+[\\s\\S]*?on\\s+public\\.${table}\\s+to\\s+(anon|authenticated)`,
      "i",
    );
    expect(sql).not.toMatch(grantToClientPattern);
  }
});
