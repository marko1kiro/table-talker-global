# Multi-Restaurant Audit Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix every Critical, Important, and actionable Minor finding from audit of phases 1–5 before Phase 6 or any merge to `main`.

**Architecture:** Tenant identity must be derived from trusted server-side crew session data, while owner-only APIs require `requireSuperAdmin()`. Catalog mutation becomes atomic and versioned; browser sync caches per tenant and playback consumes verified cached audio. Large audio uploads use short-lived presigned R2 PUT URLs instead of JSON byte arrays. Tests move from source regex checks toward executable domain and PostgreSQL integration coverage where practical.

**Tech Stack:** TanStack Start server functions, Supabase/PostgreSQL, TypeScript, Vitest, IndexedDB/Cache Storage, AWS SDK S3 presigning, Cloudflare R2.

---

### Task 1: Repair tenant-scoped RPCs and crew uniqueness

**Files:**
- Create: `supabase/migrations/20260823100000_fix_tenant_rpcs.sql`
- Test: `tests/tenant-rpc-fixes.test.ts`

- [ ] Write failing migration tests proving `create_remote_command` derives `restaurant_id` from target crew, `create_crew_message` derives tenant instead of accepting it, stale cleanup is tenant-scoped, and online-name uniqueness uses `(restaurant_id, normalized_name)`.
- [ ] Run `npm test -- tests/tenant-rpc-fixes.test.ts`; expect failures against missing migration.
- [ ] Add migration that drops obsolete RPC overloads/index, recreates tenant-safe RPCs, and revokes obsolete execution rights.
- [ ] Update `src/lib/remote-audio.server.ts` calls to corrected signatures.
- [ ] Run focused tests and `npx tsc --noEmit`.
- [ ] Commit `fix: repair tenant-scoped realtime RPCs`.

### Task 2: Lock down service-role server functions and manifest RLS

**Files:**
- Create: `supabase/migrations/20260823101000_lock_manifest_rls.sql`
- Modify: `src/lib/restaurants.server.ts`
- Modify: `src/lib/manifest.server.ts`
- Modify: `src/lib/operational-errors.server.ts`
- Modify: `src/lib/playback-events.server.ts`
- Test: `tests/server-authorization.test.ts`

- [ ] Write failing authorization tests requiring owner auth for restaurant listing, manifest admin listing/mutation, error listing/resolution, and history cleanup.
- [ ] Write failing migration test rejecting global authenticated manifest reads.
- [ ] Run focused tests; expect failures.
- [ ] Add `requireSuperAdmin()` to owner-only handlers and remove broad authenticated manifest policy/grant.
- [ ] Keep telemetry ingestion public only through bounded, tenant-session-verified handlers from Task 3.
- [ ] Run focused tests and typecheck.
- [ ] Commit `fix: enforce owner authorization and manifest isolation`.

### Task 3: Replace universal PIN with tenant-bound signed crew session

**Files:**
- Create: `supabase/migrations/20260823102000_restaurant_pin_hash.sql`
- Create: `src/lib/tenant-session.server.ts`
- Modify: `src/lib/restaurant-domain.ts`
- Modify: `src/lib/restaurants.server.ts`
- Modify: `src/components/CrewIdentityDialog.tsx`
- Modify: `src/lib/crew-session-identity.ts`
- Test: `tests/tenant-session.test.ts`

- [ ] Write failing tests proving PIN is never exported/displayed, login validates restaurant-specific hash, and successful login returns a signed tenant session token.
- [ ] Run focused tests; expect failures.
- [ ] Add `pin_hash` with explicit pilot backfill from server secret, plus failed-attempt/rate-limit fields or bounded server-side attempt tracking.
- [ ] Validate PIN server-side with constant-time comparison and issue signed token containing restaurant ID and expiry.
- [ ] Store token in crew identity; remove universal PIN and UI disclosure.
- [ ] Run focused tests and typecheck.
- [ ] Commit `fix: secure tenant login with scoped sessions`.

### Task 4: Verify telemetry tenant identity and correct queue lifecycle

**Files:**
- Modify: `src/lib/playback-events.server.ts`
- Modify: `src/lib/operational-errors.server.ts`
- Modify: `src/lib/event-flush.ts`
- Modify: `src/lib/event-queue.ts`
- Modify: `src/routes/index.tsx`
- Test: `tests/telemetry-security.test.ts`
- Test: `tests/event-flush.test.ts`

