import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const sql = readFileSync(
  new URL(
    "../supabase/migrations/20260902000000_escort_intent_10_minute_window.sql",
    import.meta.url,
  ),
  "utf8",
);

it("re-creates create_escort_intent with a 10-minute expires_at interval", () => {
  expect(sql).toMatch(/create (?:or replace )?function public\.create_escort_intent\(/i);
  expect(sql).toMatch(
    /insert into public\.table_escort_intents[\s\S]*?now\(\) \+ interval '10 minutes'/i,
  );
});

it("does not repeat the old 30-minute interval", () => {
  expect(sql).not.toMatch(/interval '30 minutes'/i);
});

it("still binds actor_session_id server-side from the verified satgas session, unchanged", () => {
  expect(sql).toMatch(/from public\.role_session_tokens[\s\S]*?role = 'satgas'/i);
  expect(sql).toMatch(/v_session\.role_session_id/i);
});

it("preserves the grant/revoke pair for create_escort_intent", () => {
  expect(sql).toMatch(
    /revoke all on function public\.create_escort_intent\(uuid, integer, text\) from public, anon, service_role/i,
  );
  expect(sql).toMatch(
    /grant execute on function public\.create_escort_intent\(uuid, integer, text\) to authenticated/i,
  );
});
