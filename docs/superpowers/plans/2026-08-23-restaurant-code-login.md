# Restaurant Code Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace public restaurant-code and shared-PIN login with exact, encrypted `Kode Resto` credentials that authorize one tenant and revoke all tenant/crew access on rotation or deactivation.

**Architecture:** Node server functions validate exact ASCII code input, derive independent HKDF HMAC lookup and AES-GCM encryption keys from one server-only base64url secret, then use service-role database access for lookup and owner maintenance. Opaque random tenant and crew tokens remain server-verifiable rows bound to `restaurant_id`, `code_version`, and expiry; SQL RPCs enforce that binding. Crew enters only `Kode Resto`, claims name session, completes sync, then reaches soundboard; owner UI creates, reveals, and rotates credentials without browser persistence or caches.

**Tech Stack:** TypeScript, Node `crypto`, TanStack Start, React 19, Zod, Supabase/PostgreSQL SQL migrations and RPCs, Vitest, Vercel, secret manager.

---

## File Map

- Create: `src/lib/restaurant-code.server.ts` - exact validation, base64url key parsing, HKDF derivation, versioned HMAC lookup digest, AES-256-GCM encryption/decryption, redacted audit serializer.
- Create: `src/lib/restaurant-session.server.ts` - random opaque token issuance/hash/verification, generic invalidation result, no signed browser payload.
- Create: `src/lib/restaurant-audit.server.ts` - `serializeRestaurantCredentialAudit`, value-free server audit writes, and sanitized operational error writes.
- Create: `src/components/RestaurantCredentialDialog.tsx` - owner create/view/rotate credential dialog; controlled code fields cleared on close.
- Create: `scripts/provision-restaurant-code.mjs` - interactive server-only provisioning/readback job using runtime environment and protected stdin.
- Create: `supabase/migrations/20260823110000_restaurant_code_credentials_additive.sql` - additive credential/token schema, audit table, version-bound RPCs, revocation RPC, indexes and RLS grants.
- Create: `supabase/migrations/20260823120000_remove_legacy_restaurant_code.sql` - post-rollout destructive removal of legacy code/PIN/public semantics.
- Create: `tests/restaurant-code.test.ts` - crypto and validation unit tests.
- Create: `tests/restaurant-code-server.test.ts` - server function source/behavior tests, response cache and redaction tests.
- Create: `tests/restaurant-code-migration.test.ts` - final schema/legacy-removal migration contract tests.
- Create: `tests/restaurant-code-crew-flow.test.ts` - component/session/sync-gate source-contract tests.
- Create: `tests/restaurant-code-provisioning.test.ts` - provisioning script and pilot-secret hygiene tests.
- Modify: `src/lib/restaurants.server.ts` - credential login, owner create/view/rotate/deactivate operations, no-store headers, audit calls.
- Modify: `src/lib/tenant-session.server.ts` - remove PIN and signed-token helpers; delegate token verification to opaque version-bound session helpers.
- Modify: `src/lib/restaurant-domain.ts` - remove normalization; export exact format validation only.
- Modify: `src/lib/crew-session-identity.ts` - remove `restaurantCode`, retain UUID/display name/tokens only, clear invalid sessions.
- Modify: `src/components/CrewIdentityDialog.tsx` - one exact `Kode Resto` field, then crew-name step only after tenant token response.
- Modify: `src/routes/index.tsx` - handle revoked-session callback by stopping playback, clearing session/audio-sync state, and returning to code entry.
- Modify: `src/hooks/use-remote-crew.ts` - propagate claim/version/revocation failures to parent and dispose Realtime channel.
- Modify: `src/routes/super-admin.tsx` - identify restaurants by display name/UUID, host credential owner controls, do not render credentials in lists.
- Modify: `.env.example` - document `RESTAURANT_CODE_ENCRYPTION_KEY` shape and server-only restriction without value/example secret.
- Modify: `README.md` - replace dashboard/PIN/public-code setup and rollout text with credential, provisioning, key recovery, and deployment verification instructions.
- Modify: existing tests that assert removed PIN/public-code behavior: `tests/restaurants.test.ts`, `tests/restaurants-server.test.ts`, `tests/tenant-session.test.ts`, `tests/crew-session-identity.test.ts`, `tests/auth-telemetry-hardening.test.ts`, `tests/tenant-rpc-fixes.test.ts`, `tests/use-remote-crew.test.ts`.

### Task 1: Exact Credential Contract

**Files:**
- Create: `tests/restaurant-code.test.ts`
- Modify: `src/lib/restaurant-domain.ts`

- [ ] **Step 1: Write failing format tests using generated non-pilot values**

