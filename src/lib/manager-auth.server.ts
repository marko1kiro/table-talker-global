import { createHmac } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getAuthSecret } from "./auth.server";
import { getServiceClient } from "./remote-audio.server";
import { verifyManagerPassword } from "./manager-password.server";
import type { RpcCaller } from "./role-session.server";

const GENERIC = "Terjadi kesalahan. Coba lagi.";

export type ManagerAuthDeps = {
  rpc: RpcCaller;
  rateLimitReservationId?: string;
  hash?: (password: string) => Promise<string>;
  verify?: (password: string, stored: string) => Promise<boolean>;
  createSession?: (managerId: string) => Promise<{ token: string; expiresAt: string } | null>;
};

// --- login ----------------------------------------------------------------

type ManagerCredential = {
  id: string;
  password_hash: string;
  status: string;
  full_name: string;
  restaurant_id: string;
  restaurant_display_name: string;
  restaurant_code: string;
};

export type LoginManagerResult =
  | {
      ok: true;
      managerToken: string;
      idManager: string;
      fullName: string;
      restaurantId: string;
      restaurantDisplayName: string;
      restaurantCode: string;
    }
  | {
      ok: false;
      code: "INVALID_CREDENTIALS" | "DISABLED" | "UNAVAILABLE";
      message: string;
    };

// The bearer is deterministic for one manager+reservation but unforgeable
// without AUTH_SECRET. A lost server response can therefore be retried with
// the exact same bearer while the database persists only its SHA-256 hash.
export function deriveManagerSessionToken(
  managerId: string,
  rateLimitReservationId: string,
  secret = getAuthSecret(),
): string {
  return createHmac("sha256", secret)
    .update(`manager-session:${managerId}:${rateLimitReservationId}`)
    .digest("hex");
}

async function defaultCreateSession(
  rpc: RpcCaller,
  managerId: string,
  rateLimitReservationId?: string,
): Promise<{ token: string; expiresAt: string } | null> {
  if (!rateLimitReservationId) return null;
  const token = deriveManagerSessionToken(managerId, rateLimitReservationId);
  const { data, error } = await rpc("create_manager_session_pending", {
    p_manager_id: managerId,
    p_reservation_id: rateLimitReservationId,
    p_token: token,
  });
  if (error || data !== true) return null;
  return { token, expiresAt: "" };
}

export async function loginManagerCore(
  data: { idManager: string; password: string; rateLimitReservationId?: string },
  deps: ManagerAuthDeps,
): Promise<LoginManagerResult> {
  const verify = deps.verify ?? verifyManagerPassword;
  const { data: cred, error } = await deps.rpc("get_manager_credential", {
    p_id_manager: data.idManager,
  });
  if (error || !cred || typeof cred !== "object") {
    return {
      ok: false,
      code: "INVALID_CREDENTIALS",
      message: "ID Manager atau password salah.",
    };
  }
  const c = cred as ManagerCredential;
  if (!(await verify(data.password, c.password_hash))) {
    return {
      ok: false,
      code: "INVALID_CREDENTIALS",
      message: "ID Manager atau password salah.",
    };
  }
  if (c.status !== "aktif") {
    return { ok: false, code: "DISABLED", message: "Akun manager ini sudah dinonaktifkan." };
  }
  if (!deps.createSession && !data.rateLimitReservationId) {
    return { ok: false, code: "UNAVAILABLE", message: GENERIC };
  }
  const session = deps.createSession
    ? await deps.createSession(c.id)
    : await defaultCreateSession(deps.rpc, c.id, data.rateLimitReservationId as string);
  if (!session) return { ok: false, code: "UNAVAILABLE", message: GENERIC };
  return {
    ok: true,
    managerToken: session.token,
    idManager: data.idManager,
    fullName: c.full_name,
    restaurantId: c.restaurant_id,
    restaurantDisplayName: c.restaurant_display_name,
    restaurantCode: c.restaurant_code,
  };
}

// loginManagerCore is INTERNAL to the staff login (staff-login.server.ts) and
// is intentionally NOT exposed as a server function: a direct endpoint would
// bypass the shared rate-limit reservation and leak a distinct
// "account disabled" message (enumeration oracle). The legacy `loginManager`
// server fn and its input schema were removed in the Poin 2 review fixes;
// /manager/login uses loginStaff, which maps every failure to the generic
// message.

// --- logout (server-authoritative, R3-A) -------------------------------------

export const logoutManagerInputSchema = z.object({ managerToken: z.string().min(1).max(200) });

type ManagerLogoutRpcClient = {
  rpc: (
    fn: string,
    params: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

/**
 * Revokes the manager bearer session server-side BEFORE the client drops its
 * sessionStorage identity. A stolen token can no longer be replayed after
 * logout. Returns ok:false on transport failure or an unproven verdict so the
 * client keeps its credential (fail closed) instead of silently leaving a
 * live bearer.
 */
export async function logoutManagerSessionCore(
  client: ManagerLogoutRpcClient | null,
  managerToken: string,
): Promise<{ ok: boolean }> {
  if (!client) return { ok: false };
  // R6-B: logout is fail-closed. REVOKED means the live row was revoked
  // now; ALREADY_INACTIVE is safe only when the hashed tombstone proves the
  // token was issued and revoked earlier. UNKNOWN_TOKEN has no such proof:
  // historical cutover data and tombstone deployment/history gaps can leave
  // no durable record, so it must not be treated as successful logout.
  try {
    const { data: verdict, error } = await client.rpc("revoke_manager_session_by_token", {
      p_token: managerToken,
    });
    if (error) return { ok: false };
    const v = (verdict as { verdict?: string } | null)?.verdict;
    return { ok: v === "REVOKED" || v === "ALREADY_INACTIVE" };
  } catch {
    // The server function is a logout safety boundary: normalize a rejected
    // transport promise to the same fail-closed result as an RPC error.
    return { ok: false };
  }
}

export const logoutManagerSession = createServerFn({ method: "POST" })
  .validator(logoutManagerInputSchema)
  .handler(
    async ({ data }): Promise<{ ok: boolean }> =>
      logoutManagerSessionCore(getServiceClient(), data.managerToken),
  );

// --- change own password (while logged in) ----------------------------------

export const changeManagerPasswordInputSchema = z.object({
  managerToken: z.string().min(1),
  oldPassword: z.string().min(1),
  newPassword: z.string(),
});

/**
 * Verifies the OLD password authoritatively (the manager id comes from the
 * live bearer token, not the client), swaps the hash and revokes ALL manager
 * sessions — including the current one — so the user must log in again.
 */
export const changeManagerPassword = createServerFn({ method: "POST" })
  .validator(changeManagerPasswordInputSchema)
  .handler(async ({ data }): Promise<{ ok: boolean; code?: string }> => {
    const client = getServiceClient();
    if (!client) return { ok: false, code: "UNAVAILABLE" };
    const { data: managerId, error: tokenError } = await client.rpc("get_manager_id_by_token", {
      p_token: data.managerToken,
    });
    if (tokenError || typeof managerId !== "string" || !managerId) {
      return { ok: false, code: "INVALID_SESSION" };
    }
    const { changeStaffPasswordCore } = await import("./super-admin-auth.server");
    return changeStaffPasswordCore("manager", managerId, data.oldPassword, data.newPassword, {
      rpc: async (fn, params) => client.rpc(fn, params),
      verify: verifyManagerPassword,
    });
  });
