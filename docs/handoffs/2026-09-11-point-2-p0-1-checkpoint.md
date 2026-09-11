# Point 2 Checkpoint: P0-1 Closed

**Status:** P0-1 is closed and verified. Do not merge, apply Supabase migrations,
deploy Vercel, or push further changes until the remaining blockers are closed.

**Branch:** `fix/point-2-blockers-r12`
**Commit:** `b18afda39f5a121ba7af3fa8bffe831b59f02441`
**Parent checkpoint:** `52e983aec45bd3b62bf04393085d60089a8fc86f`

## What was fixed

`set_staff_password('manager', ...)`, `set_manager_status`, and
`decide_manager_reset` previously locked the manager child and only then asked
for the restaurant parent inside `revoke_manager_sessions`. A concurrent
restaurant delete could therefore produce PostgreSQL deadlock `40P01`.

Migration `20260911140000_manager_mutation_parent_lock_order.sql` forward-replaces
all three RPCs with this order:

1. Area-manager lifecycle advisory lock where applicable.
2. Restaurant parent row (`FOR KEY SHARE`).
3. Manager account row (`FOR UPDATE`).
4. Manager lifecycle advisory lock.
5. Manager child row.
6. Re-read authorization/state, mutate, then revoke sessions.

Discovery reads do not make decisions. The mutation now queues consistently with
restaurant deletion instead of forming a lock cycle.

The same migration also fixes a separate pre-existing availability defect:
`set_staff_password('manager', ...)` aborted because `admin_audit_log.actor_kind`
did not permit `manager`. Manager self-service password changes now audit the
correct actor and reach mandatory session revocation.

## Evidence

`tests/db/manager-mutation-lock-order.test.ts` adds deterministic restaurant-delete
races for all three RPCs. It observes PostgreSQL advisory and row lock waits rather
than using timing sleeps. Removing the migration body reproduces `40P01` in all
three tests; the fixed migration passes them.

Checkpoint gates:

- Focused DB suite: 8 passed.
- Full Vitest: 1448 passed, 8 skipped, 0 failed.
- `tsc --noEmit`: passed.
- `eslint .`: passed.
- `vite build`: passed.

The original handoff baseline had one failing DB test caused by a duplicate unique
restaurant pin seed and 18 Prettier lint errors. Both were corrected.

## Remaining blockers

- P0-2: legacy invalid hash overlap and migration cutover locking.
- P1-3: server equality guard and pending-handoff persistence failure.
- P1-4: definitive pending identity cleanup and navigation/unmount recovery.
- P1-5: exact durable reconciliation evidence.
- P2-6: bounded expiry/retention batching.
- Final security sweep: search paths, grants, RLS, and raw bearer leakage.

An unverified draft for P0-2/P1-5/P2-6 was intentionally not added to the
migration chain. Start fresh from the committed branch state and do not treat
that draft as an approved solution.

## Environment notes

- Run Node 22 arm64 in this environment; dependencies are not committed.
- Run embedded-PostgreSQL DB tests as a non-root user.
- The container may need an `en_US.utf8` locale alias for embedded-postgres.
- Use `npm ci`, then `npx vitest run`, `npx tsc --noEmit`, `npx eslint .`, and
  `npx vite build`.
- The full test harness replays the complete migration chain against disposable
  PostgreSQL only. It does not touch Supabase or production.
- `super_admin_accounts` seeds require `email`; restaurant `pin_hash` is unique,
  so test restaurants need distinct pins.
