import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { CREW_ROLES, type CrewRole } from "./role-session-domain";

// Task 6 Step 9 (revised design -- see docs/superpowers/plans/
// 2026-08-29-table-occupancy-tracking.md, Task 6 Step 9 note): the plan's
// original text says these wrappers use "a service-role Supabase client".
// That is only true for record_qr_scan (see table-occupancy.server.ts).
// claim_role_session is `revoke ... from service_role` / `grant execute
// ... to authenticated` in
// supabase/migrations/20260829020000_table_occupancy_rpcs.sql, and its body
// hard-fails with `UNAUTHORIZED` when `auth.uid() is null` -- a service-role
// JWT carries no `auth.uid()` and can never pass that check regardless of
// grants. The caller must instead hold a genuine Supabase Auth session
// (anonymous auth is sufficient) and forward that session's access token
// to this server function; getAnonAuthedSupabaseClient builds a per-request
// client authenticated as that caller -- never the service role -- for
// exactly this RPC (and is re-exported for the same five RPCs in
// table-occupancy.server.ts that share this grant shape).
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

const GENERIC_ERROR = "Gagal memulai sesi peran.";

const CLAIM_ROLE_SESSION_ERRORS = new Set([
  "UNAUTHORIZED",
  "INVALID_ROLE",
  "INVALID_TENANT_SESSION",
  "INVALID_NAME",
  "INVALID_CHECKED_IN_AT",
]);

export type ClaimRoleSessionErrorCode =
  | "UNAUTHORIZED"
  | "INVALID_ROLE"
  | "INVALID_TENANT_SESSION"
  | "INVALID_NAME"
  | "INVALID_CHECKED_IN_AT"
  | "UNAVAILABLE";

export type ClaimRoleSessionResult =
  | {
      ok: true;
      sessionId: string;
      role: CrewRole;
      displayName: string;
      checkedInAt: string;
      sessionToken: string;
    }
  | { ok: false; code: ClaimRoleSessionErrorCode; message: string };

export type RpcCaller = (
  fn: string,
  params: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

export const claimRoleSessionInputSchema = z.object({
  restaurantId: z.string().uuid(),
  tenantToken: z.string().min(1),
  role: z.enum(CREW_ROLES),
  displayName: z.string().min(1).max(40),
  checkedInAt: z.string().min(1),
  accessToken: z.string().min(1),
});

type ClaimRoleSessionRpcInput = Omit<z.infer<typeof claimRoleSessionInputSchema>, "accessToken">;

// Pure, dependency-injected core: takes an already-authenticated `rpc`
// caller so tests can supply a mock without constructing a real Supabase
// client (see tests/table-occupancy-server.test.ts).
export async function claimRoleSessionCore(
  data: ClaimRoleSessionRpcInput,
  rpc: RpcCaller,
): Promise<ClaimRoleSessionResult> {
  try {
    const { data: result, error } = await rpc("claim_role_session", {
      p_restaurant_id: data.restaurantId,
      p_tenant_token: data.tenantToken,
      p_role: data.role,
      p_display_name: data.displayName,
      p_checked_in_at: data.checkedInAt,
    });
    if (error) {
      const code = CLAIM_ROLE_SESSION_ERRORS.has(error.message)
        ? (error.message as ClaimRoleSessionErrorCode)
        : "UNAVAILABLE";
      return { ok: false, code, message: GENERIC_ERROR };
    }
    const payload = result as { session?: Record<string, unknown>; session_token?: unknown } | null;
    const session = payload?.session;
    const sessionToken = payload?.session_token;
    if (!session || typeof sessionToken !== "string") {
      return { ok: false, code: "UNAVAILABLE", message: GENERIC_ERROR };
    }
    return {
      ok: true,
      sessionId: String(session.id),
      role: session.role as CrewRole,
      displayName: String(session.display_name),
      checkedInAt: String(session.checked_in_at),
      sessionToken,
    };
  } catch {
    return { ok: false, code: "UNAVAILABLE", message: GENERIC_ERROR };
  }
}

export const claimRoleSession = createServerFn({ method: "POST" })
  .validator(claimRoleSessionInputSchema)
  .handler(async ({ data }): Promise<ClaimRoleSessionResult> => {
    const client = getAnonAuthedSupabaseClient(data.accessToken);
    if (!client) return { ok: false, code: "UNAVAILABLE", message: GENERIC_ERROR };
    const { accessToken: _accessToken, ...rpcData } = data;
    return claimRoleSessionCore(rpcData, async (fn, params) => client.rpc(fn, params));
  });

// Verification helper mirroring verifyActiveTenantSession/
// verifyCrewSessionToken in restaurant-session.server.ts: role_session_tokens
// only has table-level revokes against public/anon/authenticated (Task 5's
// migration), never against service_role, so a plain service-role client is
// valid here for a direct table read -- the revoke that blocks a
// service-role *RPC* call above does not apply to this table *select*.
export async function verifyRoleSessionToken(
  client: SupabaseClient,
  token: string,
  restaurantId: string,
  role?: CrewRole,
) {
  // Dynamic import (not a top-level `import ... from "node:crypto"`) so this
  // module stays safe to import from client code: RoleLoginFlow.tsx imports
  // claimRoleSession from this file, and a static node:crypto import at the
  // top of the file gets pulled into the client bundle by Vite even though
  // this specific function is server-only (see
  // tests/restaurant-login-build.test.ts, and restaurant-code.server.ts's
  // dynamic-import split in restaurants.server.ts for the established
  // pattern this follows).
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
