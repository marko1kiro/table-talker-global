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
