# Restaurant Code Login Design

## Goal

Replace legacy public restaurant-code and shared-PIN login with `Kode Resto`: a per-restaurant dashboard credential. It selects and authorizes one tenant. It is never a public slug, URL identifier, display name, or client-readable field.

Crew flow is `Kode Resto` -> crew name -> mandatory audio synchronization -> soundboard. Existing tenant/crew access is invalid after code rotation.

This design supersedes Phase 1 assumptions in `2026-08-21-multi-restaurant-design.md` and `2026-08-22-multi-restaurant-phase1.md` about `restaurants.code`, case-insensitive matching, global PIN `123456`, and the `KAMPUNG-BULU` backfill.

## Credential Contract

`Kode Resto` is 6 through 32 ASCII characters from `A-Z` and `0-9`. Input is exact and case-sensitive: lowercase, whitespace, punctuation, Unicode lookalikes, empty values, and values outside this length range fail validation. Clients do not trim, uppercase, normalize, or otherwise transform input.

Codes are unique by an HMAC-SHA256 lookup digest of their exact UTF-8 value. The database never stores plaintext code or an unkeyed SHA digest. An attacker who obtains database rows cannot test guessed credentials without `RESTAURANT_CODE_ENCRYPTION_KEY`.

Wrong, inactive, revoked, expired, malformed, rate-limited, and unavailable-code lookups return client message exactly `Kode Resto salah.`. This prevents restaurant enumeration and inactive-state disclosure. Detailed reasons remain server-side audit/operational records without credential values.

The approved pilot credential is provisioned by release operator from secret-manager input. It is deliberately not repeated in this Git-tracked document, migrations, seed SQL, tests, build logs, or command history. Release owner verifies deployed pilot credential against approved secure record.

## Data Model

Replace `restaurants.code` with these fields:

| Field | Purpose |
| --- | --- |
| `code_hash text not null unique` | Versioned HMAC-SHA256 lookup digest, encoded as `hmac-sha256:v1:<base64url-digest>`. |
| `code_encrypted text not null` | Versioned AES-256-GCM ciphertext, encoded as `aes-256-gcm:v1:<base64url-nonce>:<base64url-ciphertext>:<base64url-tag>`. |
| `code_version integer not null default 1` | Monotonic credential generation. Bumped only when code changes. |
| `credential_rotated_at timestamptz not null` | Rotation/revocation audit boundary. |

Keep `id`, `display_name`, `is_active`, catalog fields, and non-credential audit fields. Drop legacy `code`, its `lower(code)` index, `TENANT_PIN`, and all public-code semantics.

`code_hash` uses HMAC-SHA256 with a key derived from `RESTAURANT_CODE_ENCRYPTION_KEY` using HKDF-SHA256 and purpose `table-talker/restaurant-code-lookup/v1`. `code_encrypted` uses a separately derived 32-byte AES key with purpose `table-talker/restaurant-code-encryption/v1`. Create restaurant UUID before encrypting. Each encryption uses a fresh cryptographic 96-bit nonce and authenticated additional data containing immutable `restaurant_id` plus ciphertext format version. Decryption must reject unsupported versions, invalid encoding, nonce/tag sizes, and failed GCM authentication.

`RESTAURANT_CODE_ENCRYPTION_KEY` exists only in server/runtime secret configuration. It must be 32 random bytes represented as base64url. Never expose it as `VITE_*`, browser payload, database setting, SQL migration literal, telemetry field, error text, audit field, test fixture, or log value.

## Server Boundaries

Credential cryptography and lookup run only in server functions using Node `crypto`; browser code submits raw input only over HTTPS. No database RPC accepts `Kode Resto`, decrypts it, or computes lookup hashes. Service-role server code queries a restaurant by `code_hash`, verifies `is_active`, and creates tenant access state only after success.

Create owner-only server operations:

| Operation | Behavior |
| --- | --- |
| Create restaurant | Validate code, derive hash/ciphertext, insert fields, audit `restaurant.created` without value. |
| View restaurant code | Require super-admin session, decrypt server-side, return plaintext only to authenticated dashboard response, audit `restaurant.code_viewed` without value. Response uses no-store caching. |
| Change restaurant code | Validate new code and uniqueness, atomically replace hash/ciphertext, increment `code_version`, set rotation time, revoke tenant and crew sessions, audit `restaurant.code_rotated` without value. |

Owner dashboard must not persist code in localStorage, sessionStorage, URL, client logs, analytics, error reports, or query cache after dialog close. Display fields use password-style control with explicit reveal action. Browser request/response and CDN cache headers are `Cache-Control: no-store` for view/create/change operations.

Create an audit table or existing audit stream entries with actor ID, restaurant ID, operation, timestamp, request/correlation ID, and success/failure reason category. Do not record plaintext, lookup hash, ciphertext, length, partial value, or derived fingerprint. Audit retention follows existing admin-audit policy; if none exists, retain 90 days.

## Crew Login And Session Revocation

1. Crew enters exact `Kode Resto`.
2. Server validates format, rate-limits attempt, computes keyed lookup digest, finds active tenant, and issues short-lived opaque tenant access token bound to `restaurant_id` and current `code_version`.
3. Browser asks for crew name only after token issuance.
4. Crew-session claim requires valid tenant token plus matching current `code_version`; it creates/updates tenant-scoped crew state.
5. Mandatory audio sync starts after crew session claim. Soundboard stays blocked until sync completes.

