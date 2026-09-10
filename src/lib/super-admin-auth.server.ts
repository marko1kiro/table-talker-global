// Individual Super Admin account flows: bootstrap cutover, invites,
// self-service password change, lifecycle, and email recovery. All privileged
// paths re-derive authority from the DB session/account; public paths are
// rate-limited and generic. Email is fail-closed when no transport is
// configured. Passwords/tokens are never logged or audited.
//
// Token lifecycle rule (review B6/B14/B15): every invite/bootstrap/resend/
// recovery token is a CSPRNG 256-bit value; the RAW token is emailed exactly
// once inside an HTTPS one-time link, and only its SHA-256 is persisted.
// Sending happens BEFORE persistence, so a provider failure can never leave a
// live-but-uncontrolled token (or a pending account blocking the bootstrap
// gate) behind.
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
import { readRpcVerdict } from "./rpc-contract.server";
import {
  emailTransportConfigured,
  sendStaffEmail,
  staffAcceptLink,
  staffRecoveryLink,
  staffLinkEmailBody,
  type EmailSendResult,
} from "./staff-email.server";
import {
  emailIsValid,
  generateStaffToken,
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
 * Email-first (review A3/B14): the raw token is emailed BEFORE anything is
 * persisted, so a provider failure leaves NO pending account and NO live
 * token behind — the bootstrap gate stays open and retryable.
 */
export type StaffFlowDeps = {
  rpc: RpcCaller;
  sendEmail: (to: string, subject: string, text: string) => Promise<EmailSendResult>;
  linkFor: (staffId: string, rawToken: string) => string;
  audit?: (input: Parameters<typeof writeAdminAudit>[0]) => Promise<unknown>;
};

/**
 * Review B7: an emailed magic link must be absolute and safe. A broken
 * origin configuration (staffAppOrigin throws) aborts the flow with
 * EMAIL_CONFIG_INVALID BEFORE any email is sent and BEFORE any token or
 * account is persisted — no live-but-undeliverable token can exist.
 */
function buildLinkOrThrow(build: () => string): { link: string } | { configError: true } {
  try {
    return { link: build() };
  } catch {
    return { configError: true };
  }
}

export async function bootstrapCreateSuperAdminCore(
  input: { staffId: string; fullName: string; email: string },
  deps: StaffFlowDeps,
): Promise<{ ok: boolean; code?: string }> {
  const rawToken = generateStaffToken();
  const built = buildLinkOrThrow(() => deps.linkFor(input.staffId, rawToken));
  if ("configError" in built) return { ok: false, code: "EMAIL_CONFIG_INVALID" };
  const sent = await deps.sendEmail(
    input.email,
    "Aktivasi akun Super Admin Lihat Meja",
    staffLinkEmailBody(built.link, "berlaku 24 jam dan hanya sekali"),
  );
  if (!sent.ok) {
    await deps.audit?.({
      actorKind: "legacy_bootstrap",
      action: "super_admin.bootstrap_email_failed",
      result: "failed",
      reason: "email send failed",
    });
    return { ok: false, code: sent.code };
  }
  const res = await deps.rpc("bootstrap_create_super_admin", {
    p_staff_id: input.staffId,
    p_full_name: input.fullName,
    p_email: input.email,
    p_verify_token_hash: sha256Hex(rawToken),
  });
  const verdict = readRpcVerdict(res.data, res.error);
  if (!verdict.ok) {
    return { ok: false, code: verdict.code };
  }
  await deps.audit?.({
    actorKind: "legacy_bootstrap",
    action: "super_admin.bootstrap_email_sent",
    targetKind: "super_admin",
    targetId: verdict.id ?? "",
  });
  return { ok: true };
}

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
    return bootstrapCreateSuperAdminCore(
      { staffId, fullName: data.fullName, email },
      {
        rpc: async (fn, params) => client.rpc(fn, params),
        sendEmail: sendStaffEmail,
        linkFor: staffAcceptLink,
        audit: writeAdminAudit,
      },
    );
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
    const res = await client.rpc("accept_super_admin_invite", {
      p_staff_id: staffId,
      p_token: data.token,
      p_password_hash: passwordHash,
    });
    const verdict = readRpcVerdict(res.data, res.error);
    await completeOwnerLoginAttempt(reservationId, verdict.ok);
    if (!verdict.ok) {
      return {
        ok: false,
        code: verdict.code === "INVITATION_EXPIRED" ? "INVITATION_EXPIRED" : "INVALID_INVITATION",
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

export async function inviteSuperAdminCore(
  input: { staffId: string; fullName: string; email: string; creatorId: string },
  deps: StaffFlowDeps,
): Promise<{ ok: boolean; code?: string }> {
  const rawToken = generateStaffToken();
  const built = buildLinkOrThrow(() => deps.linkFor(input.staffId, rawToken));
  if ("configError" in built) return { ok: false, code: "EMAIL_CONFIG_INVALID" };
  const sent = await deps.sendEmail(
    input.email,
    "Undangan akun Super Admin Lihat Meja",
    staffLinkEmailBody(built.link, "berlaku 24 jam dan hanya sekali"),
  );
  if (!sent.ok) {
    return { ok: false, code: sent.code };
  }
  const res = await deps.rpc("create_super_admin_invite", {
    p_staff_id: input.staffId,
    p_full_name: input.fullName,
    p_email: input.email,
    p_invitation_token_hash: sha256Hex(rawToken),
    p_creator_id: input.creatorId,
  });
  const verdict = readRpcVerdict(res.data, res.error);
  return verdict.ok ? { ok: true } : { ok: false, code: verdict.code };
}

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
    return inviteSuperAdminCore(
      { staffId, fullName: data.fullName, email, creatorId: actorId },
      {
        rpc: async (fn, params) => client.rpc(fn, params),
        sendEmail: sendStaffEmail,
        linkFor: staffAcceptLink,
        audit: writeAdminAudit,
      },
    );
  });

export const inviteResendInputSchema = z.object({ superAdminId: z.string().uuid() });

export async function resendSuperAdminInviteCore(
  input: { superAdminId: string; staffId: string; email: string; actorId: string },
  deps: StaffFlowDeps,
): Promise<{ ok: boolean; code?: string }> {
  const rawToken = generateStaffToken();
  // Email-first: on provider failure the PREVIOUS invitation stays the only
  // live token (still deliverable via another resend); no new hash is ever
  // persisted without the email carrying it.
  const built = buildLinkOrThrow(() => deps.linkFor(input.staffId, rawToken));
  if ("configError" in built) return { ok: false, code: "EMAIL_CONFIG_INVALID" };
  const sent = await deps.sendEmail(
    input.email,
    "Undangan akun Super Admin Lihat Meja",
    staffLinkEmailBody(built.link, "berlaku 24 jam dan hanya sekali"),
  );
  if (!sent.ok) {
    return { ok: false, code: sent.code };
  }
  const res = await deps.rpc("resend_super_admin_invite", {
    p_super_admin_id: input.superAdminId,
    p_new_token_hash: sha256Hex(rawToken),
    p_actor_id: input.actorId,
  });
  const verdict = readRpcVerdict(res.data, res.error);
  return verdict.ok ? { ok: true } : { ok: false, code: verdict.code };
}

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
    return resendSuperAdminInviteCore(
      { superAdminId: data.superAdminId, staffId: t.staff_id, email: t.email, actorId },
      {
        rpc: async (fn, params) => client.rpc(fn, params),
        sendEmail: sendStaffEmail,
        linkFor: staffAcceptLink,
        audit: writeAdminAudit,
      },
    );
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
    const res = await client.rpc("cancel_super_admin_invite", {
      p_super_admin_id: data.superAdminId,
      p_actor_id: actorId,
    });
    const verdict = readRpcVerdict(res.data, res.error);
    return verdict.ok ? { ok: true } : { ok: false, code: verdict.code };
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
    const res = await client.rpc("set_super_admin_status", {
      p_actor_id: actorId,
      p_target_id: data.superAdminId,
      p_new_status: data.status,
    });
    const verdict = readRpcVerdict(res.data, res.error);
    return verdict.ok ? { ok: true } : { ok: false, code: verdict.code };
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
  const res = await deps.rpc("set_staff_password", {
    p_kind: kind,
    p_account_id: accountId,
    p_password_hash: passwordHash,
  });
  const verdict = readRpcVerdict(res.data, res.error);
  return verdict.ok ? { ok: true } : { ok: false, code: verdict.code };
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

export async function requestSuperAdminRecoveryCore(
  email: string,
  deps: {
    rpc: RpcCaller;
    sendEmail: (to: string, subject: string, text: string) => Promise<EmailSendResult>;
    linkFor: (staffId: string, rawToken: string) => string;
    lookupAccount: (email: string) => Promise<{ id: string; staffId: string } | null>;
    transportConfigured: () => boolean;
    audit?: (input: Parameters<typeof writeAdminAudit>[0]) => Promise<unknown>;
  },
): Promise<boolean> {
  const auditFailure = async (reason: string) => {
    await deps.audit?.({
      actorKind: "system",
      action: "super_admin.recovery_request",
      result: "failed",
      reason,
    });
  };
  if (!emailIsValid(email)) {
    await auditFailure("invalid email");
    return false;
  }
  if (!deps.transportConfigured()) {
    await auditFailure("email transport unavailable");
    return false;
  }
  const account = await deps.lookupAccount(email);
  if (!account) {
    await auditFailure("no matching account");
    return false;
  }
  const rawToken = generateStaffToken();
  // Email-first: no token row exists unless the email carrying it was sent.
  // A broken origin config (review B7) aborts BEFORE anything is created.
  const built = buildLinkOrThrow(() => deps.linkFor(account.staffId, rawToken));
  if ("configError" in built) {
    await auditFailure("email link origin config invalid");
    return false;
  }
  const sent = await deps.sendEmail(
    email,
    "Reset password Super Admin Lihat Meja",
    staffLinkEmailBody(built.link, "berlaku 30 menit dan hanya sekali"),
  );
  await deps.audit?.({
    actorKind: "system",
    action: "super_admin.recovery_request",
    targetKind: "super_admin",
    targetId: account.id,
    result: sent.ok ? "ok" : "failed",
    reason: sent.ok ? null : "email send failed",
  });
  if (!sent.ok) return false;
  const res = await deps.rpc("create_super_admin_recovery_token", {
    p_super_admin_id: account.id,
    p_token_hash: sha256Hex(rawToken),
  });
  return readRpcVerdict(res.data, res.error).ok;
}

/**
 * Public: always responds generically. The rate-limit bucket is only cleared
 * by a DELIVERED recovery email — invalid email, unknown account, transport
 * failure, provider failure, and RPC errors all count as failures (B12).
 */
export const requestSuperAdminRecovery = createServerFn({ method: "POST" })
  .validator(recoveryRequestInputSchema)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const client = getServiceClient();
    if (!client) return { ok: true };
    const email = normalizeEmail(data.email);
    const { reserveOwnerLoginAttempt, completeOwnerLoginAttempt } =
      await import("./owner-login-rate-limit.server");
    const reservationId = await reserveOwnerLoginAttempt(`recovery:${email}`);
    if (!reservationId) return { ok: true };
    let delivered = false;
    try {
      delivered = await requestSuperAdminRecoveryCore(email, {
        rpc: async (fn, params) => client.rpc(fn, params),
        sendEmail: sendStaffEmail,
        linkFor: staffRecoveryLink,
        transportConfigured: emailTransportConfigured,
        audit: writeAdminAudit,
        lookupAccount: async (normalized) => {
          const { data: row } = await client
            .from("super_admin_accounts")
            .select("id, staff_id")
            .eq("email", normalized)
            .eq("status", "aktif")
            .single();
          const sa = row as { id: string; staff_id: string } | null;
          return sa ? { id: sa.id, staffId: sa.staff_id } : null;
        },
      });
    } finally {
      await completeOwnerLoginAttempt(reservationId, delivered);
    }
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
    const res = await client.rpc("consume_super_admin_recovery_token", {
      p_super_admin_id: account.id,
      p_token: data.token,
      p_password_hash: passwordHash,
    });
    const verdict = readRpcVerdict(res.data, res.error);
    await completeOwnerLoginAttempt(reservationId, verdict.ok);
    return verdict.ok ? { ok: true } : { ok: false, code: "INVALID_TOKEN" };
  });