```ts
import { expect, it } from "vitest";
import { validateRestaurantCode } from "../src/lib/restaurant-domain";

const code = (suffix = "") => `${"A".repeat(6 - suffix.length)}${suffix}`;

it("accepts exact uppercase ASCII codes from six through thirty-two characters", () => {
  expect(validateRestaurantCode(code())).toEqual({ code: code() });
  expect(validateRestaurantCode("A".repeat(32))).toEqual({ code: "A".repeat(32) });
});

it("rejects transformed and malformed values without returning input", () => {
  for (const value of ["a".repeat(6), ` ${code()}`, `${code()} `, "A".repeat(5), "A".repeat(33), "A-BBBB", "A_BBBB", "AＡBBBB", ""]) {
    expect(validateRestaurantCode(value)).toEqual({ error: "Kode Resto salah." });
  }
});
```

- [ ] **Step 2: Run red test**

Run: `npm test -- tests/restaurant-code.test.ts`

Expected: FAIL because `validateRestaurantCode` does not exist and legacy normalization accepts transformed input.

- [ ] **Step 3: Replace normalization with exact validation**

```ts
const RESTAURANT_CODE_PATTERN = /^[A-Z0-9]{6,32}$/;

export function validateRestaurantCode(value: string): { code: string } | { error: string } {
  return RESTAURANT_CODE_PATTERN.test(value) ? { code: value } : { error: "Kode Resto salah." };
}
```

Remove `normalizeRestaurantCode`; no caller may trim, uppercase, normalize, or echo credential input.

- [ ] **Step 4: Run green test**

Run: `npm test -- tests/restaurant-code.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit contract slice**

```bash
git add src/lib/restaurant-domain.ts tests/restaurant-code.test.ts
git commit -m "feat: validate exact restaurant codes"
```

### Task 2: Server-Only Credential Cryptography

**Files:**
- Modify: `tests/restaurant-code.test.ts`
- Create: `src/lib/restaurant-code.server.ts`

- [ ] **Step 1: Add failing crypto and redaction tests**

```ts
import {
  decryptRestaurantCode,
  encryptRestaurantCode,
  hashRestaurantCode,
  parseRestaurantCodeEncryptionKey,
  redactCredentialAudit,
} from "../src/lib/restaurant-code.server";

const key = Buffer.alloc(32, 7).toString("base64url");
const code = "Z".repeat(6);
const restaurantId = "00000000-0000-4000-8000-000000000001";

it("derives deterministic keyed lookup hashes with separate purposes", () => {
  const parsed = parseRestaurantCodeEncryptionKey(key);
  expect(hashRestaurantCode(code, parsed)).toMatch(/^hmac-sha256:v1:[A-Za-z0-9_-]{43}$/);
  expect(hashRestaurantCode(code, parsed)).toBe(hashRestaurantCode(code, parsed));
  expect(hashRestaurantCode(`${code}A`, parsed)).not.toBe(hashRestaurantCode(code, parsed));
  expect(hashRestaurantCode(code, parseRestaurantCodeEncryptionKey(Buffer.alloc(32, 8).toString("base64url")))).not.toBe(hashRestaurantCode(code, parsed));
});

it("encrypts with fresh nonce and authenticates restaurant identity", () => {
  const parsed = parseRestaurantCodeEncryptionKey(key);
  const first = encryptRestaurantCode(code, restaurantId, parsed);
  const second = encryptRestaurantCode(code, restaurantId, parsed);
  expect(first).toMatch(/^aes-256-gcm:v1:/);
  expect(first).not.toBe(second);
  expect(decryptRestaurantCode(first, restaurantId, parsed)).toBe(code);
  expect(() => decryptRestaurantCode(first, "00000000-0000-4000-8000-000000000002", parsed)).toThrow("INVALID_CREDENTIAL_CIPHERTEXT");
});

it("rejects malformed, unsupported, and tampered ciphertext without credential disclosure", () => {
  const parsed = parseRestaurantCodeEncryptionKey(key);
  const encrypted = encryptRestaurantCode(code, restaurantId, parsed);
  for (const value of ["aes-256-gcm:v2:x:y:z", encrypted.slice(0, -1) + "A", "bad"]) {
    expect(() => decryptRestaurantCode(value, restaurantId, parsed)).toThrow("INVALID_CREDENTIAL_CIPHERTEXT");
  }
  expect(JSON.stringify(redactCredentialAudit({ code, code_hash: "hash", code_encrypted: "cipher", reason: "failed" }))).toBe('{"reason":"failed"}');
});
```

- [ ] **Step 2: Run red test**

Run: `npm test -- tests/restaurant-code.test.ts`

Expected: FAIL because server crypto module does not exist.

- [ ] **Step 3: Write minimal server crypto module**

Use only `node:crypto`: `hkdfSync("sha256", baseKey, Buffer.alloc(0), Buffer.from(purpose), 32)`, `createHmac("sha256", lookupKey)`, `randomBytes(12)`, `createCipheriv("aes-256-gcm", encryptionKey, nonce)`, and `createDecipheriv`. Parse base64url into exactly 32 bytes. Use AAD `restaurant_id:${restaurantId};format:aes-256-gcm:v1`. Encode each field base64url. Throw only `new Error("INVALID_CREDENTIAL_CIPHERTEXT")` for every decrypt parser/authentication failure. Export redactor which removes `code`, `code_hash`, `code_encrypted`, `credential`, `token`, and bearer-like fields recursively before serialization.

- [ ] **Step 4: Run green test**

Run: `npm test -- tests/restaurant-code.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit crypto slice**