Tenant access tokens and crew session tokens carry `restaurant_id`, `code_version`, expiry, and a random opaque token hash stored server-side. RPC authorization verifies all four plus active tenant state. Existing SHA-256 token hashes may remain separate from credential lookup hashes; they are random bearer-token verifiers, not human credential verifiers.

Code rotation revokes access atomically: delete or mark invalid all `restaurant_access_tokens` and `crew_session_tokens` for tenant; disconnect/deactivate live `crew_sessions`; invalidate tenant-scoped Realtime subscriptions; increment `code_version`. Every API/RPC checks token existence and current code version, so cached browser state cannot continue use. Client receives generic login failure, clears tenant/crew session storage and audio-sync run state, stops playback, and returns to code screen. Cached audio files may remain because they contain no credential and require new login before use.

Restaurant deactivation follows same revocation path and client message `Kode Resto salah.`. It does not reveal deactivation reason to crew.

## Migration And Deployment

No migration, seed, fixture, Git-tracked document, or CI variable contains plaintext credential.

1. Deploy server code capable of reading both legacy and new schema only for owner maintenance; keep crew login on existing path until all restaurant rows have encrypted credentials.
2. Apply additive migration: add nullable `code_hash`, `code_encrypted`, `code_version`, and rotation fields; add uniqueness constraint on `code_hash`; add token `code_version` fields and indexes. Do not backfill from `restaurants.code` in SQL.
3. Release operator sets `RESTAURANT_CODE_ENCRYPTION_KEY` in deployment secret manager before enabling code provisioning. Key is generated once, retained securely, and backed up through approved secret-management recovery process. Loss makes existing ciphertext undecryptable and requires owner credential resets.
4. Run authenticated server-only provisioning job for each restaurant. Operator supplies code through protected runtime prompt or secret reference; process encrypts/hashes in memory, writes only derived values, validates readback, and emits value-free audit records. Provision approved pilot credential this way.
5. Verify owner code view, valid/invalid crew login, tenant isolation, session rotation, and telemetry redaction in staging. Then enable new crew login feature flag.
6. After monitored production rollout, remove old crew code/PIN UI and APIs, revoke all legacy tokens, drop legacy `code` column and `lower(code)` index, remove `KAMPUNG-BULU` record/semantics, and delete `TENANT_PIN` code/tests/docs.

Deployment fails closed if encryption key is absent, malformed, wrong length, or cannot decrypt a sampled existing row. Do not fall back to legacy code, plaintext storage, unkeyed hash, or a generated replacement key.

## Errors, Abuse, And Security

Server validates credential format before database access but returns generic failure. Apply per-IP and per-client bounded login rate limits with server-side audit category `rate_limited`; client still sees `Kode Resto salah.`. Use constant-shape failure handling: lookup one HMAC digest, avoid an active/inactive branch response difference, and keep response body/status identical for all credential failures.

Unexpected crypto, database, or session failures return generic client failure and create sanitized operational error records. Never log request body, headers containing bearer tokens, raw code, derived code fields, or decrypted value. Owner-only operations return actionable generic admin errors such as `Kode Resto tidak dapat disimpan.` without revealing database/crypto internals.

Use parameterized database queries, service-role only on server, existing super-admin authorization, CSRF protection consistent with current owner mutations, and no-store responses. Rotation requires recent super-admin authorization before mutation. Owner UI confirms restaurant display name and requires re-entry of new code before change; no old code is requested or displayed during rotation.

## Tests

Unit tests cover exact format acceptance/rejection; no case conversion; distinct HMAC purposes; deterministic lookup digest for same key/input; different digest for changed key/input; AES round trip; fresh nonce creates distinct ciphertext; tampered/version-invalid ciphertext rejects; and plaintext never appears in error/audit serializers.

Server tests cover create uniqueness, owner authorization, encrypted storage only, code view authorization/no-store response, generic crew failures for wrong/inactive/malformed/rate-limited cases, rate-limit behavior, and no credential fields in logs/telemetry.

Integration tests cover crew flow through sync gate, cross-tenant denial, active token acceptance, rotation invalidating old tenant/crew tokens and Realtime claims, forced return to login, new-code login success, and deactivation using same generic failure.

Migration tests inspect final schema for absence of legacy `code`, lower-case index, global PIN, `KAMPUNG-BULU`, plaintext inserts, and public credential read paths. Staging deployment test provisions an ephemeral credential through runtime secret injection, then scans SQL output, application logs, audit rows, and telemetry payloads for its value before cleanup.

## Rollback

Before destructive legacy-column removal, rollback disables new login flag and restores prior application release; no code value is recoverable from derived fields without key. Additive-schema rollback leaves new columns unused and preserves encrypted values.

After new login activation, do not restore public-code/PIN authentication. If incident affects new auth, disable crew login, revoke affected tenant tokens, repair key/configuration, and require owner code rotation. If encryption key compromise is suspected, rotate deployment key through controlled re-encryption while old key remains available only for migration, then revoke all tenant/crew sessions and rotate every restaurant credential.

## Self-Review

- No `TODO`, `TBD`, sample credential, plaintext SQL, or Git-tracked credential value remains in this spec.
- `Kode Resto` means credential everywhere; restaurant identity uses immutable UUID and display name, never code.
- Exact uppercase input and HMAC lookup match: no normalization creates hidden aliases.
- AES-GCM is for owner display; keyed HMAC is for indexed lookup. Both keys derive separately from one server secret.
- Code rotation and deactivation both invalidate tenant and crew access, with generic crew errors.
- Scope is one credential-login replacement. Audio catalog, broader tenant UI, and unrelated route tree changes remain out of scope.
