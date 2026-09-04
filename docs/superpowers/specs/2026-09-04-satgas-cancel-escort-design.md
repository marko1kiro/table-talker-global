# Satgas Cancel Escort — Design Spec

Date: 2026-09-04
Status: Approved (pending user review of this written spec)

## Problem (root cause, from systematic debugging)

Escort intents created by a Satgas session that has since ended (logout, new
device, fresh login -> new `role_session_id`) become a **permanent yellow lock**
with no UI path to clear them. Evidence on CKRBUL: ~8 unresolved intents from
prior testing (tables 34, 78, 30, 17, 31, 15, 16, 27) still render yellow.

Mechanism:
1. `get_table_occupancy_snapshot_versioned` reports `escortIntentId` for **any**
   intent with `resolved = false` on a non-`terisi` table, **ignoring expiry** ->
   the table renders yellow.
2. `TableGrid`/`TableList` **disable** yellow tables (`disabled={... || escorted}`,
   the H-04 anti-duplicate guard) -> tapping is a no-op, so no dialog ever opens.
3. The "Menunggu Konfirmasi" panel and `confirm_escort_intent` are scoped to the
   **creating** session (`actor_session_id = v_session.role_session_id`), so an
   orphaned intent from another session can never be confirmed.
4. `create_escort_intent` rejects with `ALREADY_ESCORTED` on any unresolved
   intent, so it cannot be re-escorted either.
5. `cleanup_table_escort_intents` only deletes intents expired > 90 days, so
   orphans linger for months.

## Goal / fix (user-proposed, validated)

Make a yellow (escorted) table tappable again; tapping it opens a confirmation
dialog **"Batalkan Escort untuk Meja N?"** with **YA** / **TIDAK**. YA cancels the
escort intent so the table returns to green (kosong) and becomes escortable
again. This gives Satgas a way to clear both their own and orphaned escorts.

## Decisions (locked with user)

1. **Any Satgas at the restaurant may cancel any unresolved escort intent** for
   that restaurant (required to clear orphans from dead sessions). Accepted
   tradeoff: one Satgas can cancel a coworker's in-progress escort.
2. **Cancel = mark `resolved = true`**, not delete (preserves the audit trail;
   occupancy status is untouched -- the table stays `kosong`).
3. **Cancel broadcasts an invalidate (revision bump) so every crew device's grid
   drops the yellow promptly, but emits NO toast** -- cancelling an escort is not
   a table status change, so it is out of the notice feature's scope. The
   broadcast payload carries no `kind`, so `parseOccupancyBroadcast` yields no
   notice while the revision bump still triggers the refetch.
4. The existing "Menunggu Konfirmasi" panel (this session's expired intents ->
   confirm to mark TERISI) is unchanged and coexists with the new cancel action.
5. **Optional one-off cleanup** of the 8 existing CKRBUL orphans (set
   `resolved = true`) may be run at deploy time so Satgas need not tap each one;
   this is a data step, not part of the feature, and only with explicit go-ahead.

## Architecture

New security-definer RPC + a client wrapper + a second AlertDialog branch in the
Satgas page. Reuses the existing realtime invalidate channel for prompt grid
refresh.

```
tap yellow table (has row.escortIntentId)
  -> open cancel dialog "Batalkan Escort untuk Meja N?" [TIDAK][YA]
  -> YA: cancelEscortIntent(intentId, sessionToken, accessToken)
       -> RPC cancel_escort_intent: satgas session check; update
          table_escort_intents set resolved=true where id + restaurant +
          resolved=false; bump revision; realtime.send({table_number,revision},
          'invalidate', topic, true)   -- no kind -> no toast, refetch only
  -> invalidate snapshot query -> table turns green on all devices
```

## Components & file changes

