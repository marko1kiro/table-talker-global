# Full Audit Remediation Design

## Status

- Date: 2026-08-24
- Baseline: `main` at `caba78e8569cfd987f30ca050eb196154f6b92a5`
- Scope: remediate H-01, M-01 through M-05, L-01 through L-05, and defensive NV-01 from `audit-output/findings.md`.
- Product behavior outside these findings remains unchanged.

## Goal

Fix every confirmed audit finding and defensively resolve the `pgcrypto` namespace risk without hiding failures, weakening tests, or converting unavailable dependencies into false success.

## Non-Negotiable Verification Invariant

Green checks must represent fixed root causes.

The remediation must not:

- disable or suppress ESLint rules to clear existing errors;
- add test skips, `.only`, `passWithNoTests`, broad mocks, or weaker assertions;
- catch and ignore new operational failures;
- report scheduler, authentication, delivery, retention, or telemetry success without durable evidence;
- replace atomic server/database controls with browser-only guards;
- expose secret, token, credential hash, ciphertext, or service-role values in errors or logs;
- rewrite published Git history or modify unrelated user changes.

Environment failures remain explicit failures or degraded states with actionable diagnostics.

## Architecture

Use targeted corrective migrations and small application changes. Preserve existing role boundaries:

- browser crew uses Supabase anonymous auth plus tenant/session bearer tokens;
- owner uses signed HttpOnly session cookie;
- privileged database operations remain service-role-only;
- RLS remains deny-by-default for tenant-sensitive tables.

Existing applied migrations are immutable except `20260824006000_owner_retention_verification.sql`: fresh deployment cannot reach any later corrective migration when this verifier rejects cron-less environments. Its verification contract must therefore be corrected in place. All other database fixes use new forward migration files after `20260824006000`.

## Scheduler Contract

Retention supports two explicit modes: `pg_cron` and `edge_required`.

### State

Add one service-owned scheduler-state row for owner retention. It records:

- scheduler name;
- configured mode;
- expected schedule;
- last successful run timestamp;
- last result summary without row data or secrets.

RLS is enabled. Direct access from `anon` and `authenticated` is revoked. Only service-role RPCs may update execution state.

### Migration Selection

Migration attempts to install and schedule `pg_cron` exactly once.

- If scheduling succeeds, state becomes `pg_cron` and verifier requires exact job name, schedule, and command.
- If extension or permission is unavailable, state becomes `edge_required`. Migration succeeds without claiming Edge Function deployment or scheduling.
- Any unexpected SQL error fails migration.

The corrected verifier accepts either a valid exact cron job or explicit `edge_required` state. It must reject missing, ambiguous, or contradictory state.

### Edge Readiness

`owner-retention` Edge Function invokes the cleanup RPC and records successful completion. `edge_required` remains operationally degraded until a real successful invocation updates `last_success_at`. Public docs must state deployment, bearer authorization, schedule `17 3 * * *`, secrets, and read-only verification steps.

Edge handler uses a bounded upstream deadline below platform timeout and returns controlled `401`, `405`, `500`, or `504` responses. It logs operation category only, never secret or deleted row content.

## Database Corrections

### `pgcrypto` Namespace

Normalize `pgcrypto` to `extensions` before final application functions depend on `extensions.digest` or `extensions.gen_random_bytes`.

Corrective migration:

1. Ensure schema `extensions` exists.
2. Inspect installed extension namespace.
3. Install into `extensions` if absent.
4. Relocate with `ALTER EXTENSION pgcrypto SET SCHEMA extensions` when installed elsewhere and relocatable.
5. Fail with an explicit deployment error if normalization cannot be completed.
6. Assert required `extensions.digest` and random-byte functions resolve.

No unqualified fallback function lookup is allowed.

### Stale Crew Claims

Restore tenant-scoped stale cleanup inside final `claim_crew_session` transaction before upsert. Only rows for `p_restaurant_id` in `connecting` or `connected` state with `last_seen <= now() - interval '30 seconds'` become disconnected. Fresh rows and other restaurants remain untouched.

### Realtime Topic

Use one shared topic contract, `owner-dashboard`, for trigger producer and dashboard consumer. Existing event remains `invalidate`. Polling remains fallback, not proof of Realtime health.