```bash
git add src/lib/restaurant-code.server.ts tests/restaurant-code.test.ts
git commit -m "feat: encrypt restaurant code credentials"
```

### Task 3: Additive Schema And Version-Bound Revocation

**Files:**
- Create: `tests/restaurant-code-migration.test.ts`
- Create: `supabase/migrations/20260823110000_restaurant_code_credentials_additive.sql`

- [ ] **Step 1: Write failing additive migration contract tests**

```ts
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const sql = readFileSync(new URL("../supabase/migrations/20260823110000_restaurant_code_credentials_additive.sql", import.meta.url), "utf8");

it("adds derived credential fields without SQL plaintext backfill", () => {
  expect(sql).toMatch(/add column code_hash text/i);
  expect(sql).toMatch(/add column code_encrypted text/i);
  expect(sql).toMatch(/add column code_version integer not null default 1/i);
  expect(sql).toMatch(/add column credential_rotated_at timestamptz/i);
  expect(sql).toMatch(/unique.*code_hash|code_hash.*unique/is);
  expect(sql).not.toMatch(/insert into public\.restaurants.*code/is);
  expect(sql).not.toMatch(/update public\.restaurants.*set.*code_hash/is);
});

it("binds opaque token rows and RPC authorization to current credential version", () => {
  expect(sql).toMatch(/restaurant_access_tokens[\s\S]*code_version integer not null/i);
  expect(sql).toMatch(/crew_session_tokens[\s\S]*code_version integer not null/i);
  expect(sql).toMatch(/create function public\.revoke_restaurant_credentials/i);
  expect(sql).toMatch(/delete from public\.restaurant_access_tokens/i);
  expect(sql).toMatch(/delete from public\.crew_session_tokens/i);
  expect(sql).toMatch(/connection_state = 'disconnected'/i);
  expect(sql).toMatch(/rat\.code_version = r\.code_version/i);
});
```

- [ ] **Step 2: Run red test**

Run: `npm test -- tests/restaurant-code-migration.test.ts`

Expected: FAIL because additive credential migration does not exist.

- [ ] **Step 3: Create additive migration**

Write idempotent additive SQL only. Add nullable `code_hash`, `code_encrypted`, `code_version integer not null default 1 check (code_version >= 1)`, and nullable `credential_rotated_at`; unique index on non-null `code_hash`; indexes `(restaurant_id, code_version, expires_at)` for both token tables. Add `code_version` initially nullable to token tables, backfill from joining restaurant IDs only, then set `not null`. Create `restaurant_credential_audit` with actor UUID nullable, restaurant UUID, operation constrained to credential lifecycle operations, request ID, success flag, reason category, `created_at`, 90-day cleanup function, RLS enabled, all client grants revoked.

Replace `claim_crew_session` and every token-gated RPC with versions that require token hash, row expiry, restaurant active state, and equality between token `code_version` and `restaurants.code_version`. Create `revoke_restaurant_credentials(p_restaurant_id uuid, p_next_code_version integer, p_reason text)` as `security definer`: lock restaurant row, reject non-monotonic version, update version/rotation timestamp, delete tenant and crew tokens, set matching live crew sessions disconnected, and return void. Do not accept code values or compute code hashes in SQL. Keep existing public legacy code column during this additive phase.

- [ ] **Step 4: Run green test**

Run: `npm test -- tests/restaurant-code-migration.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit schema slice**

```bash
git add supabase/migrations/20260823110000_restaurant_code_credentials_additive.sql tests/restaurant-code-migration.test.ts
git commit -m "feat: add versioned restaurant credentials"
```

### Task 4: Opaque Tenant And Crew Session Validation

**Files:**
- Modify: `tests/tenant-session.test.ts`
- Create: `src/lib/restaurant-session.server.ts`
- Modify: `src/lib/tenant-session.server.ts`

- [ ] **Step 1: Replace PIN/signed-token tests with failing opaque-token tests**

```ts
import { expect, it } from "vitest";
import { createOpaqueRestaurantToken, hashOpaqueRestaurantToken } from "../src/lib/restaurant-session.server";

