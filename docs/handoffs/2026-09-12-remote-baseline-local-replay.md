# Remote Baseline Local Replay Evidence

Generated: 2026-09-12

## Production inventory (read-only)

- No Supabase write, branch, deployment, merge, or force-push operation occurred.
- Last remote migration: `20260908195839_drop_super_admin_purge_restaurant_test_data`.
- Point 2 migration sequence `20260909010000` through `20260911160000` is not applied remotely.
- `public.crew_sessions` exists with RLS enabled; `public.manager_accounts` and `public.manager_sessions` exist with RLS enabled.
- Remote table inventory exposes no Point 2 rate-limit/pending lifecycle baseline required for applying `20260911160000` alone.

## Disposable replay evidence

Node `v22.20.0`; all databases created by embedded PostgreSQL and discarded.

- `npx vitest run tests/db/manager-pending-tombstone-lifecycle.test.ts tests/db/manager-lifecycle-cutover-overlap.test.ts`: 55 passed.
- `npx vitest run tests/restaurant-login-build.test.ts`: 4 passed.
- `npx vitest run tests/audit-database-remediation.test.ts tests/role-login-flow.test.ts tests/crew-session-identity.test.ts tests/use-table-occupancy-realtime.test.ts`: 63 passed.

Coverage confirms complete repository migration-chain replay for P1-5 exact reconciliation, final crew-login grant/signature contracts, crew identity behavior, and credential build contracts.

## Residual risk

Repository replay from empty schema does not validate upgrading production data from its remote migration boundary. Production rollout requires a production-compatible baseline upgrade plan and backup/rollback window. Do not apply `20260911160000_manager_handoff_reconciliation_registry.sql` alone.
