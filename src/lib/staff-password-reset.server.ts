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

const submitSchema = z.object({
  staffId: z.string().min(1).max(64),
  newPassword: z.string(),
  clientKey: z.string().min(16).max(200),
});

export type SubmitResetResult = { ok: true } | { ok: false; message: string };

/**
 * Testable core: the rate-limit report is injected so "failure must NOT be
 * marked success" (invalid ID, inactive account, duplicate pending, RPC
 * error) is provable. The user-facing response stays generic either way —
 * the accounting difference is invisible to callers.
 */
export async function submitResetRequestCore(
  fn: "submit_manager_reset_request" | "submit_am_reset_request",
  data: { staffId: string; newPassword: string },
  deps: {
    rpc: (
      fn: string,
      params: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
    report: (valid: boolean) => Promise<unknown>;
  },
): Promise<SubmitResetResult> {
  if (!staffPasswordIsValid(data.newPassword)) {
    await deps.report(false);
    return { ok: false, message: GENERIC };
  }
  const candidateHash = await hashManagerPassword(data.newPassword);
  const { data: result, error } = await deps.rpc(fn, {
    p_staff_id: normalizeStaffId(data.staffId),
    p_candidate_hash: candidateHash,
  });
  await deps.report(!error && result === true);
  return { ok: true };
}

export const submitManagerResetRequest = createServerFn({ method: "POST" })
  .validator(submitSchema)
  .handler(async ({ data }): Promise<SubmitResetResult> => {
    const client = getServiceClient();
    if (!client) return { ok: false, message: GENERIC };
    const { reserveOwnerLoginAttempt, completeOwnerLoginAttempt } =
      await import("./owner-login-rate-limit.server");
    const reservationId = await reserveOwnerLoginAttempt(data.clientKey);
    if (!reservationId) return { ok: false, message: GENERIC };
    return submitResetRequestCore("submit_manager_reset_request", data, {
      rpc: async (fn, params) => client.rpc(fn, params),
      report: (valid) => completeOwnerLoginAttempt(reservationId, valid),
    });
  });

export const submitAmResetRequest = createServerFn({ method: "POST" })
  .validator(submitSchema)
  .handler(async ({ data }): Promise<SubmitResetResult> => {
    const client = getServiceClient();
    if (!client) return { ok: false, message: GENERIC };
    const { reserveOwnerLoginAttempt, completeOwnerLoginAttempt } =
      await import("./owner-login-rate-limit.server");
    const reservationId = await reserveOwnerLoginAttempt(data.clientKey);
    if (!reservationId) return { ok: false, message: GENERIC };
    return submitResetRequestCore("submit_am_reset_request", data, {
      rpc: async (fn, params) => client.rpc(fn, params),
      report: (valid) => completeOwnerLoginAttempt(reservationId, valid),
    });
  });