it("creates random opaque bearer tokens whose hashes are independent of restaurant credentials", () => {
  const first = createOpaqueRestaurantToken();
  const second = createOpaqueRestaurantToken();
  expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(second).not.toBe(first);
  expect(hashOpaqueRestaurantToken(first)).toMatch(/^[a-f0-9]{64}$/);
  expect(hashOpaqueRestaurantToken(first)).not.toBe(hashOpaqueRestaurantToken(second));
});
```

- [ ] **Step 2: Run red test**

Run: `npm test -- tests/tenant-session.test.ts`

Expected: FAIL because opaque token module does not exist and PIN helpers still exist.

- [ ] **Step 3: Implement minimal opaque session helpers and delete legacy helpers**

Generate 32 random bytes and serialize base64url. Hash only random bearer tokens with SHA-256 hex. Implement `verifyActiveTenantSession(client, token)` and `verifyCrewSessionToken(client, token, restaurantId)` by querying token hash, expiry, row restaurant ID, active restaurant, and equal current `code_version`; return `{ restaurantId, codeVersion }` / `{ crewSessionId, restaurantId, codeVersion }` or `null`. Delete `hashRestaurantPin`, `verifyRestaurantPin`, signed `createTenantSession`, and `verifyTenantSession`; no fallback path.

- [ ] **Step 4: Run green test**

Run: `npm test -- tests/tenant-session.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit session slice**

```bash
git add src/lib/restaurant-session.server.ts src/lib/tenant-session.server.ts tests/tenant-session.test.ts
git commit -m "feat: bind restaurant sessions to code version"
```

### Task 5: Server Login, Owner Credential Operations, And Audit

**Files:**
- Create: `tests/restaurant-code-server.test.ts`
- Modify: `src/lib/restaurants.server.ts`
- Create: `src/lib/restaurant-audit.server.ts`

- [ ] **Step 1: Write failing server behavior tests**

```ts
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const source = readFileSync(new URL("../src/lib/restaurants.server.ts", import.meta.url), "utf8");

it("uses HMAC lookup and returns identical generic code failure for every crew failure", () => {
  expect(source).toContain("validateRestaurantCode(data.code)");
  expect(source).toContain("hashRestaurantCode(validated.code");
  expect(source).toContain('.eq("code_hash", codeHash)');
  expect(source).not.toContain('.ilike("code"');
  expect(source).not.toContain("verifyRestaurantPin");
  expect([...source.matchAll(/Kode Resto salah\./g)]).toHaveLength(1);
});

it("keeps owner credential handlers server-only, audited, and no-store", () => {
  for (const name of ["createRestaurant", "viewRestaurantCode", "changeRestaurantCode"]) expect(source).toContain(`export const ${name}`);
  expect(source).toContain("await requireSuperAdmin()");
  expect(source).toContain("encryptRestaurantCode");
  expect(source).toContain("decryptRestaurantCode");
  expect(source).toContain("writeRestaurantCredentialAudit");
  expect(source).toContain('"Cache-Control": "no-store"');
  expect(source).not.toMatch(/console\.(log|error).*code/i);
});
```

- [ ] **Step 2: Run red test**

Run: `npm test -- tests/restaurant-code-server.test.ts`

Expected: FAIL because current handlers use `ilike`, PIN, public code response, and lack owner code view/rotation handlers.

- [ ] **Step 3: Implement server operations with generic crew boundary**

Implement `loginToRestaurant({ code, clientKey })` behind server feature flag. Before flag activation preserve current crew flow only for rows not yet provisioned; after flag activation reject every legacy path. New path validates before DB; computes one HMAC digest regardless of malformed input by using a fixed-format sentinel internal value when validation fails; queries one row by `code_hash`; rate-limits by client hash and IP-derived server request key; records only reason category; returns exactly `{ error: "Kode Resto salah." }` on malformed/wrong/inactive/revoked/expired/rate-limited/unavailable/exception failures. On success insert one random opaque token hash with restaurant current `code_version` and short expiry, then return only `restaurantId`, `displayName`, and token.

Implement owner-only `createRestaurant({ displayName, code })`, `viewRestaurantCode({ restaurantId })`, `changeRestaurantCode({ restaurantId, displayNameConfirmation, code, codeConfirmation, recentAuthAt })`, and deactivation path. Create UUID before encryption. Create/change derive values server-side, use transaction/RPC for atomic duplicate-safe rotate + revoke, and audit success/failure categories with correlation ID only. Require matching display name and code confirmation; never ask for old code. View response and all owner mutations set no-store headers. Owner errors are `Kode Resto tidak dapat disimpan.` or `Kode Resto tidak dapat ditampilkan.`; generic crew result never exposes cause. `serializeRestaurantCredentialAudit` calls `redactCredentialAudit` before `JSON.stringify`; audit helper removes credential/token fields before any write/log.

