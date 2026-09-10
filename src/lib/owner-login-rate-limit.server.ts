import { createHmac } from "node:crypto";
import { getRequest } from "@tanstack/react-start/server";
import { getAuthSecret } from "./auth.server";
import { getLoginRequestIp } from "./login-request-ip.server";
import { getServiceClient } from "./remote-audio.server";

type Reservation = { reservation_id: string };

export type OwnerLoginRateLimitBucket = {
  sequence: number;
  lastSuccessSequence: number;
  failures: number;
  windowStartedAt: number;
  blockedUntil: number | null;
};

export function canCompleteOwnerLoginReservation(
  reservation: { consumedAt: number | null; expiresAt: number },
  now: number,
) {
  return reservation.consumedAt === null && reservation.expiresAt > now;
}

export function reserveOwnerLoginSequences(
  client: OwnerLoginRateLimitBucket,
  ip: OwnerLoginRateLimitBucket,
) {
  return {
    client: { ...client, sequence: client.sequence + 1 },
    ip: { ...ip, sequence: ip.sequence + 1 },
    clientSequence: client.sequence + 1,
    ipSequence: ip.sequence + 1,
  };
}

export function applyOwnerLoginAttempt(
  bucket: OwnerLoginRateLimitBucket,
  reservationSequence: number,
  success: boolean,
  now: number,
): OwnerLoginRateLimitBucket {
  if (success) {
    const watermarked = {
      ...bucket,
      lastSuccessSequence: Math.max(bucket.lastSuccessSequence, reservationSequence),
    };
    if (bucket.sequence !== reservationSequence) return watermarked;
    return {
      ...watermarked,
      failures: 0,
      windowStartedAt: now,
      blockedUntil: null,
    };
  }
  if (reservationSequence <= bucket.lastSuccessSequence) return bucket;
  const inWindow = bucket.windowStartedAt > now - 15 * 60 * 1_000;
  const failures = inWindow ? bucket.failures + 1 : 1;
  return {
    ...bucket,
    failures,
    windowStartedAt: inWindow ? bucket.windowStartedAt : now,
    blockedUntil: failures >= 5 ? now + 15 * 60 * 1_000 : bucket.blockedUntil,
  };
}

export function hashOwnerLoginRateLimitBucket(value: string, secret = getAuthSecret()) {
  return createHmac("sha256", secret).update(value).digest("hex");
}

export function getOwnerLoginRateLimitBuckets(
  headers: Headers,
  clientKey: string,
  secret?: string,
) {
  const hash = (value: string) => hashOwnerLoginRateLimitBucket(value, secret);
  return {
    clientKeyHash: hash(`owner-client:${clientKey}`),
    ipKeyHash: hash(`owner-ip:${getLoginRequestIp(headers)}`),
  };
}

/**
 * R6-C: reserve one logical login attempt. `attemptKey` is the idempotency
 * identity: the same UNCONSUMED key returns the SAME reservation (a lost
 * response + retry cannot double-count); a consumed/expired key is dead and
 * a new logical attempt must use a new key. Every key still passes the SAME
 * bucket enforcement — rotation is never a bypass.
 */
export async function reserveOwnerLoginAttempt(
  clientKey: string,
  attemptKey?: string,
): Promise<string | null> {
  const client = getServiceClient();
  if (!client) return null;

  try {
    const { clientKeyHash, ipKeyHash } = getOwnerLoginRateLimitBuckets(
      getRequest().headers,
      clientKey,
    );
    const { data, error } = await client.rpc("reserve_owner_login_attempt", {
      p_client_bucket_hash: clientKeyHash,
      p_ip_bucket_hash: ipKeyHash,
      p_attempt_key: attemptKey ?? null,
    });
    if (error || !data || !Array.isArray(data) || data.length !== 1) return null;
    const reservation = data[0] as Reservation;
    return typeof reservation.reservation_id === "string" ? reservation.reservation_id : null;
  } catch {
    return null;
  }
}

/**
 * R6-C: completion verdicts, exactly once per reservation (DB compare-and-set).
 *   SUCCEEDED / FAILED           — this call decided the outcome
 *   ALREADY_SUCCEEDED / ALREADY_FAILED — decided earlier; can never be flipped
 *   EXPIRED                      — reservation timed out unconsumed
 *   UNKNOWN_RESERVATION          — no such reservation
 *   MALFORMED                    — invalid input
 * Bounded: a hung limiter returns TIMEOUT instead of blocking the login.
 */
export type OwnerLoginCompletionVerdict =
  | "SUCCEEDED"
  | "FAILED"
  | "ALREADY_SUCCEEDED"
  | "ALREADY_FAILED"
  | "EXPIRED"
  | "UNKNOWN_RESERVATION"
  | "MALFORMED"
  | "TIMEOUT";

const COMPLETION_TIMEOUT_MS = 10_000;

function isKnownVerdict(value: unknown): value is OwnerLoginCompletionVerdict {
  return (
    typeof value === "string" &&
    [
      "SUCCEEDED",
      "FAILED",
      "ALREADY_SUCCEEDED",
      "ALREADY_FAILED",
      "EXPIRED",
      "UNKNOWN_RESERVATION",
      "MALFORMED",
    ].includes(value)
  );
}

export async function completeOwnerLoginAttempt(
  reservationId: string,
  success: boolean,
): Promise<OwnerLoginCompletionVerdict> {
  const client = getServiceClient();
  if (!client) return "UNKNOWN_RESERVATION";
  try {
    const raced = await Promise.race([
      client.rpc("complete_owner_login_attempt", {
        p_reservation_id: reservationId,
        p_success: success,
      }),
      new Promise<"TIMEOUT">((resolve) =>
        setTimeout(() => resolve("TIMEOUT"), COMPLETION_TIMEOUT_MS),
      ),
    ]);
    if (raced === "TIMEOUT") return "TIMEOUT";
    const { data, error } = raced;
    if (error) return "UNKNOWN_RESERVATION";
    return isKnownVerdict(data) ? data : "MALFORMED";
  } catch {
    return "UNKNOWN_RESERVATION";
  }
}
