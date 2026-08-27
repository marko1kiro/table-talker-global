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

Scheduled remote-command retention is optional. Its failure never affects command delivery, acknowledgement, or local playback. It is separate from owner retention below. Service-role credentials belong only in the scheduled server runtime; no client code is included in this task.

Visible crew names are reserved during `connecting` and `connected`; a stale reservation older than 30 seconds is released by the next claim. `create_remote_command` is service-role-only and atomically validates fresh, visible, connected, audio-ready targets before inserting a five-second command. Super Admin uses public Realtime Broadcast `invalidate` events containing only the table kind; it never subscribes to database changes or reads database rows client-side. Broadcast invalidations are rate-limited client-side to one server refetch per second; ten-second polling remains the fallback.

Crew display identity and anonymous Supabase auth are stored only in browser `sessionStorage`. Refreshing the same tab restores the validated name and anonymous UID; closing the tab or opening a new tab starts a separate crew session. Audio readiness is never persisted. After refresh, the crew must tap `Aktifkan Suara` before a subscribed heartbeat reports `audio_ready = true` and Super Admin can select the device.

Presence has separate online and history windows. A connected, visible session with a heartbeat no older than 30 seconds is `online`. Other sessions remain visible but disabled as `Offline / terakhir aktif` for up to three hours, then disappear from the Super Admin snapshot. Backgrounding, screen lock, and browser suspension cannot guarantee Realtime delivery. Returning to the foreground creates a fresh channel subscription before publishing connected presence. Commands missed while offline retain their five-second TTL and are never retried or replayed.

## Owner retention

Owner retention deletes owner audit rows older than 30 days through
`public.cleanup_owner_retention()`. Migration `20260824007000_audit_database_remediation.sql`
normalizes historical `owner-retention-daily` cleanup jobs to the final wrapper
`public.run_owner_retention()`, which records successful scheduled runs. Owner
retention is independent from remote-command expiry and cleanup. Read scheduler
state before selecting an operating mode:

```sql
select mode, schedule
from public.owner_retention_scheduler_state
where scheduler_name = 'owner-retention-daily';

select jobid, jobname, schedule, command
from cron.job
where jobname = 'owner-retention-daily';

select last_success_at
from public.owner_retention_scheduler_state
where scheduler_name = 'owner-retention-daily';
```

The last two queries are read-only. Run `cron.job` query only when
`mode` is `pg_cron`; `cron.job` does not exist in `edge_required`.

| Scheduler state | Required operation | Healthy evidence |
| --- | --- | --- |
| `pg_cron` | Migration owns schedule. Do not add a second scheduler. | Healthy only after exactly one `owner-retention-daily` job has schedule `17 3 * * *`, command `select public.run_owner_retention()`, and an actual run sets non-null `last_success_at`. |
| `edge_required` | Deploy owner-retention Edge Function. | BLOCKED and not healthy until operator configures one authenticated POST scheduler in Supabase Dashboard and read-only evidence confirms target, schedule `17 3 * * *`, and real heartbeat. |

> Warning: Do not execute cleanup manually against non-disposable data. Use scheduler and read-only checks; inspect logs and result metadata without exposing secrets or row content.

### `pg_cron` verification

Expected wrapper command is exactly:

```sql
select public.run_owner_retention()
```

Read-only preflight may verify `pgcrypto` availability when DB5 runbook requires
it; this retention task neither creates nor changes `pgcrypto`:

```sql
select extname, extversion
from pg_extension
where extname = 'pgcrypto';
```

### `edge_required` operation

Deploy requires authenticated Supabase CLI access and scheduled-function support.
Deploy command:

```bash
supabase functions deploy owner-retention
```

Do not invent a CLI schedule command. `edge_required` remains BLOCKED and not
healthy until operator configures one authenticated POST scheduler in Supabase
Dashboard for `17 3 * * *`. Read-only Dashboard evidence must confirm target and
schedule; read-only `last_success_at` evidence must confirm real heartbeat.

Schedule requires configured Edge Function secrets `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY`; names only, never values. Do not place either secret
in browser code, repository files, command output, or logs.

Scheduler calls Edge Function with machine-only bearer semantics:

```http
POST /functions/v1/owner-retention HTTP/1.1
Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
Content-Type: application/json

{}
```

Use server-side scheduler secret injection. Do not construct this request from a
browser or expose its bearer token. After scheduled invocation, verify only
non-sensitive function logs and result status, then re-run read-only
`last_success_at` query. A successful HTTP response without updated
`last_success_at` does not prove owner retention is healthy.
