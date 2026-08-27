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

export async function reserveOwnerLoginAttempt(clientKey: string): Promise<string | null> {
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
    });
    if (error || !data || !Array.isArray(data) || data.length !== 1) return null;
    const reservation = data[0] as Reservation;
    return typeof reservation.reservation_id === "string" ? reservation.reservation_id : null;
  } catch {
    return null;
  }
}

export async function completeOwnerLoginAttempt(reservationId: string, success: boolean) {
  const client = getServiceClient();
  if (!client) return false;
  try {
    const { data, error } = await client.rpc("complete_owner_login_attempt", {
      p_reservation_id: reservationId,
      p_success: success,
    });
    return !error && data === true;
  } catch {
    return false;
  }
}
