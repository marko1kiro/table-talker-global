# Independent audit findings to resolve

## Committed SQL
1. In `20260911120000_manager_pending_lifecycle_lock_hierarchy.sql`, confirmation currently locks the pending child before reservation parent, allowing reservation-parent cascade delete vs confirm row-lock inversion/deadlock. Manager-account and restaurant parent cascades are likewise unsynchronized with confirmation.
2. Reconciliation takes advisory locks but can mix READ COMMITTED snapshots around cascades and return UNKNOWN/PENDING after terminal deletion.
3. Same bearer hash may coexist in active `manager_sessions` and pending state because pending mint checks only `manager_pending` tombstones. Sequence active -> mint same raw bearer pending under another reservation -> revoke active -> confirm pending can resurrect a terminal bearer. Enforce one global lifecycle identity across active, pending, and both manager tombstone kinds.
4. Explicit pending-tombstone cleanup can reopen anti-reuse and takes no bearer lock. Preserve permanent minimal anti-reuse evidence or make a clearly safe bounded policy; fail-closed is preferred.
5. Tests need deterministic barriers for every participant, including row-lock/cascade interleavings, plus exact winner/final-state assertions. Existing cascade test blocks confirmation too early at manager advisory lock and cannot expose row inversion.
6. Final lifecycle grants/revokes looked appropriate, and mandatory Super Admin role-switch is strict. SQL stores only hashes; no raw bearer log found.

## Interrupted worktree patch
- Keep accurate comment updates in area-manager.server.ts, auth.ts, and staff-login.server.ts.
- Revise auth.server.ts: do not claim tolerateUnknown is unused by logout; legacy Super Admin and Area Manager logout currently opt into it, while manager logout is strict.
- Keep manager logout fail-closed on UNKNOWN_TOKEN, but catch rejected RPC promises and return `{ok:false}` consistently. Expand tests for exact RPC/params, null client, RPC error, malformed/non-success verdicts, and rejected promise.
- Keep route exact `{managerToken, rateLimitReservationId}` assertions and generic token-free UI/error assertions.
- Reject/remove the patch's unsupported second-submit retry assertions. Current retry can submit the stored new pending manager token as the old token to revoke, potentially self-revoking before confirmation. Either implement explicit safe recovery, or test only the single submission unknown-reconciliation behavior. Prefer a robust production fix that tracks/retries the pending handoff rather than ordinary fresh login; never loosen mandatory revocation.
- No token may be interpolated into UI errors, URLs, or logs.