- [ ] **Step 4: Add failing no-secret telemetry serializer test, then implement it**

```ts
it("never serializes credential material to audit or operational records", () => {
  expect(serializeRestaurantCredentialAudit({
    operation: "restaurant.code_rotated",
    reason: "duplicate",
    code: "Z".repeat(6),
    code_hash: "hmac-sha256:v1:value",
    code_encrypted: "aes-256-gcm:v1:value:value:value",
    tenantToken: "bearer-value",
  })).toBe('{"operation":"restaurant.code_rotated","reason":"duplicate"}');
});
```

Run: `npm test -- tests/restaurant-code-server.test.ts`

Expected: FAIL until `serializeRestaurantCredentialAudit` delegates to redaction before serialization.

- [ ] **Step 5: Run green server tests**

Run: `npm test -- tests/restaurant-code-server.test.ts tests/tenant-session.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit server slice**

```bash
git add src/lib/restaurants.server.ts src/lib/restaurant-audit.server.ts tests/restaurant-code-server.test.ts
git commit -m "feat: add restaurant code server auth"
```

### Task 6: Crew Code-Then-Name Flow And Forced Logout

**Files:**
- Create: `tests/restaurant-code-crew-flow.test.ts`
- Modify: `src/components/CrewIdentityDialog.tsx`
- Modify: `src/lib/crew-session-identity.ts`
- Modify: `src/routes/index.tsx`
- Modify: `src/hooks/use-remote-crew.ts`

- [ ] **Step 1: Write failing crew-flow tests**

```ts
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const source = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

it("collects exact Kode Resto before name without client transformation or PIN", () => {
  const dialog = source("src/components/CrewIdentityDialog.tsx");
  expect(dialog).toContain("Kode Resto");
  expect(dialog).not.toContain("toUpperCase");
  expect(dialog).not.toContain("PIN");
  expect(dialog).not.toContain("restaurantCode");
  expect(dialog).toContain("setStep(\"name\")");
});

it("blocks soundboard until sync and clears all tenant state when version-bound access fails", () => {
  const page = source("src/routes/index.tsx");
  expect(page).toContain("!audioSynced");
  expect(page).toContain("removeCrewSessionIdentity(browserSessionStorage())");
  expect(page).toContain("audioControllerRef.current?.stop()");
  expect(page).toContain("setAudioSynced(false)");
  const hook = source("src/hooks/use-remote-crew.ts");
  expect(hook).toContain("onSessionInvalid");
  expect(hook).toContain("client.removeChannel");
});
```

- [ ] **Step 2: Run red test**

Run: `npm test -- tests/restaurant-code-crew-flow.test.ts tests/crew-session-identity.test.ts tests/use-remote-crew.test.ts`

Expected: FAIL because dialog transforms code, asks for PIN, and persisted identity stores `restaurantCode`.

- [ ] **Step 3: Implement minimal crew state changes**

Remove PIN input and `restaurantCode` from dialog, identity type, serialization, and UI. Preserve raw code in React local state only until server response; clear it after submit result. On successful code lookup move to name step. Keep tenant token in `sessionStorage`, never localStorage; localStorage retains only non-secret client rate-limit key. Start audio unlock from name submit; keep `SyncDialog` mandatory and soundboard disabled until success.

Add `onSessionInvalid` to `useRemoteCrew`. Treat failed claim, heartbeat, command acknowledgement, manifest access, or server `INVALID_*` version/token results as invalid: stop heartbeat, remove channel, call parent callback. Parent stops audio, clears identity/session storage, audio-ready and sync state, cached available IDs, queued playback events, and returns dialog to code entry. Do not delete cached audio files.

- [ ] **Step 4: Run green crew tests**

Run: `npm test -- tests/restaurant-code-crew-flow.test.ts tests/crew-session-identity.test.ts tests/use-remote-crew.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit crew slice**

```bash
git add src/components/CrewIdentityDialog.tsx src/lib/crew-session-identity.ts src/routes/index.tsx src/hooks/use-remote-crew.ts tests/restaurant-code-crew-flow.test.ts tests/crew-session-identity.test.ts tests/use-remote-crew.test.ts
git commit -m "feat: require restaurant code crew login"
```

### Task 7: Owner Credential UI

**Files:**
- Create: `tests/restaurant-code-owner-ui.test.ts`
- Create: `src/components/RestaurantCredentialDialog.tsx`
- Modify: `src/routes/super-admin.tsx`

- [ ] **Step 1: Write failing owner UI tests**

