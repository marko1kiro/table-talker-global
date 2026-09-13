// Poin 3 SHARED TEST HELPERS. The pairing and shift suites both drive the same
// crew lifecycle over one disposable DB: simulate auth.uid() via
// request.jwt.claims, mint a crew user, run the full pairing handshake, and
// seed restaurants / an active manager session. Kept here so the two files
// cannot drift; each suite binds these to its own `c` and adds only the
// suite-local helpers (claim/token introspection for shift, otp variants for
// pairing).
import type { Client } from "pg";
import { rawHexToken, rpcNamed, sha256Hex } from "./harness";

export const R1 = "11111111-1111-4111-8111-111111111111";
export const R2 = "22222222-2222-4222-8222-222222222222";
export const R3 = "33333333-3333-4333-8333-333333333333";
export const R4 = "44444444-4444-4444-8444-444444444444";
export const MANAGER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
export const OTP_HASH = "f".repeat(64);
export const WRONG_HASH = "0".repeat(64);
export const ENVELOPE = "4c494d4551523031" + "ab".repeat(21);

let uidCounter = 0;

export function freshUid(): string {
  uidCounter += 1;
  const h = uidCounter.toString(16).padStart(8, "0");
  return `${h}-${h.slice(0, 4)}-4${h.slice(0, 3)}-8${h.slice(0, 3)}-${h}${h.slice(0, 4)}`;
}

// Sets the caller's JWT claims. uid === null resets to the anon slate (the
// claims are SESSION-scoped, so an unset slate leaks a prior uid into the next
// test); beforeEach leans on exactly this to clear state.
export async function asUid(c: Client, uid: string | null): Promise<void> {
  const claims = uid
    ? JSON.stringify({ sub: uid, role: "authenticated" })
    : JSON.stringify({ role: "anon" });
  await c.query(`select set_config('request.jwt.claims', $1, false)`, [claims]);
}

export async function crewUser(c: Client, uid: string, email: string): Promise<void> {
  await c.query(`insert into auth.users (id, email) values ($1, $2)`, [uid, email]);
}

export async function requestPairing(
  c: Client,
  uid: string,
  restaurantId: string,
  name = "Crew Satu",
  otpHash = OTP_HASH,
  envelope = ENVELOPE,
) {
  await asUid(c, uid);
  return rpcNamed<{ ok?: boolean; request_id?: string }>(c, "crew_request_pairing", {
    p_restaurant_id: restaurantId,
    p_full_name: name,
    p_otp_hash: otpHash,
    p_otp_encrypted: envelope,
  });
}

export async function confirmPairing(
  c: Client,
  uid: string,
  requestId: string,
  otpHash = OTP_HASH,
) {
  await asUid(c, uid);
  return rpcNamed<{ ok?: boolean; error?: string }>(c, "crew_confirm_pairing", {
    p_request_id: requestId,
    p_otp_hash: otpHash,
  });
}

export async function pairingRow(c: Client, id: string): Promise<Record<string, unknown>> {
  const r = await c.query(
    `select status, email, restaurant_id, otp_hash, otp_encrypted, attempts,
            expires_at, decided_by, decided_at
       from public.crew_pairing_requests where id = $1`,
    [id],
  );
  return r.rows[0] as Record<string, unknown>;
}

// Restaurants get a deterministic pin_hash so a suite can seed many without
// colliding on the restaurants_pin_hash_unique constraint (sha256 of 'pin-<code>').
export async function seedRestaurant(
  c: Client,
  id: string,
  code: string,
  name: string,
  active = true,
): Promise<void> {
  await c.query(
    `insert into public.restaurants (id, code, display_name, pin_hash, credential_rotated_at, is_active)
     values ($1, $2, $3, encode(extensions.digest('pin-' || $2, 'sha256'), 'hex'), now(), $4)`,
    [id, code, name, active],
  );
}

export async function seedManager(
  c: Client,
  id: string,
  restaurantId: string,
  idManager: string,
  fullName = "P3 Manager",
): Promise<void> {
  await c.query(
    `insert into public.manager_accounts (id, id_manager, full_name, restaurant_id, password_hash, status)
     values ($1, $2, $3, $4, 'oldsalt:oldhash', 'aktif')`,
    [id, idManager, fullName, restaurantId],
  );
}

// Mints a usable manager bearer token by inserting an active manager_sessions
// row directly (the manager login handshake is out of scope for the crew RPCs
// under test here). Returns the plaintext token; store it for the suite.
export async function seedManagerSession(
  c: Client,
  managerId: string,
  restaurantId: string,
): Promise<string> {
  const token = rawHexToken();
  await c.query(
    `insert into public.manager_sessions (manager_id, restaurant_id, token_hash, expires_at)
     values ($1, $2, $3, now() + interval '12 hours')`,
    [managerId, restaurantId, sha256Hex(token)],
  );
  return token;
}
