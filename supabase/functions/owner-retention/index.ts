import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.3";
import { createOwnerRetentionHandler } from "./handler.ts";

if (typeof Deno !== "undefined") {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) throw new Error("OWNER_RETENTION_CONFIGURATION_MISSING");
  const client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  Deno.serve(
    createOwnerRetentionHandler({
      config: { url: url ?? "", serviceRoleKey: serviceRoleKey ?? "" },
      runOwnerRetention: async (signal) =>
        await client.rpc("run_owner_retention").abortSignal(signal),
    }),
  );
}
