import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cachedClient: SupabaseClient | null | undefined;

export function getServiceClient() {
  if (cachedClient !== undefined) return cachedClient;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  cachedClient =
    typeof url === "string" && url && typeof key === "string" && key
      ? createClient(url, key)
      : null;

  return cachedClient;
}
