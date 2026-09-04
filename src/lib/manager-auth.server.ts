import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getServiceClient } from "./remote-audio.server";
import { hashManagerPassword, verifyManagerPassword } from "./manager-password.server";
import type { RpcCaller } from "./role-session.server";

const GENERIC = "Terjadi kesalahan. Coba lagi.";

export type ManagerAuthDeps = {
  rpc: RpcCaller;
  hash?: (password: string) => Promise<string>;
  verify?: (password: string, stored: string) => Promise<boolean>;
  createSession?: (managerId: string) => Promise<{ token: string; expiresAt: string } | null>;
};

// --- register -------------------------------------------------------------

export const registerManagerInputSchema = z.object({
  idManager: z
    .string()
    .trim()
    .min(3)
    .max(32)
    .regex(/^[a-z0-9._-]+$/, "ID Manager tidak valid."),
  fullName: z.string().trim().min(1).max(80),
  restaurantCode: z.string().trim().min(1).max(40),
  password: z.string().min(8).max(200),
});

export type RegisterManagerInput = z.infer<typeof registerManagerInputSchema>;
export type RegisterManagerResult =
  | { ok: true }
  | {
      ok: false;
      code: "WEAK_PASSWORD" | "RESTAURANT_NOT_FOUND" | "ID_MANAGER_TAKEN" | "UNAVAILABLE";
      message?: string;
    };

export async function registerManagerCore(
  data: RegisterManagerInput,
  deps: ManagerAuthDeps,
): Promise<RegisterManagerResult> {
  if (data.password.length < 8) return { ok: false, code: "WEAK_PASSWORD" };
  const hash = deps.hash ?? hashManagerPassword;
  const passwordHash = await hash(data.password);
  const { error } = await deps.rpc("register_manager", {
    p_id_manager: data.idManager,
    p_full_name: data.fullName,
    p_restaurant_code: data.restaurantCode,
    p_password_hash: passwordHash,
  });
  if (error) {
    if (error.message === "RESTAURANT_NOT_FOUND")
      return { ok: false, code: "RESTAURANT_NOT_FOUND" };
    if (error.message === "ID_MANAGER_TAKEN") return { ok: false, code: "ID_MANAGER_TAKEN" };
    return { ok: false, code: "UNAVAILABLE", message: GENERIC };
  }
  return { ok: true };
}

export const registerManager = createServerFn({ method: "POST" })
  .validator(registerManagerInputSchema)
  .handler(async ({ data }): Promise<RegisterManagerResult> => {
    const client = getServiceClient();
    if (!client) return { ok: false, code: "UNAVAILABLE", message: GENERIC };
    return registerManagerCore(data, { rpc: async (fn, params) => client.rpc(fn, params) });
  });

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

export const loginManagerInputSchema = z.object({
  idManager: z.string().min(1),
  password: z.string().min(1),
});

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

// create_manager_session returns the plaintext bearer token as a scalar string.
async function defaultCreateSession(
  rpc: RpcCaller,
  managerId: string,
): Promise<{ token: string; expiresAt: string } | null> {
  const { data, error } = await rpc("create_manager_session", { p_manager_id: managerId });
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

export const loginManager = createServerFn({ method: "POST" })
  .validator(loginManagerInputSchema)
  .handler(async ({ data }): Promise<LoginManagerResult> => {
    const client = getServiceClient();
    if (!client) return { ok: false, code: "UNAVAILABLE", message: GENERIC };
    return loginManagerCore(data, { rpc: async (fn, params) => client.rpc(fn, params) });
  });
