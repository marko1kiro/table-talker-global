// Shared staff login for Manager + Area Manager (one page, ID + password).
// Role is derived authoritatively from the DB, never from the client. The
// rate-limit reservation happens BEFORE any password hashing so attackers
// cannot burn scrypt CPU without passing the bucket gate. Failure responses
// are generic (no account enumeration).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { updateAuthSession } from "./auth.server";
import { loginManagerCore } from "./manager-auth.server";
import { verifyManagerPassword } from "./manager-password.server";
import { getServiceClient } from "./remote-audio.server";
import { normalizeStaffId, GENERIC_AUTH_FAILURE } from "./staff-identity.server";

const GENERIC = GENERIC_AUTH_FAILURE;

export const loginStaffInputSchema = z.object({
  staffId: z.string().min(1).max(64),
  password: z.string().min(1).max(200),
  clientKey: z.string().min(16).max(200),
});

export type LoginStaffResult =
  | {
      ok: true;
      role: "manager";
      managerToken: string;
      idManager: string;
      fullName: string;
      restaurantId: string;
      restaurantDisplayName: string;
      restaurantCode: string;
      mustRemindPassword: boolean;
    }
  | {
      ok: true;
      role: "area_manager";
      fullName: string;
      staffId: string;
      mustRemindPassword: boolean;
    }
  | { ok: false; message: string };

export const loginStaff = createServerFn({ method: "POST" })
  .validator(loginStaffInputSchema)
  .handler(async ({ data }): Promise<LoginStaffResult> => {
    const client = getServiceClient();
    if (!client) return { ok: false, message: GENERIC };

    const { reserveOwnerLoginAttempt, completeOwnerLoginAttempt } =
      await import("./owner-login-rate-limit.server");
    const reservationId = await reserveOwnerLoginAttempt(data.clientKey);
    if (!reservationId) return { ok: false, message: GENERIC };

    const staffId = normalizeStaffId(data.staffId);
    const report = (valid: boolean) => completeOwnerLoginAttempt(reservationId, valid);

    // 1) Manager namespace first (existing bearer-token dashboard model).
    const managerResult = await loginManagerCore(
      { idManager: staffId, password: data.password },
      { rpc: async (fn, params) => client.rpc(fn, params), verify: verifyManagerPassword },
    ).catch(() => null);
    await report(managerResult?.ok === true);
    if (managerResult?.ok) {
      const { data: extra, error } = await client
        .from("manager_accounts")
        .select("id, password_changed_at")
        .eq("id_manager", staffId)
        .single();
      const mustRemindPassword =
        error || !extra
          ? true
          : (extra as { password_changed_at: string | null }).password_changed_at === null;
      return {
        ok: true,
        role: "manager",
        managerToken: managerResult.managerToken,
        idManager: managerResult.idManager,
        fullName: managerResult.fullName,
        restaurantId: managerResult.restaurantId,
        restaurantDisplayName: managerResult.restaurantDisplayName,
        restaurantCode: managerResult.restaurantCode,
        mustRemindPassword,
      };
    }

    // 2) Area Manager namespace (cookie session backed by staff_sessions).
    const { data: cred, error: amError } = await client.rpc("get_area_manager_credential", {
      p_staff_id: staffId,
    });
    const am = cred as {
      id: string;
      password_hash: string | null;
      status: string;
      full_name: string;
      staff_id: string;
      password_changed_at: string | null;
    } | null;
    let amValid = false;
    if (!amError && am && typeof am === "object" && am.status === "aktif" && am.password_hash) {
      amValid = await verifyManagerPassword(data.password, am.password_hash).catch(() => false);
    }
    await report(amValid);
    if (!amValid || !am) return { ok: false, message: GENERIC };

    const { data: token, error: sessionError } = await client.rpc("create_staff_session", {
      p_kind: "area_manager",
      p_account_id: am.id,
    });
    if (sessionError || typeof token !== "string" || !token) {
      return { ok: false, message: GENERIC };
    }
    await updateAuthSession({
      areaManagerAccountId: am.id,
      areaManagerSessionToken: token,
    });
    return {
      ok: true,
      role: "area_manager",
      fullName: am.full_name,
      staffId: am.staff_id,
      mustRemindPassword: am.password_changed_at === null,
    };
  });
