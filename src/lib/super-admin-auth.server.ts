// Individual Super Admin account flows: bootstrap cutover, invites,
// self-service password change, lifecycle, and email recovery. All privileged
// paths re-derive authority from the DB session/account; public paths are
// rate-limited and generic. Email is fail-closed when no transport is
// configured. Passwords/tokens are never logged or audited.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createHash } from "node:crypto";
import {
  clearAuthSession,
  getAuthSession,
  requireSuperAdmin,
  updateAuthSession,
} from "./auth.server";
import { writeAdminAudit } from "./admin-audit.server";
import { verifyManagerPassword, hashManagerPassword } from "./manager-password.server";
import { getServiceClient } from "./remote-audio.server";
import { emailTransportConfigured, sendStaffEmail } from "./staff-email.server";
import {
  emailIsValid,
  normalizeEmail,
  normalizeStaffId,
  staffIdIsValid,
  staffPasswordIsValid,
  GENERIC_AUTH_FAILURE,
} from "./staff-identity.server";

const GENERIC = GENERIC_AUTH_FAILURE;
export const INVITE_TTL_HOURS = 24;

type RpcCaller = (
  fn: string,
  params: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

// --- bootstrap -------------------------------------------------------------

export type BootstrapState = { open: boolean; individualCount: number; activeCount: number };

export async function readBootstrapStateCore(rpc: RpcCaller): Promise<BootstrapState | null> {
  try {
    const { data, error } = await rpc("bootstrap_super_admin_state", {});
    if (error || typeof data !== "object" || data === null) return null;
    const raw = data as { open?: unknown; individual_count?: unknown; active_count?: unknown };
    return {
      open: raw.open === true,
      individualCount: typeof raw.individual_count === "number" ? raw.individual_count : 0,
      activeCount: typeof raw.active_count === "number" ? raw.active_count : 0,
    };
  } catch {
    return null;
  }
}

export const getBootstrapState = createServerFn({ method: "GET" }).handler(
  async (): Promise<BootstrapState | { ok: false }> => {
    const client = getServiceClient();
    if (!client) return { ok: false };
    const state = await readBootstrapStateCore(async (fn, params) => client.rpc(fn, params));
    return state ?? { ok: false };
  },
);

export const bootstrapCreateInputSchema = z.object({
  staffId: z.string(),
  fullName: z.string().trim().min(1).max(80),
  email: z.string(),
});

/**
 * Legacy (shared-password) session creates the FIRST individual Super Admin.
 * Fail-closed: nothing is persisted unless the email transport is available,
 * because the account only becomes usable after the emailed verification.
 */
export const bootstrapCreateSuperAdmin = createServerFn({ method: "POST" })
  .validator(bootstrapCreateInputSchema)
  .handler(async ({ data }): Promise<{ ok: boolean; code?: string }> => {
    await requireSuperAdmin();
    const staffId = normalizeStaffId(data.staffId);
    const email = normalizeEmail(data.email);
    if (!staffIdIsValid(staffId)) return { ok: false, code: "STAFF_ID_INVALID" };
    if (!emailIsValid(email)) return { ok: false, code: "EMAIL_INVALID" };
    if (!emailTransportConfigured()) return { ok: false, code: "EMAIL_UNAVAILABLE" };

    const client = getServiceClient();
    if (!client) return { ok: false, code: "UNAVAILABLE" };
    const token = createHash("sha256")
      .update(`${staffId}:${email}:${Date.now()}:${Math.random()}`)
      .digest("hex");
    const verifyToken = createHash("sha256").update(`${token}:verify`).digest("hex");
    const { data: accountId, error } = await client.rpc("bootstrap_create_super_admin", {
      p_staff_id: staffId,
      p_full_name: data.fullName,
      p_email: email,
      p_verify_token_hash: verifyToken,
    });
    if (error || typeof accountId !== "string") {
      return { ok: false, code: error?.message ?? "UNAVAILABLE" };
    }
    const sent = await sendStaffEmail(
      email,
      "Aktivasi akun Super Admin Lihat Meja",
      `Token aktivasi (berlaku 24 jam): ${token}`,
    );
    if (!sent.ok) {
      // Fail closed: cancel the invite so no half-created account lingers.
      try {
        await client.rpc("cancel_super_admin_invite", {
          p_super_admin_id: accountId,
          p_actor_id: accountId,
        });
      } catch {
        // best-effort cleanup; audit below still records the failure
      }
      await writeAdminAudit({
        actorKind: "legacy_bootstrap",
        action: "super_admin.bootstrap_email_failed",
        targetKind: "super_admin",
        targetId: accountId,
        result: "failed",
        reason: "email transport unavailable",
      });
      return { ok: false, code: sent.code };
    }
    await writeAdminAudit({
      actorKind: "legacy_bootstrap",
      action: "super_admin.bootstrap_email_sent",
      targetKind: "super_admin",
      targetId: accountId,
    });
    return { ok: true };
  });

export const acceptInviteInputSchema = z.object({
  staffId: z.string(),
  token: z.string().min(16).max(200),
  password: z.string(),
  clientKey: z.string().min(16).max(200),
});

/** Public: accepts an invite / bootstrap verification, atomically. */
export const acceptSuperAdminInvite = createServerFn({ method: "POST" })
  .validator(acceptInviteInputSchema)
  .handler(async ({ data }): Promise<{ ok: boolean; code?: string }> => {
    const staffId = normalizeStaffId(data.staffId);
    if (!staffIdIsValid(staffId) || !staffPasswordIsValid(data.password)) {
      return { ok: false, code: "INVALID_INVITATION" };
    }
    const client = getServiceClient();
    if (!client) return { ok: false, code: "UNAVAILABLE" };
    const { reserveOwnerLoginAttempt, completeOwnerLoginAttempt } =
      await import("./owner-login-rate-limit.server");
    const reservationId = await reserveOwnerLoginAttempt(data.clientKey);
    if (!reservationId) return { ok: false, code: "RATE_LIMITED" };
    const passwordHash = await hashManagerPassword(data.password);
    const { error } = await client.rpc("accept_super_admin_invite", {
      p_staff_id: staffId,
      p_token: data.token,
      p_password_hash: passwordHash,
    });
    await completeOwnerLoginAttempt(reservationId, !error);
    if (error) {
      return {
        ok: false,
        code: error.message === "INVITATION_EXPIRED" ? "INVITATION_EXPIRED" : "INVALID_INVITATION",
      };
    }
    return { ok: true };
  });

// --- invites (Super Admin additional) --------------------------------------

export const inviteCreateInputSchema = z.object({
  staffId: z.string(),
  fullName: z.string().trim().min(1).max(80),
  email: z.string(),
});

export const inviteSuperAdmin = createServerFn({ method: "POST" })
  .validator(inviteCreateInputSchema)
  .handler(async ({ data }): Promise<{ ok: boolean; code?: string }> => {
    const session = await requireSuperAdmin();
    const actorId = session.data.superAdminAccountId;
    if (!actorId) return { ok: false, code: "INDIVIDUAL_REQUIRED" };
    const staffId = normalizeStaffId(data.staffId);
    const email = normalizeEmail(data.email);
    if (!staffIdIsValid(staffId)) return { ok: false, code: "STAFF_ID_INVALID" };
    if (!emailIsValid(email)) return { ok: false, code: "EMAIL_INVALID" };
    if (!emailTransportConfigured()) return { ok: false, code: "EMAIL_UNAVAILABLE" };

    const client = getServiceClient();
    if (!client) return { ok: false, code: "UNAVAILABLE" };
    const token = createHash("sha256")
      .update(`${staffId}:${email}:${Date.now()}:${Math.random()}`)
      .digest("hex");
    const { data: invitedId, error } = await client.rpc("create_super_admin_invite", {
      p_staff_id: staffId,
      p_full_name: data.fullName,
      p_email: email,
      p_invitation_token_hash: sha256Hex(token),
      p_creator_id: actorId,
    });
    if (error || typeof invitedId !== "string") {
      return { ok: false, code: error?.message ?? "UNAVAILABLE" };
    }
    const sent = await sendStaffEmail(
      email,
      "Undangan akun Super Admin Lihat Meja",
      `Token undangan (berlaku 24 jam): ${token}`,
    );
    if (!sent.ok) {
      try {
        await client.rpc("cancel_super_admin_invite", {
          p_super_admin_id: invitedId,
          p_actor_id: actorId,
        });
      } catch {
        // best-effort cleanup
      }
      return { ok: false, code: sent.code };
    }
    return { ok: true };
  });

export const inviteResendInputSchema = z.object({ superAdminId: z.string().uuid() });

export const resendSuperAdminInvite = createServerFn({ method: "POST" })
  .validator(inviteResendInputSchema)
  .handler(async ({ data }): Promise<{ ok: boolean; code?: string }> => {
    const session = await requireSuperAdmin();
    const actorId = session.data.superAdminAccountId;
    if (!actorId) return { ok: false, code: "INDIVIDUAL_REQUIRED" };
    if (!emailTransportConfigured()) return { ok: false, code: "EMAIL_UNAVAILABLE" };
    const client = getServiceClient();
    if (!client) return { ok: false, code: "UNAVAILABLE" };

    const { data: target, error: targetError } = await client
      .from("super_admin_accounts")
      .select("staff_id, email, status")
      .eq("id", data.superAdminId)
      .single();
    const t = target as { staff_id: string; email: string; status: string } | null;
    if (targetError || !t || t.status !== "pending_activation") {
      return { ok: false, code: "NOT_PENDING" };
    }
    const token = createHash("sha256")
      .update(`${t.staff_id}:${t.email}:${Date.now()}:${Math.random()}`)
      .digest("hex");
    const { error } = await client.rpc("resend_super_admin_invite", {
      p_super_admin_id: data.superAdminId,
      p_new_token_hash: sha256Hex(token),
      p_actor_id: actorId,
    });
    if (error) return { ok: false, code: error.message };
    const sent = await sendStaffEmail(
      t.email,
      "Undangan akun Super Admin Lihat Meja",
      `Token undangan baru (berlaku 24 jam): ${token}`,
    );
    return sent.ok ? { ok: true } : { ok: false, code: sent.code };
  });

export const inviteCancelInputSchema = z.object({ superAdminId: z.string().uuid() });

export const cancelSuperAdminInvite = createServerFn({ method: "POST" })
  .validator(inviteCancelInputSchema)
  .handler(async ({ data }): Promise<{ ok: boolean; code?: string }> => {
    const session = await requireSuperAdmin();
    const actorId = session.data.superAdminAccountId;
    if (!actorId) return { ok: false, code: "INDIVIDUAL_REQUIRED" };
    const client = getServiceClient();
    if (!client) return { ok: false, code: "UNAVAILABLE" };
    const { error } = await client.rpc("cancel_super_admin_invite", {
      p_super_admin_id: data.superAdminId,
      p_actor_id: actorId,
    });
    return error ? { ok: false, code: error.message } : { ok: true };
  });

// --- lifecycle -------------------------------------------------------------

export const saStatusInputSchema = z.object({
  superAdminId: z.string().uuid(),
  status: z.enum(["aktif", "nonaktif"]),
});

export const setSuperAdminStatus = createServerFn({ method: "POST" })
  .validator(saStatusInputSchema)
  .handler(async ({ data }): Promise<{ ok: boolean; code?: string }> => {
    const session = await requireSuperAdmin();
    const actorId = session.data.superAdminAccountId;
    if (!actorId) return { ok: false, code: "INDIVIDUAL_REQUIRED" };
    const client = getServiceClient();
    if (!client) return { ok: false, code: "UNAVAILABLE" };
    const { error } = await client.rpc("set_super_admin_status", {
      p_actor_id: actorId,
      p_target_id: data.superAdminId,
      p_new_status: data.status,
    });
    if (error?.message === "LAST_ACTIVE_SUPER_ADMIN") {
      return { ok: false, code: "LAST_ACTIVE_SUPER_ADMIN" };
    }
    return error ? { ok: false, code: "UNAVAILABLE" } : { ok: true };
  });

export const changePasswordInputSchema = z.object({
  oldPassword: z.string().min(1),
  newPassword: z.string(),
});

export async function changeStaffPasswordCore(
  kind: "super_admin" | "area_manager" | "manager",
  accountId: string,
  oldPassword: string,
  newPassword: string,
  deps: { rpc: RpcCaller; verify?: typeof verifyManagerPassword },
): Promise<{ ok: boolean; code?: string }> {
  if (!staffPasswordIsValid(newPassword)) return { ok: false, code: "WEAK_PASSWORD" };
  const credentialFn =
    kind === "super_admin"
      ? "get_super_admin_credential_by_id"
      : kind === "area_manager"
        ? "get_area_manager_credential_by_id"
        : "get_manager_credential_by_id";
  const { data: cred, error } = await deps.rpc(credentialFn, { p_account_id: accountId });
  if (error || !cred || typeof cred !== "object") {
    return { ok: false, code: "INVALID_CREDENTIALS" };
  }
  const c = cred as { password_hash: string | null; status: string };
  if (c.status !== "aktif" || !c.password_hash) return { ok: false, code: "INVALID_CREDENTIALS" };
  const verify = deps.verify ?? verifyManagerPassword;
  if (!(await verify(oldPassword, c.password_hash))) {
    return { ok: false, code: "INVALID_CREDENTIALS" };
  }
  const passwordHash = await hashManagerPassword(newPassword);
  const { error: setErr } = await deps.rpc("set_staff_password", {
    p_kind: kind,
    p_account_id: accountId,
    p_password_hash: passwordHash,
  });
  if (setErr) return { ok: false, code: "UNAVAILABLE" };
  return { ok: true };
}

export const changeSuperAdminPassword = createServerFn({ method: "POST" })
  .validator(changePasswordInputSchema)
  .handler(async ({ data }): Promise<{ ok: boolean; code?: string }> => {
    const session = await requireSuperAdmin();
    const accountId = session.data.superAdminAccountId;
    if (!accountId) return { ok: false, code: "INDIVIDUAL_REQUIRED" };
    const client = getServiceClient();
    if (!client) return { ok: false, code: "UNAVAILABLE" };
    const result = await changeStaffPasswordCore(
      "super_admin",
      accountId,
      data.oldPassword,
      data.newPassword,
      { rpc: async (fn, params) => client.rpc(fn, params) },
    );
    if (result.ok) await clearAuthSession();
    return result;
  });

// --- recovery --------------------------------------------------------------

export const recoveryRequestInputSchema = z.object({ email: z.string() });

/**
 * Public: always responds generically. Fail-closed — when the email transport
 * is unavailable no token is created at all and the attempt is audited.
 */
export const requestSuperAdminRecovery = createServerFn({ method: "POST" })
  .validator(recoveryRequestInputSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const client = getServiceClient();
    if (!client) return { ok: true };
    const email = normalizeEmail(data.email);
    const { reserveOwnerLoginAttempt, completeOwnerLoginAttempt } =
      await import("./owner-login-rate-limit.server");
    const reservationId = await reserveOwnerLoginAttempt(`recovery:${email}:${Date.now() % 1000}`);
    if (reservationId) await completeOwnerLoginAttempt(reservationId, true);
    if (!emailIsValid(email) || !emailTransportConfigured()) {
      await writeAdminAudit({
        actorKind: "system",
        action: "super_admin.recovery_request",
        result: "failed",
        reason: emailTransportConfigured() ? "invalid email" : "email transport unavailable",
      });
      return { ok: true };
    }
    const { data: row } = await client
      .from("super_admin_accounts")
      .select("id")
      .eq("email", email)
      .eq("status", "aktif")
      .single();
    const sa = row as { id: string } | null;
    if (!sa) {
      await writeAdminAudit({
        actorKind: "system",
        action: "super_admin.recovery_request",
        result: "failed",
        reason: "no matching account",
      });
      return { ok: true };
    }
    const token = createHash("sha256")
      .update(`${sa.id}:${Date.now()}:${Math.random()}`)
      .digest("hex");
    const { error } = await client.rpc("create_super_admin_recovery_token", {
      p_super_admin_id: sa.id,
      p_token_hash: sha256Hex(token),
    });
    if (error) return { ok: true };
    const sent = await sendStaffEmail(
      email,
      "Reset password Super Admin Lihat Meja",
      `Token reset (berlaku 30 menit): ${token}`,
    );
    await writeAdminAudit({
      actorKind: "system",
      action: "super_admin.recovery_request",
      targetKind: "super_admin",
      targetId: sa.id,
      result: sent.ok ? "ok" : "failed",
      reason: sent.ok ? null : "email send failed",
    });
    return { ok: true };
  });

