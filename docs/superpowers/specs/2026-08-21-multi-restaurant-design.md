# Table Talker Multi-Restaurant Design

## Goal

Convert Table Talker from one restaurant into one centrally managed multi-restaurant application. One owner admin manages tenants, audio, usage history, operational errors, and restaurant-targeted messages. Crew keeps simple soundboard access.

## Architecture

Use one codebase, domain, Vercel deployment, Supabase project, and Cloudflare R2 bucket. Tenant isolation lives in database rows and RLS, not separate deployments. Every operational table carries `restaurant_id`; queries and Realtime channels are tenant-scoped.

Vercel serves UI and lightweight APIs. Supabase handles tenant metadata, sessions, manifests, events, errors, and Realtime. R2 Standard serves public-read immutable audio objects. Production commercial rollout requires Vercel Pro; Hobby remains development/pilot only.

## Restaurants and Crew Access

`restaurants` stores manual unique case-insensitive code, name, active status, required deactivation reason, and catalog version. Minimum create fields are name, code, and active status.

Crew enters restaurant code, formal global PIN `123456`, and crew name. The restaurant code selects the tenant and is not treated as strong authentication. Session lasts until 00:00 Asia/Jakarta and must be renewed daily. Browser audio cache survives session expiry and logout.

Disabling a restaurant immediately invalidates active sessions, blocks the soundboard, and displays the admin's free-text reason.

## Audio Catalog

Table-number audio 1–100 is global. Base announcement button names/categories are global, but each restaurant maps those buttons to its own audio files. Restaurants may also have additional buttons containing name, category, MP3, and active status. Tenant buttons appear after base buttons in their category. Disabling a button removes it after synchronization while preserving file metadata and history.

R2 objects use immutable version/hash paths. Supabase stores button metadata, R2 URL/key, content hash, byte size, active state, ordering source, and catalog version. R2 is public-read; upload/delete credentials remain server-side. Admin catalog changes increment the restaurant catalog version.

## Mandatory Audio Synchronization

After crew login, show a blocking dialog explaining that internet is required for “Sinkronisasi Audio.” No cancel action exists. Soundboard remains inaccessible until every active manifest item is cached and verified.

Flow:

1. Fetch small restaurant manifest.
2. Compare manifest hashes against Cache Storage metadata.
3. Download only missing or changed files with two or three concurrent requests.
4. Display total progress such as `43/106 audio` and human labels such as `Menyiapkan audio Nomor Meja 43`.
5. Verify response, byte size, and content hash before marking ready.
6. Remove obsolete cache entries only after new catalog is fully valid.
7. Unlock soundboard at 100%.

Each file retries automatically up to three times. After failure, dashboard stays locked, backend receives an operational error record, UI shows a human message and report code, and **Coba Lagi** resumes failed files only. Closing the app preserves completed cache work; next login resumes.

During an active session, a new catalog version produces an optional **Audio baru tersedia** notification. Crew may synchronize immediately. Any ignored update becomes mandatory at next daily login. Admin may force a catalog version change per restaurant.

Cache persists across days and crew sessions. Browser eviction is supported by re-downloading missing files. Audio playback reads cached assets; R2 network fallback is not used until a required synchronization succeeds.

## Usage History

Record an audio event when browser emits `playing`. Event contains idempotency ID, restaurant, audio/button ID and label snapshot, timestamp, crew/session, device metadata, and status. Playback failures use the same event model with bounded error details.

Events queue in IndexedDB and flush when any condition is met:

- 10 events collected;
- 30 seconds elapsed;
- page enters `pagehide`, using `sendBeacon` where available.

Backend accepts batches idempotently, preventing duplicate rows on retry. Failed sends stay queued. History retention is 30 days with automatic cleanup and tenant-time indexes.

## Operational Error Logging

Capture operational failures only: tenant login, sync/cache, playback, Realtime, R2 upload, RPC, and server failures. Store restaurant when known, report code, stage, safe technical detail, device/session context, occurrence time, and resolved state. Do not collect secrets or raw credentials. Retain errors for 30 days.

Admin dashboard displays unresolved-error badge, searchable list, and details. No email, WhatsApp, or Telegram notification in this phase.

## Admin Panel

Keep existing single-password owner login for now. Replace Super Admin remote-audio role with central owner admin. Routes/menu:

1. Dashboard
2. Resto
3. Audio
4. Riwayat
5. Error Log
6. Broadcast

Restaurant list shows active status, online devices, catalog version, latest sync failure, and audio plays today. Detail pages manage tenant identity/status, catalog mappings, tenant-specific buttons, and history.

Remove admin remote-audio controls. Preserve messages, but target one selected restaurant and deliver to every active crew device in that restaurant.

## Reliability and Security

RLS must prove restaurant isolation for manifests, sessions, events, errors, and broadcasts. Service-role and R2 write credentials remain server-only. Rate-limit tenant login, usage batches, error reports, and broadcasts. Use bounded payload sizes and allowlisted error fields.

Realtime channels are restaurant-scoped. Health dashboard checks database, Realtime, R2 access, deployment/API health, synchronization failures, and unresolved errors. Aggregated dashboard queries avoid scanning raw event tables.

## Capacity Model

For 10 restaurants, 10 new devices per restaurant per day, and a 7–10 MB catalog, initial synchronization transfers about 21–30 GB/month directly from R2. R2 egress is free; estimated request volume remains far below the Standard free tier of 10 million Class B reads/month.

Audio clicks do not consume Vercel transfer because playback uses Cache Storage. Vercel handles app loads, login/session validation, manifests, batched usage events, operational errors, and admin APIs. At 100 plays/device/day, 10 restaurants generate 300,000 events/month but roughly 30,000 batch requests at ten events per request.

## Migration Strategy

Preserve current soundboard behavior while introducing tenant boundaries:

1. Add restaurant model and backfill existing data into `KAMPUNG-BULU` tenant.
2. Add daily tenant session and RLS boundaries.
3. Add R2 manifest and mandatory synchronization without changing visible button layout.
4. Add batched usage/error telemetry.
5. Replace admin remote audio with tenant dashboard and restaurant-targeted broadcast.
6. Expand global table catalog from 70 to 100.

Each phase must remain deployable and test cross-tenant denial before rollout.

## Acceptance Criteria

- Crew cannot enter soundboard until complete verified catalog synchronization.
- Cached unchanged files are not downloaded again after daily login.
- Restaurant A cannot read or receive Restaurant B manifest, events, errors, sessions, or messages.
- Disabling tenant immediately blocks active devices with admin reason.
- Base announcement UI stays consistent while files differ by restaurant.
- Restaurant-only buttons affect only that restaurant.
- Usage event becomes successful at browser `playing` and reaches history through idempotent batching.
- Admin can identify sync and operational failures by report code.
- Retention cleanup removes history and error rows older than 30 days.
