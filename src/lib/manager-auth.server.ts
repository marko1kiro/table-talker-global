import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getServiceClient } from "./remote-audio.server";
import { verifyManagerPassword } from "./manager-password.server";
import type { RpcCaller } from "./role-session.server";

const GENERIC = "Terjadi kesalahan. Coba lagi.";

export type ManagerAuthDeps = {
  rpc: RpcCaller;
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

// create_manager_session_pending returns the plaintext bearer token as a
// scalar string. R6-A: the login path mints a PENDING session (60s TTL,
// unusable by every consumer until the browser confirms the handoff). The
// legacy active-mint RPC create_manager_session was dropped — no caller may
// establish a usable session server-side anymore.
async function defaultCreateSession(
  rpc: RpcCaller,
  managerId: string,
): Promise<{ token: string; expiresAt: string } | null> {
  const { data, error } = await rpc("create_manager_session_pending", {
    p_manager_id: managerId,
  });
  if (error || typeof data !== "string" || !data) return null;
  return { token: data, expiresAt: "" };
}

export async function loginManagerCore(
  data: { idManager: string; password: string },
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
  const session = deps.createSession
    ? await deps.createSession(c.id)
    : await defaultCreateSession(deps.rpc, c.id);
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

/**
 * Revokes the manager bearer session server-side BEFORE the client drops its
 * sessionStorage identity. A stolen token can no longer be replayed after
 * logout. Returns ok:false on transport failure so the client keeps its
 * credential (fail closed) instead of silently leaving a live bearer.
 */
export const logoutManagerSession = createServerFn({ method: "POST" })
  .validator(logoutManagerInputSchema)
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    const client = getServiceClient();
    if (!client) return { ok: false };
    const { error } = await client.rpc("revoke_manager_session_by_token", {
      p_token: data.managerToken,
    });
    if (error) return { ok: false };
    return { ok: true };
  });

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
