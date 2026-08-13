# Supabase remote audio operations

Apply the migration:

```bash
npx supabase db push
```

The migration enables `pg_cron` only when the database supports it. Missing extension support or permission is ignored, so Supabase Hobby migration deployment succeeds.

`expires_at` is authoritative: clients and the Task 4 server snapshot treat `sent` commands with `expires_at <= now()` as expired immediately and must never play them. The minute cron only persists the audit status eventually; it does not control delivery. No polling or retry is required.

If `pg_cron` is available, the migration schedules command expiry every minute and seven-day cleanup daily at 03:17. If it is unavailable, run the same RPCs from a Dashboard Scheduled Function:

```ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { error: expireError } = await supabase.rpc("expire_remote_commands");
  if (expireError) return new Response(expireError.message, { status: 500 });
  const { error: cleanupError } = await supabase.rpc("cleanup_remote_commands");
  return cleanupError ? new Response(cleanupError.message, { status: 500 }) : new Response("ok");
});
```

Scheduled retention is optional. Its failure never affects command delivery, acknowledgement, or local playback. Service-role credentials belong only in the scheduled server runtime; no client code is included in this task.

Visible crew names are reserved during `connecting` and `connected`; a stale reservation older than 30 seconds is released by the next claim. `create_remote_command` is service-role-only and atomically validates fresh, visible, connected, audio-ready targets before inserting a five-second command. Super Admin uses public Realtime Broadcast `invalidate` events containing only table kind plus optional session and command IDs; it never subscribes to database changes or reads database rows client-side. Broadcast invalidations are rate-limited client-side to one server refetch per second; ten-second polling remains the fallback.