```ts
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const ui = readFileSync(new URL("../src/components/RestaurantCredentialDialog.tsx", import.meta.url), "utf8");

it("uses password controls, explicit reveal, confirmation, and clears credential state on close", () => {
  expect(ui).toContain('type="password"');
  expect(ui).toContain("Tampilkan Kode Resto");
  expect(ui).toContain("displayNameConfirmation");
  expect(ui).toContain("codeConfirmation");
  expect(ui).toContain("setCode(\"\")");
  expect(ui).toContain("setViewedCode(\"\")");
  expect(ui).not.toContain("localStorage");
  expect(ui).not.toContain("sessionStorage");
});
```

- [ ] **Step 2: Run red test**

Run: `npm test -- tests/restaurant-code-owner-ui.test.ts`

Expected: FAIL because credential dialog does not exist.

- [ ] **Step 3: Implement owner dialog and list changes**

Create controlled dialog with create, view, and rotate modes. Create/rotate code fields use `type="password"`; reveal is explicit and local component state only. View calls server only when owner presses reveal, renders code in password-style control, uses `Cache-Control: no-store` server response, and clears field on close/unmount/mutation completion. Rotate displays restaurant display name, requires exact re-entry and new-code confirmation, then calls rotation server function with existing recent-auth signal; do not show/request old code. Disable submit while request pending. Refetch restaurant list after mutation. List restaurants by `display_name` and UUID, never `code`.

- [ ] **Step 4: Run green owner UI test**

Run: `npm test -- tests/restaurant-code-owner-ui.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit owner UI slice**

```bash
git add src/components/RestaurantCredentialDialog.tsx src/routes/super-admin.tsx tests/restaurant-code-owner-ui.test.ts
git commit -m "feat: manage restaurant credentials"
```

### Task 8: Provisioning, Key Configuration, And Pilot Setup

**Files:**
- Create: `tests/restaurant-code-provisioning.test.ts`
- Create: `scripts/provision-restaurant-code.mjs`
- Modify: `.env.example`
- Modify: `README.md`

- [ ] **Step 1: Write failing provisioning hygiene tests**

```ts
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

it("provisions from protected runtime input and never prints credential values", () => {
  const script = source("scripts/provision-restaurant-code.mjs");
  expect(script).toContain("RESTAURANT_CODE_ENCRYPTION_KEY");
  expect(script).toContain("readline/promises");
  expect(script).toContain("encryptRestaurantCode");
  expect(script).toContain("hashRestaurantCode");
  expect(script).not.toMatch(/console\.(log|error).*code/i);
});

it("documents server-only key rules without a credential or VITE exposure", () => {
  const env = source(".env.example");
  expect(env).toContain("RESTAURANT_CODE_ENCRYPTION_KEY=");
  expect(env).toContain("base64url");
  expect(env).not.toContain("VITE_RESTAURANT_CODE_ENCRYPTION_KEY");
  expect(`${env}\n${source("README.md")}`).not.toContain("KAMPUNG-BULU");
});
```

- [ ] **Step 2: Run red test**

Run: `npm test -- tests/restaurant-code-provisioning.test.ts`

Expected: FAIL because provisioning script and encrypted-key documentation do not exist; README has legacy setup.

- [ ] **Step 3: Implement provisioning and documentation**

Script accepts `--restaurant-id <uuid>` only, refuses non-TTY stdin unless `RESTAURANT_CODE_SECRET_REF` points to deployed secret-manager adapter, reads raw code with terminal echo disabled, validates it, loads service-role and encryption-key runtime env, derives/encrypts in memory, transactionally writes derived columns and audit row, reads row back, decrypts solely in memory to compare, then exits without printing code/hash/ciphertext. Fail closed on absent/malformed key, DB error, duplicate lookup hash, or failed readback. Never generate/rewrite key.

Document release operator workflow: generate one 32-byte base64url key in approved secret manager; configure it server-only before provisioning; run authenticated runtime job once per restaurant including approved pilot from secure record; verify only against secure record; no code values in command history, shell environment display, SQL, fixtures, logs, Git, or CI variables. Document key loss/reset and compromise re-encryption procedure. Remove all bundled-audio/PIN/public-code instructions that conflict with current app behavior.

- [ ] **Step 4: Run green provisioning test**

Run: `npm test -- tests/restaurant-code-provisioning.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit setup slice**

```bash
git add scripts/provision-restaurant-code.mjs .env.example README.md tests/restaurant-code-provisioning.test.ts
git commit -m "docs: add restaurant code provisioning"
```

### Task 9: Destructive Legacy Removal And Regression Tests

**Files:**
- Modify: `tests/restaurant-code-migration.test.ts`
- Modify: `tests/restaurants.test.ts`
- Modify: `tests/restaurants-server.test.ts`
- Modify: `tests/auth-telemetry-hardening.test.ts`
- Modify: `tests/tenant-rpc-fixes.test.ts`
- Create: `supabase/migrations/20260823120000_remove_legacy_restaurant_code.sql`