export const recoveryConsumeInputSchema = z.object({
  staffId: z.string(),
  token: z.string().min(16).max(200),
  password: z.string(),
  clientKey: z.string().min(16).max(200),
});

export const consumeSuperAdminRecovery = createServerFn({ method: "POST" })
  .validator(recoveryConsumeInputSchema)
  .handler(async ({ data }): Promise<{ ok: boolean; code?: string }> => {
    const staffId = normalizeStaffId(data.staffId);
    if (!staffIdIsValid(staffId) || !staffPasswordIsValid(data.password)) {
      return { ok: false, code: "INVALID_TOKEN" };
    }
    const client = getServiceClient();
    if (!client) return { ok: false, code: "UNAVAILABLE" };
    const { reserveOwnerLoginAttempt, completeOwnerLoginAttempt } =
      await import("./owner-login-rate-limit.server");
    const reservationId = await reserveOwnerLoginAttempt(data.clientKey);
    if (!reservationId) return { ok: false, code: "RATE_LIMITED" };
    const { data: sa } = await client
      .from("super_admin_accounts")
      .select("id")
      .eq("staff_id", staffId)
      .eq("status", "aktif")
      .single();
    const account = sa as { id: string } | null;
    if (!account) {
      await completeOwnerLoginAttempt(reservationId, false);
      return { ok: false, code: "INVALID_TOKEN" };
    }
    const passwordHash = await hashManagerPassword(data.password);
    const { error } = await client.rpc("consume_super_admin_recovery_token", {
      p_super_admin_id: account.id,
      p_token: data.token,
      p_password_hash: passwordHash,
    });
    await completeOwnerLoginAttempt(reservationId, !error);
    return error ? { ok: false, code: "INVALID_TOKEN" } : { ok: true };
  });

