# Point 2 Checkpoint: P0-2 Closed

**Status:** P0-2 is closed and verified. Do not merge, apply Supabase migrations,
deploy Vercel, or start the next blocker until this checkpoint is reviewed.

**Branch:** `fix/point-2-blockers-r12`
**Parent checkpoint:** `6febb81c7dd5e825661234e06d8fa5f1ea64874a` (P0-1 closed)

## What was broken

R11 (`20260911130000_manager_global_lifecycle_hardening.sql`) introduced the
permanent anti-reuse register and made a fresh mint honour "one manager bearer
hash is one global manager lifecycle". Its cutover had three holes:

1. The register backfill ran without holding the lifecycle tables. A transaction
   still executing the pre-R11 functions could commit a pending row after the
   backfill snapshot and never be inspected.
2. Nothing repaired rows that already violated the invariant: an unconfirmed
   `manager_pending_sessions` row whose hash is also a live `manager_sessions`
   row, or already carries a terminal `manager` / `manager_pending` tombstone.
   Each of those is a terminal bearer waiting to be resurrected.
3. The exact-retry branch of `create_manager_session_pending` and the activation
   branch of `confirm_manager_session` never asked the overlap question, so
   either could hand that terminal bearer back out. Confirmation was the worst
   case: its supersede-revoke would have deleted (and tombstoned) the very
   active row that proved the overlap, then re-inserted the same hash as a new
   live session.

## What was fixed

Forward migration `20260911150000_manager_lifecycle_cutover_overlap_guard.sql`,
with no earlier migration rewritten:

1. **Cutover lock.** `ACCESS EXCLUSIVE` on `manager_pending_sessions`,
   `manager_sessions`, `revoked_session_tombstones` and
   `manager_bearer_lifecycle_hashes`, taken first, in the order the legacy
   lifecycle paths touch them. A racing legacy writer queues behind the cutover;
   if PostgreSQL does detect a cycle it aborts the migration (retryable) instead
   of letting an uninspected write through.
2. **Lock proof.** A `do` block verifies all four `AccessExclusiveLock`s are
   granted to this backend and raises `MANAGER_LIFECYCLE_CUTOVER_NOT_LOCKED`
   (`55000`) otherwise, so applying the file statement-by-statement (autocommit,
   where the locks cannot outlive their statement) fails loudly rather than
   repairing and swapping functions unprotected.
3. **Backfill re-run** of the permanent register under those locks, idempotent,
   catching anything a legacy transaction committed after R11's unlocked pass.
4. **Repair.** Every `confirmed_at is null` pending row whose hash is owned by
   another lifecycle is terminalized (deleted). R11's `BEFORE DELETE` trigger
   writes the exact `manager_pending` tombstone (hash + reservation) and the
   register entry, so the bearer is permanently un-mintable and reconciliation
   answers `FAILED` for the exact pair. Only counts are logged: no hash, no raw
   bearer.
5. **One overlap question, three independent enforcement points.**
   `public.manager_bearer_hash_conflict(text)` (security definer, pinned
   `search_path`, execute revoked from every role including `service_role`)
   returns a token-free reason code. It is asked by the exact retry, by
   confirmation *before* the supersede-revoke, and by reconciliation (which now
   reports `FAILED` instead of `PENDING` for an overlapping live row). Retry and
   confirmation both fail closed *and* terminalize the invalid row.

**Not classified as invalid:** a confirmed pending row paired with the active
session carrying the same hash — the normal successful handoff — and a confirmed
row whose active session was later revoked (it legitimately co-exists with a
`manager` tombstone). The repair only ever considers `confirmed_at is null`.

## Evidence

`tests/db/manager-lifecycle-cutover-overlap.test.ts` (20 tests, disposable
PostgreSQL, full migration chain replayed from empty):

- **Upgrade/cutover:** legacy state is seeded with the R10 lifecycle in place
  (harness `stopAfter` + `applyMigrationsAfter`), i.e. before R11 and this
  cutover, then upgraded. All three invalid overlap shapes end terminal with
  exact evidence; the clean pending row stays `PENDING` and still confirms; the
  confirmed+active pair stays `SUCCEEDED`; the confirmed+revoked row survives;
  the active session that proved an overlap is untouched; a repaired bearer can
  never be minted again; no raw bearer is persisted anywhere.
- **Cutover locking:** an in-flight legacy `INSERT` is committed while the
  migration is *observed* queueing on an ungranted relation lock (`pg_locks`, no
  sleeps), and the row it committed is still repaired. The lock proof is
  asserted to abort without a transaction. Re-applying the cutover is a no-op.
- **Runtime enforcement:** retry, confirmation and reconciliation each refuse an
  overlap created after the cutover; refusal consumes no reservation and
  activates no session; the clean mint → retry → confirm → re-confirm →
  reconcile path and supersede-on-confirm are unchanged; grants/`search_path`
  contracts are asserted, including that the helper is callable by no role.

Ablation runs (each part of the migration removed in turn) fail exactly the
tests that cover it: repair removed → 6 failures, runtime guards removed → 3,
cutover lock removed → 3.

Gates on this checkpoint: focused DB suite 167 passed / 8 skipped; full Vitest
1468 passed, 8 skipped, 0 failed; `tsc --noEmit`, `eslint .` and `vite build`
all passed.

## Known scope boundary (belongs to P1-5, not regressed here)

When a repaired hash already carried a `manager_pending` tombstone from another
reservation, `(namespace, token_hash)` uniqueness means the exact pair cannot
also be recorded, so reconciliation answers `UNKNOWN` rather than `FAILED`. The
row is still terminal and un-mintable and is never reported `PENDING`. Carrying
reservation identity for that case needs the durable registry of blocker P1-5.

## Operational note

The cutover briefly takes `ACCESS EXCLUSIVE` on four lifecycle tables. Manager
login/logout will block for the duration of the migration transaction (a
bounded, small repair) and legacy writers queue rather than fail.

## Remaining blockers

- P1-3: server equality guard and pending-handoff persistence failure.
- P1-4: definitive pending identity cleanup and navigation/unmount recovery.
- P1-5: exact durable reconciliation evidence.
- P2-6: bounded expiry/retention batching.
- Final security sweep: search paths, grants, RLS, and raw bearer leakage.

## Environment notes

Same as the P0-1 checkpoint, with one addition: `tests/restaurant-login-build.test.ts`
fails on Node 22.14 (`fs.globSync` rejects a URL `cwd`) — unrelated to this
blocker and reproducible on the parent commit. Node 22.20 runs the whole suite
green. Run the embedded-PostgreSQL tests as a non-root user with an
`en_US.utf8` locale alias available.
