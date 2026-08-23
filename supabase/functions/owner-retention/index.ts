import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (request) => {
  if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authorization = request.headers.get("authorization");
  if (!url || !serviceRoleKey || authorization !== `Bearer ${serviceRoleKey}`)
    return new Response("unauthorized", { status: 401 });
  const client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.rpc("cleanup_owner_retention");
  return error
    ? new Response("cleanup failed", { status: 500 })
    : Response.json(data, { headers: { "cache-control": "no-store" } });
});
