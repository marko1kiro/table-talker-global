// Area Manager server functions. Every privileged call goes through
// requireAreaManager (cookie bearer token validated against staff_sessions)
// AND the RPC-side authority checks (actor_can_manage_restaurant) — scope is
// never taken from frontend input.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { clearAuthSession, requireAreaManager, requireSuperAdmin } from "./auth.server";
import { writeAdminAudit } from "./admin-audit.server";
import { changeStaffPasswordCore } from "./super-admin-auth.server";
import { hashManagerPassword, verifyManagerPassword } from "./manager-password.server";
import { getServiceClient } from "./remote-audio.server";
import {
  normalizeStaffId,
  staffIdIsValid,
  staffPasswordIsValid,
  GENERIC_AUTH_FAILURE,
} from "./staff-identity.server";

const GENERIC = GENERIC_AUTH_FAILURE;

type RpcCaller = (
  fn: string,
  params: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

function serviceRpc(): RpcCaller | null {
  const client = getServiceClient();
  return client ? async (fn, params) => client.rpc(fn, params) : null;
}

export type AmScopeRow = { restaurant_id: string; display_name: string; restaurant_code: string };
export type AmManagerRow = {
  manager_id: string;
  staff_id: string;
  full_name: string;
  status: string;
  restaurant_id: string;
  restaurant_name: string;
  created_at: string;
};
export type AmPendingResetRow = {
  request_id: string;
  manager_id: string;
  staff_id: string;
  full_name: string;
  restaurant_id: string;
  restaurant_name: string;
  requested_at: string;
};
export type AuditRow = {
  id: string;
  actor_kind: string;
  actor_label: string | null;
  action: string;
  target_kind: string | null;
  target_id: string | null;
  restaurant_id: string | null;
  result: string;
  reason: string | null;
  created_at: string;
};
export type AmPendingOwnResetRow = {
  request_id: string;
  area_manager_id: string;
  staff_id: string;
  full_name: string;
  requested_at: string;
};
export type AreaManagerRow = {
  id: string;
  staff_id: string;
  full_name: string;
  status: string;
  created_at: string;
  area_manager_assignments: Array<{ restaurant_id: string; removed_at: string | null }>;
};
export type RestaurantWithoutAmRow = { restaurant_id: string; display_name: string };

async function currentAmAccount(): Promise<{ id: string; staffId: string } | null> {
  const session = await requireAreaManager();
  const accountId = session.data.areaManagerAccountId;
  if (!accountId) return null;
  const client = getServiceClient();
  if (!client) return null;
  const { data } = await client
    .from("area_manager_accounts")
    .select("id, staff_id")
    .eq("id", accountId)
    .eq("status", "aktif")
    .single();
  const row = data as { id: string; staff_id: string } | null;
  return row ? { id: row.id, staffId: row.staff_id } : null;
}

// --- AM scope / manager administration -------------------------------------

export const amScope = createServerFn({ method: "GET" }).handler(async () => {
  const am = await currentAmAccount();
  if (!am) return { ok: false as const, error: GENERIC };
  const rpc = serviceRpc();
  if (!rpc) return { ok: false as const, error: GENERIC };
  const { data, error } = await rpc("list_am_scope_restaurants", { p_am_id: am.id });
  if (error) return { ok: false as const, error: GENERIC };
  return { ok: true as const, restaurants: (data as AmScopeRow[]) ?? [] };
});

export const amManagers = createServerFn({ method: "GET" }).handler(async () => {
  const am = await currentAmAccount();
  if (!am) return { ok: false as const, error: GENERIC };
  const rpc = serviceRpc();
  if (!rpc) return { ok: false as const, error: GENERIC };
  const { data, error } = await rpc("list_managers_for_scope", { p_am_id: am.id });
  if (error) return { ok: false as const, error: GENERIC };
  return { ok: true as const, managers: (data as AmManagerRow[]) ?? [] };
});

export const amCreateManagerInput = z.object({
  staffId: z.string(),
  fullName: z.string().trim().min(1).max(80),
  restaurantId: z.string().uuid(),
  password: z.string(),
});

export const amCreateManager = createServerFn({ method: "POST" })
  .validator(amCreateManagerInput)
  .handler(async ({ data }): Promise<{ ok: boolean; code?: string }> => {
    const am = await currentAmAccount();
    if (!am) return { ok: false, code: "UNAUTHORIZED" };
    const staffId = normalizeStaffId(data.staffId);
    if (!staffIdIsValid(staffId)) return { ok: false, code: "STAFF_ID_INVALID" };
    if (!staffPasswordIsValid(data.password)) return { ok: false, code: "WEAK_PASSWORD" };
    const rpc = serviceRpc();
    if (!rpc) return { ok: false, code: "UNAVAILABLE" };
    const passwordHash = await hashManagerPassword(data.password);
    const { error } = await rpc("create_manager_account", {
      p_actor_kind: "area_manager",
      p_actor_id: am.id,
      p_staff_id: staffId,
      p_full_name: data.fullName,
      p_restaurant_id: data.restaurantId,
      p_password_hash: passwordHash,
    });
    if (error) return { ok: false, code: error.message };
    return { ok: true };
  });

export const amManagerStatusInput = z.object({
  managerId: z.string().uuid(),
  status: z.enum(["aktif", "nonaktif"]),
});

export const amSetManagerStatus = createServerFn({ method: "POST" })
  .validator(amManagerStatusInput)
  .handler(async ({ data }): Promise<{ ok: boolean; code?: string }> => {
    const am = await currentAmAccount();
    if (!am) return { ok: false, code: "UNAUTHORIZED" };
    const rpc = serviceRpc();
    if (!rpc) return { ok: false, code: "UNAVAILABLE" };
    const { error } = await rpc("set_manager_status", {
      p_actor_kind: "area_manager",
      p_actor_id: am.id,
      p_manager_id: data.managerId,
      p_new_status: data.status,
    });
    return error ? { ok: false, code: error.message } : { ok: true };
  });

export const amRenameManagerInput = z.object({
  managerId: z.string().uuid(),
  fullName: z.string().trim().min(1).max(80),
});

export const amRenameManager = createServerFn({ method: "POST" })
  .validator(amRenameManagerInput)
  .handler(async ({ data }): Promise<{ ok: boolean; code?: string }> => {
    const am = await currentAmAccount();
    if (!am) return { ok: false, code: "UNAUTHORIZED" };
    const rpc = serviceRpc();
    if (!rpc) return { ok: false, code: "UNAVAILABLE" };
    const { error } = await rpc("update_staff_profile", {
      p_actor_kind: "area_manager",
      p_actor_id: am.id,
      p_target_kind: "manager",
      p_target_id: data.managerId,
      p_full_name: data.fullName,
    });
    return error ? { ok: false, code: error.message } : { ok: true };
  });

// --- Manager password reset approvals ---------------------------------------

export const amPendingResets = createServerFn({ method: "GET" }).handler(async () => {
  const am = await currentAmAccount();
  if (!am) return { ok: false as const, error: GENERIC };
  const rpc = serviceRpc();
  if (!rpc) return { ok: false as const, error: GENERIC };
  const { data, error } = await rpc("list_pending_manager_resets", { p_am_id: am.id });
  if (error) return { ok: false as const, error: GENERIC };
  return { ok: true as const, requests: (data as AmPendingResetRow[]) ?? [] };
});

export const amDecideResetInput = z.object({
  requestId: z.string().uuid(),
  decision: z.enum(["approved", "rejected"]),
});

export const amDecideManagerReset = createServerFn({ method: "POST" })
  .validator(amDecideResetInput)
  .handler(async ({ data }): Promise<{ ok: boolean; code?: string }> => {
    const am = await currentAmAccount();
    if (!am) return { ok: false, code: "UNAUTHORIZED" };
    const rpc = serviceRpc();
    if (!rpc) return { ok: false, code: "UNAVAILABLE" };
    const { data: result, error } = await rpc("decide_manager_reset", {
      p_decider_kind: "area_manager",
      p_decider_id: am.id,
      p_request_id: data.requestId,
      p_decision: data.decision,
    });
    if (error) return { ok: false, code: error.message };
    return result === true ? { ok: true } : { ok: false, code: "ALREADY_DECIDED" };
  });

// --- AM self-service + audit -------------------------------------------------

export const amChangeOwnPassword = createServerFn({ method: "POST" })
  .validator(z.object({ oldPassword: z.string().min(1), newPassword: z.string() }))
  .handler(async ({ data }): Promise<{ ok: boolean; code?: string }> => {
    const am = await currentAmAccount();
    if (!am) return { ok: false, code: "UNAUTHORIZED" };
    const rpc = serviceRpc();
    if (!rpc) return { ok: false, code: "UNAVAILABLE" };
    const result = await changeStaffPasswordCore(
      "area_manager",
      am.id,
      data.oldPassword,
      data.newPassword,
      {
        rpc,
        verify: verifyManagerPassword,
      },
    );
    if (result.ok) await clearAuthSession();
    return result;
  });

export const amAudit = createServerFn({ method: "GET" }).handler(async () => {
  const am = await currentAmAccount();
  if (!am) return { ok: false as const, error: GENERIC };
  const rpc = serviceRpc();
  if (!rpc) return { ok: false as const, error: GENERIC };
  const { data, error } = await rpc("list_admin_audit_for_actor", {
    p_kind: "area_manager",
    p_actor_id: am.id,
  });
  if (error) return { ok: false as const, error: GENERIC };
  return { ok: true as const, entries: (data as AuditRow[]) ?? [] };
});

// --- Super Admin: AM administration -----------------------------------------

export const saAreaManagers = createServerFn({ method: "GET" }).handler(async () => {
  await requireSuperAdmin();
  const client = getServiceClient();
  if (!client) return { ok: false as const, error: GENERIC };
  const { data, error } = await client
    .from("area_manager_accounts")
    .select(
      "id, staff_id, full_name, status, created_at, area_manager_assignments(restaurant_id, removed_at)",
    )
    .order("created_at", { ascending: false });
  if (error) return { ok: false as const, error: GENERIC };
  return { ok: true as const, managers: (data as unknown as AreaManagerRow[]) ?? [] };
});

export const saCreateAreaManager = createServerFn({ method: "POST" })
  .validator(
    z.object({
      staffId: z.string(),
      fullName: z.string().trim().min(1).max(80),
      password: z.string(),
    }),
  )
  .handler(async ({ data }): Promise<{ ok: boolean; code?: string; id?: string }> => {
    const session = await requireSuperAdmin();
    const actorId = session.data.superAdminAccountId;
    if (!actorId) return { ok: false, code: "INDIVIDUAL_REQUIRED" };
    const staffId = normalizeStaffId(data.staffId);
    if (!staffIdIsValid(staffId)) return { ok: false, code: "STAFF_ID_INVALID" };
    if (!staffPasswordIsValid(data.password)) return { ok: false, code: "WEAK_PASSWORD" };
    const rpc = serviceRpc();
    if (!rpc) return { ok: false, code: "UNAVAILABLE" };
    const passwordHash = await hashManagerPassword(data.password);
    const { data: id, error } = await rpc("create_area_manager", {
      p_actor_id: actorId,
      p_staff_id: staffId,
      p_full_name: data.fullName,
      p_password_hash: passwordHash,
    });
    if (error) return { ok: false, code: error.message };
    return { ok: true, id: typeof id === "string" ? id : undefined };
  });

export const saSetAreaManagerStatus = createServerFn({ method: "POST" })
  .validator(z.object({ areaManagerId: z.string().uuid(), status: z.enum(["aktif", "nonaktif"]) }))
  .handler(async ({ data }): Promise<{ ok: boolean; code?: string }> => {
    const session = await requireSuperAdmin();
    const actorId = session.data.superAdminAccountId;
    if (!actorId) return { ok: false, code: "INDIVIDUAL_REQUIRED" };
    const rpc = serviceRpc();
    if (!rpc) return { ok: false, code: "UNAVAILABLE" };
    const { error } = await rpc("set_area_manager_status", {
      p_actor_id: actorId,
      p_target_id: data.areaManagerId,
      p_new_status: data.status,
    });
    if (error?.message === "LAST_ACTIVE_AREA_MANAGER") {
      return { ok: false, code: "LAST_ACTIVE_AREA_MANAGER" };
    }
    return error ? { ok: false, code: "UNAVAILABLE" } : { ok: true };
  });

export const saAssignAreaManager = createServerFn({ method: "POST" })
  .validator(z.object({ areaManagerId: z.string().uuid(), restaurantId: z.string().uuid() }))
  .handler(async ({ data }): Promise<{ ok: boolean; code?: string }> => {
    const session = await requireSuperAdmin();
    const actorId = session.data.superAdminAccountId;
    if (!actorId) return { ok: false, code: "INDIVIDUAL_REQUIRED" };
    const rpc = serviceRpc();
    if (!rpc) return { ok: false, code: "UNAVAILABLE" };
    const { error } = await rpc("assign_area_manager", {
      p_actor_id: actorId,
      p_am_id: data.areaManagerId,
      p_restaurant_id: data.restaurantId,
    });
    return error ? { ok: false, code: error.message } : { ok: true };
  });

export const saRevokeAreaManagerAssignment = createServerFn({ method: "POST" })
  .validator(z.object({ areaManagerId: z.string().uuid(), restaurantId: z.string().uuid() }))
  .handler(async ({ data }): Promise<{ ok: boolean; code?: string }> => {
    const session = await requireSuperAdmin();
    const actorId = session.data.superAdminAccountId;
    if (!actorId) return { ok: false, code: "INDIVIDUAL_REQUIRED" };
    const rpc = serviceRpc();
    if (!rpc) return { ok: false, code: "UNAVAILABLE" };
    const { error } = await rpc("revoke_area_manager_assignment", {
      p_actor_id: actorId,
      p_am_id: data.areaManagerId,
      p_restaurant_id: data.restaurantId,
    });
    if (error?.message === "LAST_ACTIVE_AREA_MANAGER") {
      return { ok: false, code: "LAST_ACTIVE_AREA_MANAGER" };
    }
    return error ? { ok: false, code: "UNAVAILABLE" } : { ok: true };
  });

export const saRestaurantsWithoutAm = createServerFn({ method: "GET" }).handler(async () => {
  await requireSuperAdmin();
  const client = getServiceClient();
  if (!client) return { ok: false as const, error: GENERIC };
  const { data, error } = await client.rpc("list_restaurants_without_active_am");
  if (error) return { ok: false as const, error: GENERIC };
  return { ok: true as const, restaurants: (data as RestaurantWithoutAmRow[]) ?? [] };
});

export const saPendingAmResets = createServerFn({ method: "GET" }).handler(async () => {
  await requireSuperAdmin();
  const rpc = serviceRpc();
  if (!rpc) return { ok: false as const, error: GENERIC };
  const { data, error } = await rpc("list_pending_am_resets", {});
  if (error) return { ok: false as const, error: GENERIC };
  return { ok: true as const, requests: (data as AmPendingOwnResetRow[]) ?? [] };
});

export const saDecideAmReset = createServerFn({ method: "POST" })
  .validator(amDecideResetInput)
  .handler(async ({ data }): Promise<{ ok: boolean; code?: string }> => {
    const session = await requireSuperAdmin();
    const actorId = session.data.superAdminAccountId;
    if (!actorId) return { ok: false, code: "INDIVIDUAL_REQUIRED" };
    const rpc = serviceRpc();
    if (!rpc) return { ok: false, code: "UNAVAILABLE" };
    const { data: result, error } = await rpc("decide_am_reset", {
      p_decider_id: actorId,
      p_request_id: data.requestId,
      p_decision: data.decision,
    });
    if (error) return { ok: false, code: error.message };
    return result === true ? { ok: true } : { ok: false, code: "ALREADY_DECIDED" };
  });

export const saAdminAudit = createServerFn({ method: "GET" }).handler(async () => {
  const session = await requireSuperAdmin();
  const accountId = session.data.superAdminAccountId;
  if (!accountId) return { ok: false as const, error: GENERIC };
  const rpc = serviceRpc();
  if (!rpc) return { ok: false as const, error: GENERIC };
  const { data, error } = await rpc("list_admin_audit_for_actor", {
    p_kind: "super_admin",
    p_actor_id: accountId,
  });
  if (error) return { ok: false as const, error: GENERIC };
  return { ok: true as const, entries: (data as AuditRow[]) ?? [] };
});

export { writeAdminAudit };

// --- session status (AM dashboard loader) -----------------------------------

export const getAmStatus = createServerFn({ method: "GET" }).handler(async () => {
  const { getAuthSession } = await import("./auth.server");
  const session = await getAuthSession();
  if (
    !session.data.areaManagerAccountId ||
    !session.data.areaManagerSessionToken ||
    (await currentAmAccount()) === null
  ) {
    return { authenticated: false as const };
  }
  return { authenticated: true as const };
});

export const amLogout = createServerFn({ method: "POST" }).handler(async () => {
  await clearAuthSession();
  return { ok: true };
});