### 1. NEW migration `supabase/migrations/20260904100000_cancel_escort_intent.sql`
```sql
create or replace function public.cancel_escort_intent(
  p_intent_id uuid,
  p_session_token text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session record;
  v_intent record;
  v_revision bigint;
begin
  select rst.* into v_session
  from public.role_session_tokens rst
  join public.restaurants r on r.id = rst.restaurant_id
  where rst.token_hash = encode(extensions.digest(p_session_token, 'sha256'), 'hex')
    and rst.role = 'satgas'
    and rst.expires_at > now()
    and r.is_active
    and rst.code_version = r.code_version;
  if v_session is null then raise exception 'INVALID_SESSION'; end if;

  select * into v_intent
  from public.table_escort_intents
  where id = p_intent_id
    and restaurant_id = v_session.restaurant_id
    and resolved = false;
  if v_intent is null then return false; end if;   -- already gone/resolved: idempotent

  update public.table_escort_intents
  set resolved = true
  where id = v_intent.id;

  v_revision := public.bump_table_occupancy_revision(v_intent.restaurant_id);
  perform realtime.send(
    jsonb_build_object('table_number', v_intent.table_number, 'revision', v_revision),
    'invalidate',
    'table-occupancy:' || v_intent.restaurant_id::text,
    true
  );
  return true;
end;
$$;

revoke all on function public.cancel_escort_intent(uuid, text) from public, anon, service_role;
grant execute on function public.cancel_escort_intent(uuid, text) to authenticated;
```
Notes: restaurant scoping comes from the validated session (a Satgas can only
cancel within their own restaurant). No `actor_session_id` restriction -> any
Satgas. Idempotent (returns false if already resolved). Broadcast has no `kind`
-> refetch, no toast.

### 2. EDIT `src/lib/table-occupancy.server.ts`
- Add a `cancelEscortIntent` server-fn wrapper mirroring `confirmEscortIntent`
  (same authenticated RPC-call shape): input `{ intentId, sessionToken,
  accessToken }`, calls `rpc("cancel_escort_intent", { p_intent_id,
  p_session_token })`, returns `{ ok: boolean }` (ok = the RPC returned true or
  false without error; a thrown INVALID_SESSION -> `{ ok:false }`).

### 3. EDIT `src/routes/satgas/index.tsx`
- New state `const [cancelTable, setCancelTable] = useState<{ tableNumber:
  number; intentId: string } | null>(null)`.
- `TableGrid`/`TableList`: stop disabling escorted tables. Instead, tapping an
  escorted table calls a new `onSelectEscortedTable(tableNumber, intentId)`;
  tapping a plain empty table keeps `onSelectEmptyTable`. The button needs the
  row's `escortIntentId` (already on `TableOccupancyRow`).
- `onSelectEscortedTable` -> `setCancelTable({ tableNumber, intentId })`.
- Add a second `AlertDialog` bound to `cancelTable`: title
  `Batalkan Escort untuk Meja {n}?`, description explaining the table returns to
  kosong, buttons **TIDAK** (cancel) and **YA** (runs `cancelMutation`).
- `cancelMutation` = `useMutation` calling `cancelEscortIntent`; on success
  `invalidateQueries(snapshotQueryKey)` and, if the cancelled intent is in this
  session's waitlist, `removeEscortWaitEntry` for it; on error set `actionError`.
- Keep the existing escort dialog for empty (non-escorted) tables.

### 4. Tests (TDD)
- `tests/cancel-escort-migration.test.ts`: new migration defines
  `cancel_escort_intent(uuid, text)`, sets `resolved = true`, scopes by
  `v_session.restaurant_id` (NOT `actor_session_id`), bumps revision, sends an
  `invalidate` broadcast with **no** `'kind'` key, and grants `authenticated`.
- `tests/table-occupancy-rpc-contract.test.ts` (extend if it enumerates RPC
  wrappers) or a new `tests/cancel-escort-client.test.ts`: `cancelEscortIntent`
  calls the right RPC with the right params and maps errors to `{ ok:false }`.
- `tests/satgas-cancel-escort.test.ts`: source contract -- the grid no longer
  disables escorted tables (escorted tap routes to a cancel handler), a
  `Batalkan Escort` dialog exists, and `cancelEscortIntent` is wired.
- Full `npm run verify` exit 0 before commit+push (repo AGENTS.md gate).

## Error handling
- Cancel of an already-resolved/absent intent -> RPC returns false -> treated as
  success (idempotent); grid refetch clears it anyway.
- Non-Satgas / expired session -> `INVALID_SESSION` raised -> wrapper returns
  `{ ok:false }` -> `actionError` shown.
- Concurrent confirm+cancel on the same intent: both guard on `resolved=false`;
  whichever commits first wins, the second is a no-op/false. No double effect.

## Out of scope
- Changing the escort window, confirm semantics, or the notice feature.
- Auto-expiring/clearing yellow on intent expiry (kept: yellow persists until
  confirm or cancel, by design).
- The optional one-off orphan cleanup (separate deploy-time SQL, only on
  explicit go-ahead).

## Risks / notes
- Any-Satgas cancel means a mis-tap can free a coworker's live escort; the
  explicit YA/TIDAK dialog + "Meja N" in the title mitigates it.
- Supabase assigns its own ledger timestamp on apply; repo filename is the CI
  replay source of truth.
