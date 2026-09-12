# Table Talker Point 2 — WIP Checkpoint Handoff

**Stopped by owner:** 11 September 2026, approximately 21:29 GMT+7

**Repository:** `marko1kiro/table-talker-global`

**Frozen source base:** `7ecbe4333ae21db4b6358ca531de76f3e9e21c95` (`fix/point-2-blockers`)
**Status:** **WIP / CHANGES REQUIRED — do not merge, deploy, or apply migrations**

## Integrity and recovery

The supplied ZIP passed `unzip -t`. Every internal entry passed `sha256sum -c SHA256SUMS.txt`. The Git bundle passed `git bundle verify`, contains complete history, and restored exactly to `7ecbe43`. The interrupted `uncommitted-worktree.patch` applied cleanly but was not trusted wholesale.

A new local recovery bundle is supplied with this checkpoint. Restore it, checkout the checkpoint branch named in the accompanying report, and verify its SHA before continuing.

## Work completed in this session

1. Read the original handoff, roadmap, review report, evidence summary, committed history, and interrupted worktree patch.
2. Independently audited committed migrations `20260909140000` and `20260911120000` together with prerequisites `20260909060000`–`20260909130000`.
3. Audited every interrupted patch hunk. Accepted/revised the accurate lifecycle comments and strict Manager logout design; rejected unsupported route retry assertions.
4. Prepared a **candidate** forward migration and TypeScript/test changes. The candidate adds global bearer-lifecycle evidence, strict Manager logout handling, exact token/reservation assertions, and pending-handoff recovery scaffolding.
5. Performed a second adversarial review. That review rejected the candidate as merge-ready and identified the unresolved issues below.

No GitHub push occurred before the owner’s STOP instruction. No Supabase mutation or Vercel deployment occurred at any point.

## Candidate contents preserved for continuation

- New forward migration draft: `20260911130000_manager_global_lifecycle_hardening.sql`.
- Lifecycle/comment updates in `area-manager.server.ts`, `auth.server.ts`, `auth.ts`, and `staff-login.server.ts`.
- Manager logout made strict: only `REVOKED` and authoritative `ALREADY_INACTIVE` succeed; RPC rejection/error/malformed/`UNKNOWN_TOKEN` fail closed.
- Manager login route/tests use the exact `{managerToken, rateLimitReservationId}` pair and generic token-free errors.
- Draft session-storage pending-handoff recovery helper and expanded DB/unit/route tests.

These files are a checkpoint, **not an approved solution**.

## Unresolved blockers from adversarial review

### P0 — universal parent lock order is incomplete

The draft revocation functions lock restaurant/manager parents first, but existing manager mutation RPCs—especially `set_staff_password`, `set_manager_status`, and `decide_manager_reset`—can lock/update a manager or reset-request child before calling the new parent-first revoker. Concurrent restaurant deletion can deadlock. Forward-replace every manager mutation caller so it discovers IDs without locks, locks restaurant parent, locks manager, takes manager advisory lock, re-reads authorization/state, mutates, then revokes in canonical hash order. Add deterministic restaurant-delete races for password/status/reset paths.

### P0 — legacy invalid hash overlap and migration cutover

The draft backfill does not repair an old unconfirmed pending row whose hash overlaps an active Manager session or a `manager` tombstone. Exact retry/confirmation can still resurrect that terminal bearer. Old lifecycle writes can also race the backfill. The next implementation must lock lifecycle tables during cutover, diagnose or terminally remove invalid unconfirmed overlaps, independently enforce overlap checks in exact retry and confirmation, and test upgrade from seeded legacy-invalid states. Normal confirmed-pending plus active pairs must not be misclassified.

### P1 — browser recovery is not yet reliable

The draft ignores failure to persist the pending-handoff record. If ordinary identity survives but the recovery record does not, a retry can submit the newly pending token as an old token and self-revoke. Add a server-side equality guard independent of browser storage, treat pending-record persistence failure as a hard pre-confirm failure with exact cleanup, and define real navigation/unmount behavior. On unresolved reconciliation after pre-confirm navigation, return to login or make the Manager route resume recovery.

### P1 — definitive failures leave stale identity

After navigation failure, successful cleanup, or authoritative `FAILED`, the draft can leave the raw pending Manager identity in session storage. Remove the newly written identity on every definitive failure. Retain identity plus recovery state only while the exact lifecycle state is genuinely unresolved. Add storage assertions.

### P1 — exact reconciliation evidence is insufficient after confirmed cascades/retention

A generic active-manager tombstone does not preserve the original reservation identity. After Manager/restaurant deletion or confirmed-row retention, exact reconciliation can remain `UNKNOWN` forever. Durable evidence must preserve token hash + reservation ID + manager ID + authoritative lifecycle state and be updated at mint, confirmation, and terminal deletion. Add exact reconciliation tests for active revoke, Manager deletion, restaurant deletion, and retention.

### P2 — cleanup throughput and race tests

The draft processes one manager per expiry/retention invocation without an operational loop. Add bounded globally safe batching/looping and multi-manager tests. Replace timing sleeps with observed backend wait states/locks for every race participant, and assert exact verdicts and final rows—not only absence of RPC errors.

### Security checks still required

Verify all new security-definer functions’ fixed `search_path`, execute grants/revokes, table privileges, and registry RLS. Confirm no raw bearer appears in SQL persistence, UI, URLs, errors, or logs. Browser session storage necessarily holds the active/pending identity; minimize duplicate lifetime and clear it on definitive failure.

## Testing status

Only structural checks were completed for the candidate:

- `git apply --check`: passed.
- `git diff --check`: passed.
- Syntax/transpile-only checks on changed TS/TSX: passed.

**Not run after the candidate changes:** focused Vitest, embedded-PostgreSQL concurrency suite, full test suite, typecheck, lint, build. Historical green evidence must not be treated as evidence for this checkpoint.

## Recommended continuation sequence

1. Restore the checkpoint bundle and read this document plus `AUDIT-FINDINGS.md` and `CANDIDATE-REVIEW.md`.
2. Fix P0 lock-order callers and migration cutover/legacy overlap before running broad tests.
3. Fix server-side equality guard, browser persistence failure, navigation recovery, and definitive identity cleanup.
4. Implement exact durable lifecycle evidence and bounded retention/expiry behavior.
5. Add deterministic real-PostgreSQL race/upgrade tests.
6. Run focused tests, full migration chain, full suite, typecheck, lint, and build under the non-root setup documented in the original handoff.
7. Perform another independent review before merge/staging.

## External-state rule

The checkpoint push requested by the owner is source preservation only. **Do not merge it, apply Supabase migrations, or deploy to Vercel without fresh explicit approval.**
