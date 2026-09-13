// Poin 3 Task 7: the ONLY browser-side Supabase client factory. Sessions are
// persisted in localStorage via the supabase-js default adapter (deliberately
// NO sessionStorage override) so a crew account session and a staff carrier
// session both survive reloads. Token refresh is strictly `getSession()` --
// this module can never initiate a sign-in on its own, and the GoTrue
// anonymous provider is banned forever (tests/point-3-anon-guard.test.ts and
// the client-asset guard in tests/restaurant-login-build.test.ts).
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function getSupabaseBrowserClient(): SupabaseClient | null {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  client ??= createClient(url, anonKey);
  return client;
}

export const DEVICE_TOKEN_KEY = "lm.device.v1";

const UUID_36 = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Stable per-browser device identity (crew shift claim device-pin, Task 5/8).
// Never throws; null only when storage itself is unavailable.
export function getDeviceToken(): string | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const stored = localStorage.getItem(DEVICE_TOKEN_KEY);
    if (stored && stored.length === 36 && UUID_36.test(stored)) return stored;
    const fresh = crypto.randomUUID();
    localStorage.setItem(DEVICE_TOKEN_KEY, fresh);
    return fresh;
  } catch {
    return null;
  }
}

export type BrowserAuthResult = { ok: true } | { ok: false; code: "UNAVAILABLE" };

async function attempt(run: () => Promise<{ error: unknown }>): Promise<BrowserAuthResult> {
  try {
    const { error } = await run();
    return error ? { ok: false, code: "UNAVAILABLE" } : { ok: true };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}

// --- crew email-OTP account flow (Task 8 state machine consumes these) -----

export function crewSignInWithOtp(email: string): Promise<BrowserAuthResult> {
  const c = getSupabaseBrowserClient();
  if (!c) return Promise.resolve({ ok: false, code: "UNAVAILABLE" });
  return attempt(() => c.auth.signInWithOtp({ email }));
}

export function crewVerifyOtp(email: string, token: string): Promise<BrowserAuthResult> {
  const c = getSupabaseBrowserClient();
  if (!c) return Promise.resolve({ ok: false, code: "UNAVAILABLE" });
  return attempt(() => c.auth.verifyOtp({ type: "email", email, token }));
}

// The spec §12#5 escape hatch: CrewLoginFlow's "Keluar akun" (kick + checkin
// screens). Role-page logout deliberately does NOT call this -- one login = one
// logged-in device -- so this is the only way off a shared tablet's account.
export function crewSignOut(): Promise<BrowserAuthResult> {
  const c = getSupabaseBrowserClient();
  if (!c) return Promise.resolve({ ok: false, code: "UNAVAILABLE" });
  return attempt(() => c.auth.signOut());
}

export async function crewGetSession(): Promise<
  { ok: true; accessToken: string | null } | { ok: false; code: "UNAVAILABLE" }
> {
  const c = getSupabaseBrowserClient();
  if (!c) return { ok: false, code: "UNAVAILABLE" };
  try {
    const { data } = await c.auth.getSession();
    return { ok: true, accessToken: data.session?.access_token ?? null };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}

// --- staff carrier session (rotating shadow password, spec §3.3) -----------

export function staffSignInCarrier(email: string, password: string): Promise<BrowserAuthResult> {
  const c = getSupabaseBrowserClient();
  if (!c) return Promise.resolve({ ok: false, code: "UNAVAILABLE" });
  return attempt(() => c.auth.signInWithPassword({ email, password }));
}

// Live access token for the persisted carrier/crew session. getSession() is
// transparent-refreshing (autoRefreshToken default), and this NEVER attempts
// a sign-in: no session -> null. staffCarrierToken exists for the immediate
// post-signInCarrier read; refreshCarrierToken for every later call site --
// behaviourally identical today, split for call-site intent only.
// Call sites pair this with `?? fallback-token` (old getLiveAccessToken
// semantics, Task 14): a momentary network hiccup degrades to the token
// captured at login instead of blocking the request; a genuinely EXPIRED
// fallback then surfaces as a normal 401 from the RPC, never as a silent
// anonymous re-mint (the pre-Poin 3 fallback is banned -- see file header).
export async function refreshCarrierToken(): Promise<string | null> {
  const c = getSupabaseBrowserClient();
  if (!c) return null;
  try {
    const { data } = await c.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

export function staffCarrierToken(): Promise<string | null> {
  return refreshCarrierToken();
}