### Credential Audit Retention

Include `restaurant_credential_audit` older than 90 days in scheduled owner cleanup or a service-only cleanup called by the same scheduler transaction. Do not create a second undocumented scheduler. Return deleted count in non-sensitive result summary.

## Authentication And Rate Limits

### Owner Login

Add service-owned owner login rate-limit storage and RPCs. Bucket derivation follows trusted proxy/IP handling already used by tenant login, with a separate owner namespace.

Password verification remains in the TanStack server runtime; `SUPER_ADMIN_PASSWORD` is never sent to or stored in Supabase. A database admission RPC atomically reserves one attempt slot per bucket before password comparison, and a second outcome RPC records success/failure against that reservation without allowing concurrent clears to erase newer failures:

- blocked bucket rejects before password validation work proceeds;
- admitted attempt receives an opaque short-lived reservation ID;
- failed password consumes reservation, increments count, and may set block window;
- successful password consumes reservation and resets only state at or before that reservation sequence;
- concurrent attempts serialize per bucket;
- limiter errors fail closed when owner auth is configured.

Public response remains generic. Internal audit records category and timestamp only.

### Tenant Login

Move rate-limit state transition and credential decision into one transaction-safe service-role RPC. It serializes relevant client/IP buckets before deciding.

The operation must:

1. validate bucket hashes and lookup hash format;
2. lock or atomically create bucket rows in deterministic order;
3. reject blocked buckets;
4. evaluate credential lookup and active restaurant state;
5. increment all applicable failure counters only on failure;
6. reset counters according to explicit successful-login policy without deleting failures committed after the attempt began;
7. create restaurant session and access token only after successful decision;
8. return minimum restaurant identity plus opaque token.

No valid or invalid concurrent burst may exceed policy due to check-then-record races. Public errors continue to use `Kode Resto salah.`.

## Remote Command Acknowledgement

Playback dedupe and acknowledgement delivery become separate state.

- `processedIds` continues preventing duplicate playback.
- Successful or failed playback creates a pending acknowledgement entry.
- Ack retries use bounded delay and stop at command expiry, successful terminal response, invalid session, unmount, or superseding credential revocation.
- Retry never replays audio.
- UI keeps `deliveryUncertain` while ack remains pending and clears it after all pending acknowledgements settle.
- Invalid session follows existing session invalidation path.

Latest-wins playback behavior remains unchanged because existing tests define it as product contract.

## Broadcast Idempotency

Generate one UUID idempotency key per deliberate submit action. Persist it on `owner_broadcasts` with a unique actor-scoped constraint and a payload fingerprint covering scope, restaurant target, and normalized message.

Server behavior:

- first request creates broadcast and deliveries;
- replay with same key and identical fingerprint returns stored result without new messages;
- same key with different payload rejects as `IDEMPOTENCY_CONFLICT`;
- delivery uniqueness prevents duplicate `(broadcast_id, crew_session_id)` creation;
- partial result remains queryable and retry only attempts missing delivery records when contract allows it.

UI pending state remains a usability guard, not security or idempotency boundary.

## Owner Logout

Add visible logout action to desktop and mobile owner navigation. It calls existing `logout`, clears owner-scoped React Query cache, invalidates router auth state, closes mobile sheet, and returns to `AuthGate`. Failure displays an alert and does not claim logout success.

## Edge Function And Tooling Coverage

Extract Edge request handling into a function that accepts dependencies so tests can invoke behavior without network. Keep Deno bootstrap thin.

Add official scripts for:

- application typecheck with `tsc --noEmit`;
- focused Edge validation using locally available tooling;
- serial full verification.

Do not add a dependency solely to wrap commands already provided by TypeScript, ESLint, Vitest, Vite, Deno, or Supabase CLI. If Deno/Supabase tooling is absent, script must fail with a clear prerequisite message rather than silently skip.

## Lint Remediation

Fix all current ESLint errors and warnings in source and tests.

- Apply formatting changes mechanically but inspect resulting diff.
- Replace explicit `any` with exact local types.
- Replace hard-to-count regex spaces with explicit quantifiers.
- Resolve hook dependency and cleanup warnings by correcting lifecycle/state capture, not suppressing rules.
- Keep generated `src/routeTree.gen.ts` excluded and restore it after builds as existing project workflow requires.