// --- session helpers -------------------------------------------------------

export async function getCurrentSuperAdminAccount(): Promise<{
  id: string;
  staffId: string;
} | null> {
  const session = await getAuthSession();
  if (session.data.superAdmin !== true || !session.data.superAdminAccountId) return null;
  const client = getServiceClient();
  if (!client) return null;
  const { data } = await client
    .from("super_admin_accounts")
    .select("id, staff_id")
    .eq("id", session.data.superAdminAccountId)
    .eq("status", "aktif")
    .single();
  const row = data as { id: string; staff_id: string } | null;
  return row ? { id: row.id, staffId: row.staff_id } : null;
}

export const logoutSuperAdmin = createServerFn({ method: "POST" }).handler(async () => {
  await clearAuthSession();
  return { ok: true };
});

export const getSuperAdminProfile = createServerFn({ method: "GET" }).handler(async () => {
  const account = await getCurrentSuperAdminAccount();
  if (!account) return { individual: false as const };
  return { individual: true as const, staffId: account.staffId };
});

export type SuperAdminRow = {
  id: string;
  staffId: string;
  fullName: string;
  status: string;
  createdAt: string;
};

export const getSuperAdmins = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ ok: true; accounts: SuperAdminRow[] } | { ok: false; error: string }> => {
    await requireSuperAdmin();
    const client = getServiceClient();
    if (!client) return { ok: false, error: "Tidak dapat memuat data." };
    const { data, error } = await client
      .from("super_admin_accounts")
      .select("id, staff_id, full_name, status, created_at")
      .neq("status", "cancelled")
      .order("created_at", { ascending: false });
    if (error) return { ok: false, error: "Tidak dapat memuat data." };
    const accounts = (data ?? []).map((row) => {
      const r = row as Record<string, unknown>;
      return {
        id: String(r.id),
        staffId: String(r.staff_id),
        fullName: String(r.full_name),
        status: String(r.status),
        createdAt: String(r.created_at),
      };
    });
    return { ok: true, accounts };
  },
);
