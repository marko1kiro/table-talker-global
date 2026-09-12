// Public password-reset request submission for Manager and Area Manager.
// The candidate password is hashed (scrypt) BEFORE anything is stored — the
// approver can never read it back. Responses are always generic and the
// rate-limit reservation happens before hashing to prevent CPU exhaustion
// and ID enumeration.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getServiceClient } from "./remote-audio.server";
import { hashManagerPassword } from "./manager-password.server";
import {
  normalizeStaffId,
  staffPasswordIsValid,
  GENERIC_AUTH_FAILURE,
} from "./staff-identity.server";

const GENERIC = GENERIC_AUTH_FAILURE;

export const submitResetRequestInputSchema = z.object({
  staffId: z.string().min(1).max(64),
  newPassword: z.string(),
  clientKey: z.string().min(16).max(200),
  attemptKey: z.string().min(16).max(200),
});

export type SubmitResetResult = { ok: true } | { ok: false; message: string };
type ResetRequestKind = "manager" | "area_manager";
type ResetAttemptVerdict = "SUCCEEDED" | "FAILED" | "PENDING" | "UNKNOWN";
type ResetRequestInput = z.infer<typeof submitResetRequestInputSchema>;

/**
 * Hash and submit one reserved attempt. The database owns the terminal limiter
 * transition in the same transaction as the reset request and attempt ledger.
 * The only separate completion is the pre-RPC weak-password rejection.
 */
export async function submitResetRequestCore(
  fn: "submit_manager_reset_request" | "submit_am_reset_request",
  data: { staffId: string; newPassword: string; rateLimitReservationId: string },
  deps: {
    rpc: (
      fn: string,
      params: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
    completeFailed: (reservationId: string) => Promise<unknown>;
  },
): Promise<SubmitResetResult> {
  if (!staffPasswordIsValid(data.newPassword)) {
    await deps.completeFailed(data.rateLimitReservationId);
    return { ok: false, message: GENERIC };
  }
  const candidateHash = await hashManagerPassword(data.newPassword);
  const { error } = await deps.rpc(fn, {
    p_staff_id: normalizeStaffId(data.staffId),
    p_candidate_hash: candidateHash,
    p_reservation_id: data.rateLimitReservationId,
  });
  if (error) throw new Error(error.message);
  // Account existence, duplicate-pending, and authoritative outcome remain
  // deliberately indistinguishable at the public boundary.
  return { ok: true };
}

/**
 * Reuse a live reservation, or reconcile a stable attempt key after either a
 * lost reserve response or an uncertain reset-submit transport response.
 */
export async function submitResetRequestAttemptCore(
  kind: ResetRequestKind,
  data: ResetRequestInput,
  deps: {
    reserve: (clientKey: string, attemptKey: string) => Promise<string | null>;
    reconcile: (attemptKey: string, kind: ResetRequestKind) => Promise<ResetAttemptVerdict>;
    submit: (reservationId: string) => Promise<SubmitResetResult>;
  },
): Promise<SubmitResetResult> {
  const reservationId = await deps.reserve(data.clientKey, data.attemptKey);
  if (reservationId) {
    try {
      return await deps.submit(reservationId);
    } catch {
      const verdict = await deps.reconcile(data.attemptKey, kind);
      if (verdict === "SUCCEEDED" || verdict === "FAILED") return { ok: true };
      return { ok: false, message: GENERIC };
    }
  }

  const verdict = await deps.reconcile(data.attemptKey, kind);
  if (verdict === "SUCCEEDED" || verdict === "FAILED") return { ok: true };
  return { ok: false, message: GENERIC };
}

async function reconcileResetAttempt(
  client: NonNullable<ReturnType<typeof getServiceClient>>,
  attemptKey: string,
  kind: ResetRequestKind,
): Promise<ResetAttemptVerdict> {
  const { data, error } = await client.rpc("reconcile_staff_reset_attempt", {
    p_attempt_key: attemptKey,
    p_request_kind: kind,
  });
  if (error) return "UNKNOWN";
  return data === "SUCCEEDED" || data === "FAILED" || data === "PENDING" ? data : "UNKNOWN";
}

export const submitManagerResetRequest = createServerFn({ method: "POST" })
  .validator(submitResetRequestInputSchema)
  .handler(async ({ data }): Promise<SubmitResetResult> => {
    const client = getServiceClient();
    if (!client) return { ok: false, message: GENERIC };
    const { reserveOwnerLoginAttempt, completeOwnerLoginAttempt } =
      await import("./owner-login-rate-limit.server");
    return submitResetRequestAttemptCore("manager", data, {
      reserve: reserveOwnerLoginAttempt,
      reconcile: (attemptKey, kind) => reconcileResetAttempt(client, attemptKey, kind),
      submit: (reservationId) =>
        submitResetRequestCore(
          "submit_manager_reset_request",
          { ...data, rateLimitReservationId: reservationId },
          {
            rpc: async (fn, params) => client.rpc(fn, params),
            completeFailed: (id) => completeOwnerLoginAttempt(id, false),
          },
        ),
    });
  });

export const submitAmResetRequest = createServerFn({ method: "POST" })
  .validator(submitResetRequestInputSchema)
  .handler(async ({ data }): Promise<SubmitResetResult> => {
    const client = getServiceClient();
    if (!client) return { ok: false, message: GENERIC };
    const { reserveOwnerLoginAttempt, completeOwnerLoginAttempt } =
      await import("./owner-login-rate-limit.server");
    return submitResetRequestAttemptCore("area_manager", data, {
      reserve: reserveOwnerLoginAttempt,
      reconcile: (attemptKey, kind) => reconcileResetAttempt(client, attemptKey, kind),
      submit: (reservationId) =>
        submitResetRequestCore(
          "submit_am_reset_request",
          { ...data, rateLimitReservationId: reservationId },
          {
            rpc: async (fn, params) => client.rpc(fn, params),
            completeFailed: (id) => completeOwnerLoginAttempt(id, false),
          },
        ),
    });
  });