- [ ] Write failing tests proving caller-supplied restaurant/crew identity is ignored, actual crew session ID is recorded, callbacks use current identity, queue drains multiple batches, failures remain queued, and pagehide uses `sendBeacon` or keepalive transport.
- [ ] Run focused tests; expect failures.
- [ ] Validate tenant session token server-side and derive restaurant/session fields before inserts; make `restaurant_id` non-null for playback events.
- [ ] Expose actual claimed crew session ID to client identity registration result.
- [ ] Fix callback dependencies/ref usage, queue sorting, bounded drain loop, and pagehide transport.
- [ ] Record `played` on browser `playing`; preserve failed event details without claiming completion semantics.
- [ ] Run focused tests and typecheck.
- [ ] Commit `fix: secure and reliably flush telemetry`.

### Task 5: Make catalog mutation atomic and current-version-only

**Files:**
- Create: `supabase/migrations/20260823103000_catalog_version_rpc.sql`
- Modify: `src/lib/manifest.server.ts`
- Modify: `src/lib/restaurants.server.ts`
- Modify: `src/routes/super-admin.tsx`
- Test: `tests/catalog-versioning.test.ts`

- [ ] Write failing tests proving one RPC atomically increments restaurant version and writes/toggles catalog state, and manifest fetch returns only current active items without duplicate audio IDs.
- [ ] Run focused tests; expect failures.
- [ ] Add transactional PostgreSQL RPC for catalog mutation and current-version projection.
- [ ] Replace separate upsert/toggle/delete/bump calls with one guarded mutation and check every result.
- [ ] Return catalog version from crew manifest endpoint.
- [ ] Run focused tests and typecheck.
- [ ] Commit `fix: make catalog updates atomic and versioned`.

### Task 6: Replace JSON uploads with presigned R2 uploads

**Files:**
- Modify: `package.json`
- Modify: `src/lib/r2.server.ts`
- Replace: `src/lib/upload.server.ts`
- Modify: `src/routes/super-admin.tsx`
- Test: `tests/r2-upload.test.ts`

- [ ] Write failing tests proving upload request enforces MP3 MIME/size/audio-ID policy and returns short-lived presigned PUT URL without receiving file bytes.
- [ ] Run focused tests; expect failures.
- [ ] Add AWS S3 request presigner, strict metadata validation, immutable hash key, and explicit non-NotFound handling for `HeadObject`.
- [ ] Upload browser file directly to R2 using signed URL, compute SHA-256 locally, then call atomic catalog mutation after successful PUT.
- [ ] Remove byte-array server payload path.
- [ ] Run focused tests, typecheck, and build.
- [ ] Commit `fix: use bounded direct R2 uploads`.

### Task 7: Play verified tenant audio from per-tenant cache

**Files:**
- Modify: `src/lib/audio-sync.ts`
- Modify: `src/components/SyncDialog.tsx`
- Modify: `src/routes/index.tsx`
- Test: `tests/audio-sync.test.ts`
- Test: `tests/cached-playback.test.ts`

- [ ] Write failing tests proving cache keys include restaurant ID, stale sync runs cannot unlock a new tenant, failure IDs are unique, unavailable browser crypto/cache blocks sync, and playback resolves audio IDs only from verified cache after mandatory sync.
- [ ] Run focused tests; expect failures.
- [ ] Namespace cache metadata/keys per restaurant and use monotonic run ID or AbortController.
- [ ] Return object URLs or cached responses for playback and revoke object URLs on stop/unmount.
- [ ] Remove bundled tenant playback path after successful tenant login; no network fallback before sync succeeds.
- [ ] Add active-session catalog-version check and optional update notification.
- [ ] Run focused tests, typecheck, and build.
- [ ] Commit `fix: play synchronized tenant audio from cache`.

### Task 8: Add real migration/security verification and final audit

**Files:**
- Create or modify focused tests under `tests/`
- Preserve unrelated `src/routeTree.gen.ts` and `supabase/.temp/`

- [ ] Apply migrations to local/temporary PostgreSQL where available and execute corrected RPCs with two restaurants.
- [ ] Prove tenant A cannot read/write tenant B manifests, sessions, messages, commands, telemetry, or errors.
- [ ] Run `npm test`, `npx tsc --noEmit`, and `npm run build`.
- [ ] Inspect `git status` and `git diff`; exclude unrelated generated/temp changes.
- [ ] Request fresh read-only audit and fix all Critical/Important findings.
- [ ] Push only `feat/restaurants-phase1`; do not merge or push `main` without explicit user permission.
