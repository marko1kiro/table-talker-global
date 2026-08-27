# Audit Remediation Auth And Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make owner and tenant login limiting concurrency-safe, retry command acknowledgements without replay, make broadcasts idempotent, and expose owner logout.

**Architecture:** Keep secrets in TanStack server runtime. Use service-role RPCs for atomic database state, separate playback dedupe from acknowledgement retry, and persist broadcast idempotency at database boundary.

**Tech Stack:** TanStack Start server functions, Supabase PostgreSQL, React 19, React Query, Vitest.

---

## File Structure

- Create: `supabase/migrations/20260824008000_auth_rate_limit_remediation.sql` - owner reservations and atomic tenant login RPC.
- Create: `src/lib/owner-login-rate-limit.server.ts` - owner limiter adapter.
- Modify: `src/lib/auth.ts`, `src/lib/restaurants.server.ts` - consume new contracts.
- Modify/Create tests: `tests/auth-super-admin.test.ts`, `tests/restaurants-server.test.ts`, `tests/auth-rate-limit-remediation.test.ts`.
- Modify: `src/hooks/use-remote-crew.ts`, `tests/use-remote-crew.test.ts` - pending ack retry.
- Create: `supabase/migrations/20260824009000_broadcast_idempotency.sql`.
- Modify: `src/lib/owner-broadcast-domain.ts`, `src/lib/owner-broadcast.server.ts`, `src/routes/super-admin/broadcast.tsx`.
- Modify tests: `tests/owner-broadcast-domain.test.ts`; create `tests/owner-broadcast-idempotency.test.ts`.
- Modify: `src/routes/super-admin/route.tsx`; create/modify owner shell tests.

### Task 1: Add owner attempt reservations

- [ ] **Step 1: Write failing SQL and adapter tests**

Assert owner password never appears in RPC arguments. Test `reserveOwnerLoginAttempt(bucketHashes)` returns blocked or opaque reservation; `completeOwnerLoginAttempt(id, success)` consumes it once and rejects stale/replayed IDs.

- [ ] **Step 2: Run red tests**

Run: `npx vitest run tests/auth-super-admin.test.ts tests/auth-rate-limit-remediation.test.ts`

Expected: FAIL on missing migration/adapter.

- [ ] **Step 3: Add migration tables/RPCs**

Create bucket rows with sequence, failures, window, block timestamp; reservation rows with UUID, bucket, sequence, 60-second expiry, consumed timestamp. RLS/revoke all browser roles. `reserve_owner_login_attempt` locks buckets in sorted hash order, rejects blocked, increments sequence, and returns reservation UUID. `complete_owner_login_attempt` locks and consumes once; failure increments, success resets only when no newer sequence exists. Grant only `service_role`.

- [ ] **Step 4: Implement server adapter and login flow**

Derive client/IP buckets through `getLoginRateLimitBuckets`. Reserve before `isPasswordValid`; complete with boolean in `finally`-safe flow. If reserve/complete fails, return generic login failure and do not create session. Never send password to Supabase or logs.

- [ ] **Step 5: Run focused tests**

Run: `npx vitest run tests/auth-super-admin.test.ts tests/auth-rate-limit-remediation.test.ts tests/super-admin-route.test.ts`

Expected: PASS.

- [ ] **Step 6: Checkpoint**

Run: `git diff --check -- supabase/migrations/20260824008000_auth_rate_limit_remediation.sql src/lib/owner-login-rate-limit.server.ts src/lib/auth.ts tests/auth-super-admin.test.ts tests/auth-rate-limit-remediation.test.ts`

Expected: no whitespace errors. Do not stage or commit.

### Task 2: Make tenant login state atomic

- [ ] **Step 1: Write failing concurrency contract tests**

Assert one RPC performs admission, failure transition, restaurant/session lookup, token insert, and returns generic success shape. Add model test simulating six parallel failures and success/failure interleaving.

- [ ] **Step 2: Run red tests**

Run: `npx vitest run tests/restaurants-server.test.ts tests/restaurant-code-server.test.ts tests/auth-rate-limit-remediation.test.ts`

Expected: FAIL because `restaurants.server.ts` still calls check/record/clear separately.

- [ ] **Step 3: Add atomic RPC**

Create `login_to_restaurant_atomic(p_lookup_hash, p_client_bucket_hash, p_ip_bucket_hash, p_token_hash, p_expires_at)`. Validate SHA-256 hex inputs; lock both global and lookup bucket rows in deterministic hash order; reject blocked; lookup active restaurant by `code_hash`; increment counters on miss; reset only locked pre-attempt counters on success; upsert daily restaurant session and insert supplied token hash/version in same transaction. Return restaurant ID/name/version only, never code fields.

- [ ] **Step 4: Replace server check-record-clear chain**

Keep code validation, HMAC lookup hash, opaque token generation, and generic `CODE_ERROR` in server. Call one RPC with token hash. Return plaintext opaque token only after RPC success.

- [ ] **Step 5: Run focused tests**

Run: `npx vitest run tests/restaurants-server.test.ts tests/restaurant-code-server.test.ts tests/auth-rate-limit-remediation.test.ts tests/tenant-session.test.ts`

Expected: PASS; source test confirms old check/record/clear calls are absent from login handler.

- [ ] **Step 6: Checkpoint**

Run: `git diff --check -- supabase/migrations/20260824008000_auth_rate_limit_remediation.sql src/lib/restaurants.server.ts tests/restaurants-server.test.ts tests/restaurant-code-server.test.ts tests/auth-rate-limit-remediation.test.ts`

Expected: no whitespace errors. Do not stage or commit.