// --- session helpers -------------------------------------------------------

export async function getCurrentSuperAdminAccount(): Promise<{
  id: string;
  staffId: string;
  fullName: string;
} | null> {
  const session = await getAuthSession();
  if (session.data.superAdmin !== true || !session.data.superAdminAccountId) return null;
  const client = getServiceClient();
  if (!client) return null;
  const { data } = await client
    .from("super_admin_accounts")
    .select("id, staff_id, full_name")
    .eq("id", session.data.superAdminAccountId)
    .eq("status", "aktif")
    .single();
  const row = data as { id: string; staff_id: string; full_name: string } | null;
  return row ? { id: row.id, staffId: row.staff_id, fullName: row.full_name } : null;
}

export const logoutSuperAdmin = createServerFn({ method: "POST" }).handler(async () => {
  await clearAuthSession();
  return { ok: true };
});

export const getSuperAdminProfile = createServerFn({ method: "GET" }).handler(async () => {
  const account = await getCurrentSuperAdminAccount();
  if (!account) return { individual: false as const };
  return { individual: true as const, staffId: account.staffId, fullName: account.fullName };
});

/** Self-service rename for the logged-in individual Super Admin (ID immutable). */
export const updateOwnSuperAdminProfile = createServerFn({ method: "POST" })
  .validator(z.object({ fullName: z.string().trim().min(1).max(80) }))
  .handler(async ({ data }): Promise<{ ok: boolean; code?: string }> => {
    const session = await requireSuperAdmin();
    const accountId = session.data.superAdminAccountId;
    if (!accountId) return { ok: false, code: "INDIVIDUAL_REQUIRED" };
    const client = getServiceClient();
    if (!client) return { ok: false, code: "UNAVAILABLE" };
    const res = await client.rpc("update_staff_profile", {
      p_actor_kind: "super_admin",
      p_actor_id: accountId,
      p_target_kind: "super_admin",
      p_target_id: accountId,
      p_full_name: data.fullName,
    });
    const verdict = readRpcVerdict(res.data, res.error);
    return verdict.ok ? { ok: true } : { ok: false, code: verdict.code };
  });