No unrelated component refactor or UI redesign belongs in this work.

## Error Handling

- Auth responses remain generic and constant-shape.
- DB migration invariants fail with named, actionable codes.
- Scheduler mode and last-run status are visible to owner health checks without exposing secrets.
- Ack retry distinguishes pending delivery from playback failure.
- Broadcast conflict and partial delivery return stable domain codes.
- Edge timeout and RPC failure return controlled non-2xx responses.
- Existing fail-open behavior for optional remote features is preserved only where documented; configured security controls fail closed.

## Testing Strategy

Use TDD for each finding: failing focused test, minimum fix, focused pass, then wider verification.

### Migration And Security Tests

- cron available selects `pg_cron` and verifies exact job;
- cron unavailable selects `edge_required` and migration completes;
- contradictory scheduler state fails;
- `pgcrypto` absent, already in `extensions`, and relocatable from another schema reach normalized state;
- stale crew name is released after 30 seconds only within same tenant;
- grants remain service-role/authenticated-specific and cross-tenant access remains denied;
- credential audit rows older than 90 days are removed while newer rows remain.

Use disposable PostgreSQL/Supabase integration when locally available. Static SQL assertions supplement but never replace runtime migration tests. If runtime database is unavailable, report that gate as unverified.

### Concurrency Tests

- more than threshold invalid tenant attempts in parallel cannot all pass admission;
- successful tenant login cannot erase concurrently committed failures;
- owner admission reservations serialize and block at threshold without sending owner password to DB;
- broadcast lost-response replay creates one broadcast and one delivery per crew.

### Remote Ack Tests

- playback occurs once when first ack fails and retry succeeds;
- retry stops on expiry and leaves explicit uncertainty;
- invalid session cancels retry and invalidates local session;
- cleanup cancels timers and subscriptions.

### Edge Tests

- wrong method returns `405`;
- missing/incorrect bearer returns `401`;
- missing configuration fails without exposing env values;
- RPC rejection returns controlled `500`;
- deadline returns `504`;
- success records scheduler heartbeat and returns `no-store` response.

### UI Tests

- logout is present in desktop/mobile navigation and invalidates authenticated state;
- broadcast retries reuse same idempotency key, while a new deliberate submit gets a new key;
- Realtime `owner-dashboard` event invalidates dashboard query before polling.

## Verification Gates

Run serially because Nitro/build caches are shared:

1. Focused tests for each remediation.
2. Migration integration tests when disposable DB tooling is available.
3. `npm test`.
4. `npm run typecheck`.
5. Edge validation command.
6. `npm run lint`.
7. `npm run build`.
8. Restore `src/routeTree.gen.ts` to `HEAD` if build regenerates it, then verify no unintended tracked changes.

Any failed or unavailable gate is reported exactly. No gate is marked passed based on another command.

## Rollout

1. Deploy application code that understands new RPC and scheduler state contracts.
2. Apply corrective migrations to disposable/staging database first.
3. Verify `pgcrypto` namespace and final grants read-only.
4. If mode is `pg_cron`, verify exact job row.
5. If mode is `edge_required`, deploy/schedule function and wait for one successful heartbeat before declaring retention healthy.
6. Exercise owner and tenant login concurrency tests in staging with synthetic accounts.
7. Verify Realtime invalidation, ack retry, broadcast replay, and logout.
8. Roll production only after all available required gates pass; document unavailable integration gates as release blockers unless explicitly accepted by operator.

## Acceptance Criteria

- All 11 confirmed findings are fixed at root cause.
- NV-01 is normalized defensively or migration fails clearly before dependent functions run.
- Dual scheduler mode deploys without contradiction and never reports Edge readiness before a real success heartbeat.
- No cross-tenant/RLS/auth regression appears.
- Remote playback is not duplicated by ack retry.
- Concurrent login attempts obey thresholds atomically.
- Broadcast replay is idempotent.
- Owner can log out from all navigation variants.
- Edge handler has executable behavior tests and bounded timeout.
- `npm test`, typecheck, lint, and build pass independently.
- No suppression, skipped test, weakened assertion, swallowed failure, or false-success fallback is introduced to obtain green output.
