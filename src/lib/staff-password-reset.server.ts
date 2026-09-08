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

export const submitManagerResetRequest = createServerFn({ method: "POST" })
  .validator(submitSchema)
  .handler(async ({ data }): Promise<SubmitResetResult> => {
    if (!staffPasswordIsValid(data.newPassword)) return { ok: false, message: GENERIC };
    const client = getServiceClient();
    if (!client) return { ok: false, message: GENERIC };
    const { reserveOwnerLoginAttempt, completeOwnerLoginAttempt } =
      await import("./owner-login-rate-limit.server");
    const reservationId = await reserveOwnerLoginAttempt(data.clientKey);
    if (!reservationId) return { ok: false, message: GENERIC };
    const candidateHash = await hashManagerPassword(data.newPassword);
    const { data: result } = await client.rpc("submit_manager_reset_request", {
      p_staff_id: normalizeStaffId(data.staffId),
      p_candidate_hash: candidateHash,
    });
    await completeOwnerLoginAttempt(reservationId, true);
    // Generic success regardless of whether the account exists or a request
    // is already pending — no enumeration, no duplicate-pending oracle.
    void result;
    return { ok: true };
  });

export const submitAmResetRequest = createServerFn({ method: "POST" })
  .validator(submitSchema)
  .handler(async ({ data }): Promise<SubmitResetResult> => {
    if (!staffPasswordIsValid(data.newPassword)) return { ok: false, message: GENERIC };
    const client = getServiceClient();
    if (!client) return { ok: false, message: GENERIC };
    const { reserveOwnerLoginAttempt, completeOwnerLoginAttempt } =
      await import("./owner-login-rate-limit.server");
    const reservationId = await reserveOwnerLoginAttempt(data.clientKey);
    if (!reservationId) return { ok: false, message: GENERIC };
    const candidateHash = await hashManagerPassword(data.newPassword);
    const { data: result } = await client.rpc("submit_am_reset_request", {
      p_staff_id: normalizeStaffId(data.staffId),
      p_candidate_hash: candidateHash,
    });
    await completeOwnerLoginAttempt(reservationId, true);
    void result;
    return { ok: true };
  });