- [ ] **Step 1: Add failing final-schema regression tests**

```ts
it("removes all legacy public credential semantics after monitored rollout", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20260823120000_remove_legacy_restaurant_code.sql", import.meta.url), "utf8");
  expect(sql).toMatch(/drop index if exists public\.restaurants_code_key/i);
  expect(sql).toMatch(/drop column code/i);
  expect(sql).toMatch(/drop column pin_hash/i);
  expect(sql).not.toContain("KAMPUNG-BULU");
  expect(sql).not.toContain("TENANT_PIN");
});
```

- [ ] **Step 2: Run red tests**

Run: `npm test -- tests/restaurant-code-migration.test.ts tests/restaurants.test.ts tests/restaurants-server.test.ts tests/auth-telemetry-hardening.test.ts tests/tenant-rpc-fixes.test.ts`

Expected: FAIL because final removal migration and updated contracts do not exist.

- [ ] **Step 3: Create removal migration and update regressions**

Migration executes only after feature flag rollout and provisioning completion: revoke/delete legacy tenant sessions, drop legacy PIN functions/columns/indexes and any code-dependent policies/RPCs, drop `restaurants.code`, remove legacy seed semantics, and make `code_hash`, `code_encrypted`, and `credential_rotated_at` `not null`. Preserve derived credential values and current version-bound tokens only. Update old tests to assert absence of legacy names, `ilike`, case conversion, public credential selections, and plaintext migration inserts. Add static scan test covering `src`, `supabase/migrations`, `tests`, `.env.example`, and `README.md` for `TENANT_PIN`, old PIN RPCs, `KAMPUNG-BULU`, and `restaurants.code` references, except migration test assertions that deliberately check removed text.

- [ ] **Step 4: Run green tests**

