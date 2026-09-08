import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSuperAdmin } from "./auth.server";
import { getServiceClient } from "./remote-audio.server";

export type AdminManagerRow = {
  id: string;
  idManager: string;
  fullName: string;
  restaurantId: string;
  restaurantName: string;
  restaurantCode: string;
  status: string;
  createdAt: string;
};

export const listManagers = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ ok: true; managers: AdminManagerRow[] } | { ok: false; error: string }> => {
    await requireSuperAdmin();
    const client = getServiceClient();
    if (!client) return { ok: false, error: "Tidak dapat memuat data manager." };
    const { data, error } = await client
      .from("manager_accounts")
      .select(
        "id, id_manager, full_name, restaurant_id, status, created_at, restaurants(display_name, code)",
      )
      .order("created_at", { ascending: false });
    if (error) return { ok: false, error: "Tidak dapat memuat data manager." };
    const managers = (data ?? []).map((row) => {
      const r = row as unknown as Record<string, unknown>;
      const resto = (r.restaurants ?? {}) as Record<string, unknown>;
      return {
        id: String(r.id),
        idManager: String(r.id_manager),
        fullName: String(r.full_name),
        restaurantId: String(r.restaurant_id),
        restaurantName: String(resto.display_name ?? ""),
        restaurantCode: String(resto.code ?? ""),
        status: String(r.status),
        createdAt: String(r.created_at),
      };
    });
    return { ok: true, managers };
  },
);

export const disableManager = createServerFn({ method: "POST" })
  .validator(z.object({ managerId: z.string().uuid() }))
  .handler(async ({ data }): Promise<{ ok: boolean; error?: string }> => {
    const session = await requireSuperAdmin();
    const client = getServiceClient();
    if (!client) return { ok: false, error: "Tidak dapat mengubah data manager." };
    // Routed through the security-definer RPC: authoritative authority check,
    // atomic session revocation, and an append-only audit entry.
    const { error } = await client.rpc("set_manager_status", {
      p_actor_kind: "super_admin",
      p_actor_id: session.data.superAdminAccountId,
      p_manager_id: data.managerId,
      p_new_status: "nonaktif",
    });
    if (error) return { ok: false, error: "Tidak dapat mengubah data manager." };
    return { ok: true };
  });

// --- Super Admin: full manager lifecycle (global) ----------------------------

export const saCreateManagerInput = z.object({
  staffId: z.string(),
  fullName: z.string().trim().min(1).max(80),
  restaurantId: z.string().uuid(),
  password: z.string(),
});

export const saCreateManager = createServerFn({ method: "POST" })
  .validator(saCreateManagerInput)
  .handler(async ({ data }): Promise<{ ok: boolean; code?: string }> => {
    const session = await requireSuperAdmin();
    const client = getServiceClient();
    if (!client) return { ok: false, code: "UNAVAILABLE" };
    const { normalizeStaffId, staffIdIsValid, staffPasswordIsValid } =
      await import("./staff-identity.server");
    const staffId = normalizeStaffId(data.staffId);
    if (!staffIdIsValid(staffId)) return { ok: false, code: "STAFF_ID_INVALID" };
    if (!staffPasswordIsValid(data.password)) return { ok: false, code: "WEAK_PASSWORD" };
    const { hashManagerPassword } = await import("./manager-password.server");
    const passwordHash = await hashManagerPassword(data.password);
    const { error } = await client.rpc("create_manager_account", {
      p_actor_kind: "super_admin",
      p_actor_id: session.data.superAdminAccountId,
      p_staff_id: staffId,
      p_full_name: data.fullName,
      p_restaurant_id: data.restaurantId,
      p_password_hash: passwordHash,
    });
    if (error) return { ok: false, code: error.message };
    return { ok: true };
  });

export const saRenameManager = createServerFn({ method: "POST" })
  .validator(z.object({ managerId: z.string().uuid(), fullName: z.string().trim().min(1).max(80) }))
  .handler(async ({ data }): Promise<{ ok: boolean; code?: string }> => {
    const session = await requireSuperAdmin();
    const client = getServiceClient();
    if (!client) return { ok: false, code: "UNAVAILABLE" };
    const { error } = await client.rpc("update_staff_profile", {
      p_actor_kind: "super_admin",
      p_actor_id: session.data.superAdminAccountId,
      p_target_kind: "manager",
      p_target_id: data.managerId,
      p_full_name: data.fullName,
    });
    return error ? { ok: false, code: error.message } : { ok: true };
  });

export const enableManager = createServerFn({ method: "POST" })
  .validator(z.object({ managerId: z.string().uuid() }))
  .handler(async ({ data }): Promise<{ ok: boolean; code?: string }> => {
    const session = await requireSuperAdmin();
    const client = getServiceClient();
    if (!client) return { ok: false, code: "UNAVAILABLE" };
    const { error } = await client.rpc("set_manager_status", {
      p_actor_kind: "super_admin",
      p_actor_id: session.data.superAdminAccountId,
      p_manager_id: data.managerId,
      p_new_status: "aktif",
    });
    return error ? { ok: false, code: error.message } : { ok: true };
  });
