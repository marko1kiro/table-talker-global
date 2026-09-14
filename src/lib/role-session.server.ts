import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { CREW_ROLES, type CrewRole } from "./role-session-domain";

// Poin 3 Task 9 (hard cutover): the account-less role-claim server wrapper, its
// dependency-injected core, its Zod input schema and the claim result/error
// types were deleted here. Their only caller was the old "kode + PIN" login
// flow, and the RPC it invoked is dropped by
// supabase/migrations/20260913130000_crew_legacy_cutover.sql. Crew authority now
// flows through crew_shift_claim (see crew-auth.server.ts). What remains is the
// shared client factory + the two types the server modules are typed against;
// the old role-token verifier went with the claim path (its last caller was the
// deleted wrapper, and the occupancy / realtime RPCs verify tokens inside the
// database themselves).

// getAnonAuthedSupabaseClient builds a per-request client authenticated as the
// CALLER (never the service role), forwarding the browser carrier JWT as a
// Bearer header. The auth.uid()-scoped RPCs it is used for are
// `revoke ... from service_role` / `grant execute ... to authenticated`, and
// their bodies hard-fail with `UNAUTHORIZED` when `auth.uid() is null` -- a
// service-role JWT carries no `auth.uid()` and can never pass that check
// regardless of grants, so the caller's real session must be forwarded. Reused
// by crew-auth.server.ts, table-occupancy.server.ts, the
// manager/AM dashboard reads, and manager-auth.
export function getAnonAuthedSupabaseClient(accessToken: string): SupabaseClient | null {
  const url = process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey || !accessToken) return null;
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

// Re-exported for backward compatibility with the existing Task 6 import in
// table-occupancy.server.ts; the canonical definition lives in
// role-session-domain.ts (see import above).
export { CREW_ROLES };
export type { CrewRole };

// Shared shape for the dependency-injected RPC cores across the server modules
// (crew-auth.server.ts, manager reads, table-occupancy).
export type RpcCaller = (
  fn: string,
  params: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;
