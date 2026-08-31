import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { browserSessionStorage, createSessionStorageAdapter } from "./crew-session-identity";

let client: SupabaseClient | null = null;

export function getSupabaseBrowserClient(): SupabaseClient | null {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  client ??= createClient(url, anonKey, {
    auth: {
      storage: createSessionStorageAdapter(browserSessionStorage()),
      persistSession: true,
      autoRefreshToken: true,
    },
  });
  return client;
}

// Task 8: claim_role_session and the other Task 6 authenticated-only RPCs
// require a genuine Supabase Auth access token (anonymous auth is
// sufficient -- there is no separate crew login identity server-side,
// see role-session.server.ts). This is obtained once per device: the
// client's `persistSession: true` + sessionStorage adapter above already
// keeps a prior anonymous session across reloads, so this only calls
// signInAnonymously() when no session exists yet. Never throws -- callers
// treat a null return as "cannot claim a role session right now".
export async function ensureAnonAccessToken(client: SupabaseClient | null): Promise<string | null> {
  if (!client) return null;
  try {
    const { data } = await client.auth.getSession();
    const existing = data.session?.access_token;
    if (existing) return existing;
    const { data: signedIn, error } = await client.auth.signInAnonymously();
    if (error) return null;
    return signedIn.session?.access_token ?? null;
  } catch {
    return null;
  }
}

// Task 14 bugfix: RoleSessionIdentity.accessToken (Kasir/Satgas/Clear Up)
// is captured once via ensureAnonAccessToken at login time and persisted
// verbatim in sessionStorage for the rest of that role session, which can
// span an entire shift. A Supabase Auth access token expires after a
// fixed TTL (1 hour by default) -- confirmed via Supabase's own edge logs
// during a real pilot test: every table-occupancy RPC call for a session
// older than an hour returned 401 with PostgREST's PGRST303 ("JWT
// expired"), surfacing to the crew as a generic, unrecoverable "Status
// meja tidak dapat dimuat" error. `client.auth.getSession()` (called
// inside ensureAnonAccessToken above) already transparently refreshes an
// expiring access token via the persisted session's refresh token as long
// as this same browser client instance is still around -- the bug was
// that the 3 role routes never called it again after login, so they never
// benefited from that refresh. Every authenticated call site in those
// routes must call this immediately before building its request payload,
// instead of reading `identity.accessToken` directly. Falls back to the
// caller-supplied token (the original login-time snapshot) only when a
// live one could not be obtained, so a momentary network hiccup degrades
// to the previous best-effort behavior rather than blocking the call.
export async function getLiveAccessToken(
  client: SupabaseClient | null,
  fallback: string,
): Promise<string> {
  return (await ensureAnonAccessToken(client)) ?? fallback;
}