// --- Super Admin renames other staff profiles (review C13) -------------------

export type RenameStaffProfileInput = {
  actorId: string;
  targetKind: "super_admin" | "area_manager" | "manager";
  targetId: string;
  fullName: string;
};

/**
 * Super Admin renames another staff profile through the authoritative
 * update_staff_profile RPC. The durable jsonb verdict maps 1:1 to the UI
 * code — no error-message parsing, no thrown denial path.
 */
export async function renameStaffProfileCore(
  input: RenameStaffProfileInput,
  deps: { rpc: RpcCaller },
): Promise<{ ok: boolean; code?: string }> {
  const res = await deps.rpc("update_staff_profile", {
    p_actor_kind: "super_admin",
    p_actor_id: input.actorId,
    p_target_kind: input.targetKind,
    p_target_id: input.targetId,
    p_full_name: input.fullName,
  });
  const verdict = readRpcVerdict(res.data, res.error);
  return verdict.ok ? { ok: true } : { ok: false, code: verdict.code };
}

export const saRenameStaffInput = z.object({
  targetKind: z.enum(["super_admin", "area_manager", "manager"]),
  targetId: z.string().uuid(),
  fullName: z.string().trim().min(1).max(80),
});

export const saRenameStaff = createServerFn({ method: "POST" })
  .validator(saRenameStaffInput)
  .handler(async ({ data }): Promise<{ ok: boolean; code?: string }> => {
    const session = await requireSuperAdmin();
    const actorId = session.data.superAdminAccountId;
    if (!actorId) return { ok: false, code: "INDIVIDUAL_REQUIRED" };
    const client = getServiceClient();
    if (!client) return { ok: false, code: "UNAVAILABLE" };
    return renameStaffProfileCore(
      {
        actorId,
        targetKind: data.targetKind,
        targetId: data.targetId,
        fullName: data.fullName,
      },
      { rpc: async (fn, params) => client.rpc(fn, params) },
    );
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
