// Shared staff login for Manager + Area Manager (one page, ID + password).
// Role is derived authoritatively from the DB, never from the client. The
// rate-limit reservation happens BEFORE any password hashing so attackers
// cannot burn scrypt CPU without passing the bucket gate. Failure responses
// are generic (no account enumeration).
//
// Accounting rule (review B12): a reservation is marked SUCCESS only when a
// usable session was actually established. Wrong password, unknown ID,
// inactive account, and session-mint RPC errors are all failures.
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

type RpcCaller = (
  fn: string,
  params: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

export type StaffLoginDeps = {
  rpc: RpcCaller;
  report: (valid: boolean) => Promise<unknown>;
  verify?: (password: string, stored: string) => Promise<boolean>;
  updateSession?: (update: {
    areaManagerAccountId: string;
    areaManagerSessionToken: string;
  }) => Promise<unknown>;
  managerExtras?: (staffId: string) => Promise<{ password_changed_at: string | null } | null>;
};

export async function loginStaffCore(
  rawStaffId: string,
  password: string,
  deps: StaffLoginDeps,
): Promise<LoginStaffResult> {
  const staffId = normalizeStaffId(rawStaffId);

  // 1) Manager namespace first (existing bearer-token dashboard model).
  //    loginManagerCore mints the session internally, so its ok flag already
  //    means "usable session established".
  const managerResult = await loginManagerCore(
    { idManager: staffId, password },
    {
      rpc: deps.rpc,
      verify: deps.verify ?? verifyManagerPassword,
    },
  ).catch(() => null);
  if (managerResult?.ok) {
    await deps.report(true);
    const extras = deps.managerExtras
      ? await deps.managerExtras(staffId)
      : { password_changed_at: "set" };
    const mustRemindPassword = !extras || extras.password_changed_at === null;
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
  const { data: cred, error: amError } = await deps.rpc("get_area_manager_credential", {
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
    amValid = await (deps.verify ?? verifyManagerPassword)(password, am.password_hash).catch(
      () => false,
    );
  }
  if (!amValid || !am) {
    await deps.report(false);
    return { ok: false, message: GENERIC };
  }
  const { data: token, error: sessionError } = await deps.rpc("create_staff_session", {
    p_kind: "area_manager",
    p_account_id: am.id,
  });
  if (sessionError || typeof token !== "string" || !token) {
    // Password was right but no session exists — never count this as success.
    await deps.report(false);
    return { ok: false, message: GENERIC };
  }
  await deps.report(true);
  const updateSession = deps.updateSession ?? ((u) => updateAuthSession(u));
  await updateSession({ areaManagerAccountId: am.id, areaManagerSessionToken: token });
  return {
    ok: true,
    role: "area_manager",
    fullName: am.full_name,
    staffId: am.staff_id,
    mustRemindPassword: am.password_changed_at === null,
  };
}

export const loginStaff = createServerFn({ method: "POST" })
  .validator(loginStaffInputSchema)
  .handler(async ({ data }): Promise<LoginStaffResult> => {
    const client = getServiceClient();
    if (!client) return { ok: false, message: GENERIC };

    const { reserveOwnerLoginAttempt, completeOwnerLoginAttempt } =
      await import("./owner-login-rate-limit.server");
    const reservationId = await reserveOwnerLoginAttempt(data.clientKey);
    if (!reservationId) return { ok: false, message: GENERIC };

    return loginStaffCore(data.staffId, data.password, {
      rpc: async (fn, params) => client.rpc(fn, params),
      report: (valid) => completeOwnerLoginAttempt(reservationId, valid),
      managerExtras: async (staffId) => {
        const { data: extra, error } = await client
          .from("manager_accounts")
          .select("id, password_changed_at")
          .eq("id_manager", staffId)
          .single();
        if (error || !extra) return { password_changed_at: null };
        return extra as { password_changed_at: string | null };
      },
    });
  });
