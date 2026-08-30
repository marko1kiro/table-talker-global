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
export async function ensureAnonAccessToken(
  client: SupabaseClient | null,
): Promise<string | null> {
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
