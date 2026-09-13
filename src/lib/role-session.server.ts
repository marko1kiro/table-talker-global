import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { CREW_ROLES, type CrewRole } from "./role-session-domain";

// Poin 3 Task 9 (hard cutover): the account-less role-claim server wrapper, its
// dependency-injected core, its Zod input schema and the claim result/error
// types were deleted here. Their only caller was the old "kode + PIN" login
// flow, and the RPC it invoked is dropped by
// supabase/migrations/20260913130000_crew_legacy_cutover.sql. Crew authority now
// flows through crew_shift_claim (see crew-auth.server.ts). What remains is the
// shared, still-used client factory + the role-token verifier that the occupancy
// / realtime RPCs depend on.

// getAnonAuthedSupabaseClient builds a per-request client authenticated as the
// CALLER (never the service role), forwarding the browser carrier JWT as a
// Bearer header. The auth.uid()-scoped RPCs it is used for are
// `revoke ... from service_role` / `grant execute ... to authenticated`, and
// their bodies hard-fail with `UNAUTHORIZED` when `auth.uid() is null` -- a
// service-role JWT carries no `auth.uid()` and can never pass that check
// regardless of grants, so the caller's real session must be forwarded. Reused
// by crew-auth.server.ts, table-occupancy.server.ts, crew-instructions, the
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

// Re-exported for backward compatibility with existing Task 6 imports
// (table-occupancy.server.ts, tests/role-session-server.test.ts); canonical
// definition now lives in role-session-domain.ts (see import above).
export { CREW_ROLES };
export type { CrewRole };

// Shared shape for the dependency-injected RPC cores across the server modules
// (crew-auth.server.ts, crew-instructions, manager reads, table-occupancy).
export type RpcCaller = (
  fn: string,
  params: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

// Verification helper mirroring verifyActiveTenantSession/
// verifyCrewSessionToken in restaurant-session.server.ts: role_session_tokens
// only has table-level revokes against public/anon/authenticated (Task 5's
// migration), never against service_role, so a plain service-role client is
// valid here for a direct table read -- the revoke that blocks a service-role
// *RPC* call does not apply to this table *select*.
export async function verifyRoleSessionToken(
  client: SupabaseClient,
  token: string,
  restaurantId: string,
  role?: CrewRole,
) {
  // Dynamic import (not a top-level `import ... from "node:crypto"`) so this
  // module stays safe to import from client code: crew-auth.server.ts (a client
  // import, via CrewLoginFlow.tsx) re-uses getAnonAuthedSupabaseClient from this
  // file, and a static node:crypto import at the top gets pulled into the client
  // bundle by Vite even though this specific function is server-only (see
  // tests/restaurant-login-build.test.ts).
  const { createHash } = await import("node:crypto");
  let query = client
    .from("role_session_tokens")
    .select("role_session_id, restaurant_id, role, expires_at")
    .eq("token_hash", createHash("sha256").update(token).digest("hex"))
    .eq("restaurant_id", restaurantId)
    .gt("expires_at", new Date().toISOString());
  if (role) query = query.eq("role", role);
  const { data, error } = await query.maybeSingle();
  if (error || !data) return null;
  return {
    roleSessionId: data.role_session_id as string,
    restaurantId: data.restaurant_id as string,
    role: data.role as CrewRole,
  };
}