Run: `npm test -- tests/restaurant-code-migration.test.ts tests/restaurants.test.ts tests/restaurants-server.test.ts tests/auth-telemetry-hardening.test.ts tests/tenant-rpc-fixes.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit legacy-removal slice**

```bash
git add supabase/migrations/20260823120000_remove_legacy_restaurant_code.sql tests/restaurant-code-migration.test.ts tests/restaurants.test.ts tests/restaurants-server.test.ts tests/auth-telemetry-hardening.test.ts tests/tenant-rpc-fixes.test.ts
git commit -m "feat: remove legacy restaurant login"
```

### Task 10: Integration, Deployment, And Rollback Verification

**Files:**
- Modify: `tests/restaurant-code-crew-flow.test.ts`
- Modify: `README.md`

- [ ] **Step 1: Add failing integration/source contracts for rotation and deactivation**

```ts
it("requires current version tokens for manifest, crew claim, remote, and playback APIs", () => {
  const server = source("src/lib/restaurants.server.ts");
  const session = source("src/lib/restaurant-session.server.ts");
  expect(server).toContain("verifyActiveTenantSession");
  expect(session).toContain("code_version");
  expect(source("src/hooks/use-remote-crew.ts")).toContain("onSessionInvalid");
});
```

- [ ] **Step 2: Run red test**

Run: `npm test -- tests/restaurant-code-crew-flow.test.ts`

Expected: FAIL until every tenant-scoped path uses version-bound checks and revocation callback.

- [ ] **Step 3: Add deployment runbook with exact verification gates**

Add README release checklist:

1. Deploy compatibility server release with crew feature flag off; apply additive migration using `npx supabase db push`.
2. Configure server-only key in secret manager; restart deployment; verify startup refuses absent/malformed key and sampled ciphertext decryption failure.
3. Run provisioning runtime job for each restaurant; provision pilot from approved secure record; inspect only value-free audit results.
4. Staging: verify owner create/view/rotate response `Cache-Control: no-store`; valid code reaches name then mandatory sync; malformed/wrong/inactive/rate-limited responses have identical status/body `Kode Resto salah.`; cross-tenant tokens/RPCs fail; rotation/deactivation removes old access/crew tokens, disconnects crew, invalidates Realtime, stops client audio, and new code succeeds.
5. Inject ephemeral generated staging code through protected runtime input. Scan SQL output, app logs, audit rows, telemetry payloads, browser storage, network cache headers, and build artifacts for value; require zero matches, then revoke/delete test tenant.
6. Enable flag after monitoring. Only then apply destructive removal migration. Roll back before removal by disabling flag and restoring prior release; after activation never restore public-code/PIN login, instead disable crew login, revoke sessions, repair config, and rotate affected credentials.

- [ ] **Step 4: Run green test and full verification**

Run: `npm test -- tests/restaurant-code-crew-flow.test.ts && npm test && npm run lint && npx tsc --noEmit && npm run build`

Expected: all commands exit 0. Build output contains no `RESTAURANT_CODE_ENCRYPTION_KEY`, pilot credential, legacy PIN, or public restaurant code.

- [ ] **Step 5: Inspect migration and secret hygiene**

Run: `rg -n --hidden --glob '!node_modules/**' --glob '!.git/**' 'KAMPUNG-BULU|TENANT_PIN|pin_hash|\.ilike\("code"|toUpperCase\(\).*code|RESTAURANT_CODE_ENCRYPTION_KEY=.*[^[:space:]]' src supabase tests README.md .env.example scripts`

Expected: no runtime legacy matches; only deliberate negative-test assertions may remain and must not contain a real credential.

- [ ] **Step 6: Commit verification/docs slice**

```bash
git add tests/restaurant-code-crew-flow.test.ts README.md
git commit -m "test: verify restaurant credential rollout"
```

### Task 11: Final Review And Integration Commit

**Files:**
- Modify: only files from Tasks 1-10

- [ ] **Step 1: Verify target test groups and full suite**

Run: `npm test -- tests/restaurant-code.test.ts tests/restaurant-code-server.test.ts tests/restaurant-code-migration.test.ts tests/restaurant-code-crew-flow.test.ts tests/restaurant-code-owner-ui.test.ts tests/restaurant-code-provisioning.test.ts`

Expected: PASS.

Run: `npm test && npm run lint && npx tsc --noEmit && npm run build`

Expected: all exit 0.

- [ ] **Step 2: Check spec coverage before merge**

Confirm all sections map to completed tasks: credential exactness/crypto (1-2), data and token schema (3-4), server boundaries/audit (5), crew/sync/revocation (6), owner UI (7), pilot/key setup (8), legacy removal (9), deployment/rollback (10). Confirm no plaintext credential is present in `git diff`, migrations, fixtures, tests, logs, or README.

- [ ] **Step 3: Review diff and stage intended files only**

Run: `git diff --check && git status --short && git diff -- docs/superpowers`

Expected: no whitespace errors; do not stage unrelated generated files or user changes.

- [ ] **Step 4: Create integration commit only if task commits were not created**

```bash
git add src/lib/restaurant-code.server.ts src/lib/restaurant-session.server.ts src/lib/restaurant-audit.server.ts src/lib/restaurants.server.ts src/lib/tenant-session.server.ts src/lib/restaurant-domain.ts src/lib/crew-session-identity.ts src/components/CrewIdentityDialog.tsx src/components/RestaurantCredentialDialog.tsx src/routes/index.tsx src/routes/super-admin.tsx src/hooks/use-remote-crew.ts scripts/provision-restaurant-code.mjs supabase/migrations/20260823110000_restaurant_code_credentials_additive.sql supabase/migrations/20260823120000_remove_legacy_restaurant_code.sql tests/restaurant-code.test.ts tests/restaurant-code-server.test.ts tests/restaurant-code-migration.test.ts tests/restaurant-code-crew-flow.test.ts tests/restaurant-code-owner-ui.test.ts tests/restaurant-code-provisioning.test.ts .env.example README.md
git commit -m "feat: replace restaurant login credential"
```

Do not amend/rebase/push. If task commits exist, omit this duplicate commit.

## Self-Review

- Spec coverage: all approved requirements map to Tasks 1-10. Encryption uses separate HKDF purposes, exact validation has no normalization, database lookup receives only HMAC digest, and AES-GCM uses UUID/version AAD. Owner operations, audit retention, no-store cache policy, rate limiting, generic client errors, rotation/deactivation revocation, audio-sync gate, pilot setup, staged deployment, destructive removal, and rollback all have explicit tasks.
- Placeholder scan: no deferred-work markers, sample/pilot credential, plaintext SQL credential, or unspecified test action appears. Generated test values are synthetic and never release credential values.
- Type consistency: `validateRestaurantCode`, `hashRestaurantCode`, `encryptRestaurantCode`, `decryptRestaurantCode`, `createOpaqueRestaurantToken`, `hashOpaqueRestaurantToken`, `verifyActiveTenantSession`, `verifyCrewSessionToken`, `writeRestaurantCredentialAudit`, and `onSessionInvalid` use same names across tasks. Token rows and RPCs consistently require `restaurant_id`, `code_version`, expiry, and opaque token hash.

Plan complete and saved to `docs/superpowers/plans/2026-08-23-restaurant-code-login.md`. Two execution options:

1. Subagent-Driven (recommended) - dispatch fresh subagent per task, review between tasks, fast iteration
2. Inline Execution - execute tasks in this session using executing-plans, batch execution with checkpoints