### Task 3: Retry acknowledgement without replay

- [ ] **Step 1: Write failing processor tests**

Test playback once, first ack reject, timed retry success; expiry stops retry; invalid-session callback cancels; dispose clears timers. Use injected `schedule`, `cancel`, and `now` for deterministic tests.

- [ ] **Step 2: Run red tests**

Run: `npx vitest run tests/use-remote-crew.test.ts`

Expected: FAIL because duplicate processing never retries ack.

- [ ] **Step 3: Add pending acknowledgement state**

Extend `RemoteCommandState` with `pendingAcks` map. Store command ID, status, reason, expiry, attempts, timer. Acknowledge through one `flushAck` function. Retry at bounded delays `250, 500, 1000` ms while `now() < expiresAt`; remove on success/expiry/invalid session. Keep `processedIds` unchanged so playback never repeats.

- [ ] **Step 4: Wire lifecycle cleanup**

Processor exposes `dispose()`. Hook cleanup cancels pending timers. `deliveryUncertain` equals pending map non-empty; clear after settlement. Existing latest-wins tests must remain unchanged and pass.

- [ ] **Step 5: Run focused tests**

Run: `npx vitest run tests/use-remote-crew.test.ts tests/remote-audio-domain.test.ts`

Expected: PASS, including existing replay/latest-wins tests.

- [ ] **Step 6: Checkpoint**

Run: `git diff --check -- src/hooks/use-remote-crew.ts tests/use-remote-crew.test.ts`

Expected: no whitespace errors. Do not stage or commit.

### Task 4: Persist broadcast idempotency

- [ ] **Step 1: Write failing domain/server tests**

Require UUID `idempotencyKey`; test stable payload fingerprint; same key/same payload returns existing result; same key/different payload returns `IDEMPOTENCY_CONFLICT`; duplicate delivery is impossible.

- [ ] **Step 2: Run red tests**

Run: `npx vitest run tests/owner-broadcast-domain.test.ts tests/owner-broadcast-idempotency.test.ts`

Expected: FAIL on missing key/fingerprint/RPC.

- [ ] **Step 3: Add database contract**

Add `idempotency_key uuid not null`, `payload_fingerprint text not null` with SHA-256 check, unique `(actor, idempotency_key)`, and unique delivery `(broadcast_id, crew_session_id)`. Add service-role RPC `create_or_get_owner_broadcast` that locks conflict row, rejects fingerprint mismatch, and returns `{id, replayed}`.

- [ ] **Step 4: Add server contract**

Extend Zod schema with UUID. Hash canonical JSON `{scope, restaurantId|null, message}` server-side. Call create/get RPC before fan-out. On replay, query stored deliveries and return stored grouped results; do not consume another rate-limit request or create messages.

- [ ] **Step 5: Keep one key per deliberate UI action**

Store key in ref/state when submit starts. Reuse after network/server uncertainty. Generate new `crypto.randomUUID()` only after confirmed terminal response or form payload change that represents a new deliberate action.

- [ ] **Step 6: Run focused tests**

Run: `npx vitest run tests/owner-broadcast-domain.test.ts tests/owner-broadcast-idempotency.test.ts tests/phase-6-route-source.test.ts`

Expected: PASS.

- [ ] **Step 7: Checkpoint**

Run: `git diff --check -- supabase/migrations/20260824009000_broadcast_idempotency.sql src/lib/owner-broadcast-domain.ts src/lib/owner-broadcast.server.ts src/routes/super-admin/broadcast.tsx tests/owner-broadcast-domain.test.ts tests/owner-broadcast-idempotency.test.ts`

Expected: no whitespace errors. Do not stage or commit.

### Task 5: Expose owner logout

- [ ] **Step 1: Write failing owner shell test**

Assert shell imports `logout`, renders button in shared `Navigation`, clears owner query cache, invalidates router, closes sheet, and shows alert on failure.

- [ ] **Step 2: Run red test**

Run: `npx vitest run tests/owner-shell-source.test.ts tests/super-admin-route.test.ts`

Expected: FAIL because no logout control exists.

- [ ] **Step 3: Implement logout action**

Pass async `onLogout` into shared navigation. Disable during request. On `{ok:true}`, clear owner-prefixed queries or query client, close menu, then `router.invalidate()`. Catch shows `role="alert"`; do not redirect or claim success when clearing cookie fails.

- [ ] **Step 4: Run focused tests**

Run: `npx vitest run tests/owner-shell-source.test.ts tests/super-admin-route.test.ts tests/auth-super-admin.test.ts`

Expected: PASS.

- [ ] **Step 5: Checkpoint**

Run: `git diff --check -- src/routes/super-admin/route.tsx tests/owner-shell-source.test.ts tests/super-admin-route.test.ts`

Expected: no whitespace errors. Do not stage or commit.

### Task 6: Auth/delivery verification checkpoint

- [ ] **Step 1: Run focused aggregate**

Run: `npx vitest run tests/auth-super-admin.test.ts tests/auth-rate-limit-remediation.test.ts tests/restaurants-server.test.ts tests/restaurant-code-server.test.ts tests/use-remote-crew.test.ts tests/owner-broadcast-domain.test.ts tests/owner-broadcast-idempotency.test.ts tests/owner-shell-source.test.ts`

Expected: PASS.

- [ ] **Step 2: Review security boundary diff**

Search for new grants to `anon`/`authenticated`, password/token logging, swallowed catches, skipped tests, and rule suppressions. Expected: none outside intentional authenticated crew RPC grant already specified.

- [ ] **Step 3: Run full tests**

Run: `npm test`

Expected: all tests PASS; exact count may increase but no test file disappears.
