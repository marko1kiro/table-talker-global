# Phase 6 Super Admin Design

## Goal

Replace the pre-Phase-6 remote-audio admin page with a central owner console for operating every restaurant. Phase 6 includes Dashboard, Resto, Audio, Riwayat, Error Log, and Broadcast. Existing crew soundboard behavior and tenant isolation remain unchanged.

## Scope

Phase 6 delivers the complete owner console described by the multi-restaurant design. It does not include security-audit remediation unrelated to enabling these features. Existing single-password Super Admin authentication remains in place for now.

The owner console must support:

- operational health across infrastructure and restaurants;
- restaurant lifecycle and credential management;
- complete restaurant audio catalogs, including `table:*`, `announcement:*`, and `custom:*` items;
- playback, broadcast, and synchronization history;
- operational error review and resolution;
- text broadcast to one restaurant or every restaurant.

## Information Architecture

`/super-admin` becomes a protected layout with a desktop sidebar and mobile drawer. It contains six child sections:

1. Dashboard
2. Resto
3. Audio
4. Riwayat
5. Error Log
6. Broadcast

Restaurant detail uses a dedicated route at `/super-admin/restaurants/$id`. Dedicated routes keep each feature independently loadable, testable, and linkable. The application will not add a global client state store. Shared state is limited to authentication layout concerns and reusable filter, status, loading, empty, and error components.

The old crew-targeted remote-audio grid, crew selector, and remote-command audit are removed from the owner console. `SoundboardGrid` remains a crew-side component.

## Authorization and Tenant Boundaries

Every loader-equivalent server function and mutation calls `requireSuperAdmin()` before reading or changing owner data. Restaurant-specific operations require an explicit restaurant ID and scope every query or RPC to that ID. Cross-tenant denial remains covered by server and database tests.

Client input never determines authorization. Restaurant filters only select among server-authorized data. Service-role and R2 credentials remain server-only.

## Dashboard

Dashboard presents independent health and operational summaries:

- database connectivity;
- Supabase Realtime connectivity;
- R2 access;
- application API/deployment health;
- total and active restaurants;
- active crew devices;
- audio plays today;
- latest synchronization failures;
- unresolved operational errors.

Each infrastructure check has its own result and timeout. One failed dependency does not block unrelated cards or sections. Snapshot queries remain usable when Realtime is unavailable; Realtime is an enhancement for invalidation, not a prerequisite for console operation.

Aggregates use bounded server queries or dedicated RPCs instead of loading raw event tables into the browser. Dashboard cards link to the relevant filtered section.

## Restaurants

The restaurant list displays:

- display name;
- active/inactive state;
- online device count;
- catalog version;
- latest synchronization failure;
- audio plays today.

Owner actions include create, view credential, rotate credential, and deactivate. Destructive actions require explicit confirmation and display server validation errors safely.

Restaurant detail at `/super-admin/restaurants/$id` contains:

- identity and active state;
- credential actions;
- current crew devices and presence;
- catalog summary and mappings;
- recent playback, synchronization, and error history.

Existing restaurant and credential server functions are reused where they already satisfy these rules. Missing list aggregates and detail data are added through focused owner-only server functions.

## Audio

Audio management starts with a restaurant selector and supports all catalog item types:

- `table:*`;
- `announcement:*`;
- `custom:*`.

Owner can upload, create or update metadata, activate or deactivate, reorder, and delete catalog items. Upload keeps current presigned R2 flow, SHA-256 verification, immutable object paths, and versioned catalog mutation.

Custom items require an allowlisted ID, label, category, MP3, active state, and ordering value. Every successful catalog mutation increments the selected restaurant's catalog version. UI shows mutation progress and leaves the previous valid catalog intact when upload or verification fails.

## History

History combines three operational views:

- playback events;
- broadcasts and delivery outcomes;
- synchronization activity and failures.

Default time range is seven days. Owner may filter any range up to the retained 30 days. Filters include restaurant, event type, status, and bounded text search where supported. Results are paginated and sorted newest first.

Retention remains 30 days. Phase 6 must provide or wire an automatic cleanup path for playback events and operational errors older than 30 days; browser visits are not the cleanup scheduler.

## Error Log

Error Log displays searchable operational errors with filters for restaurant, stage, report code, time range, and resolved state. Details show safe technical context only; secrets and raw credentials remain excluded.

Owner can mark an error resolved and optionally add a resolution note. Resolution records resolver context and timestamp. A resolved item remains visible through filters until retention cleanup removes it.

Application flow uses structured result codes for new Phase 6 server functions. UI does not branch on mutable database error wording.

## Broadcast

Broadcast sends text messages to active crew devices. It supports two scopes:

- one selected restaurant;
- all active restaurants.

A single-restaurant broadcast resolves eligible active crew sessions for that restaurant and creates one delivery command per target device. An all-restaurants broadcast resolves targets per active restaurant and uses the same delivery operation.

Before sending to all restaurants, UI displays a preview containing restaurant and device counts. Owner must type exactly `BROADCAST SEMUA`. Server independently validates scope, bounded message length, eligibility, and confirmation.

Batch execution is best-effort across restaurants. Failure in one restaurant does not roll back successful delivery to others. Result reports success and failure counts per restaurant and exposes no tenant secrets. Broadcast rate limits and bounded batch size protect the endpoint.

## Data Flow and Invalidation

Each section follows:

1. validate request input;
2. require Super Admin authentication;
3. execute a tenant-scoped query or mutation;
4. write required audit or delivery records;
5. return a structured result;
6. invalidate or refetch affected snapshots.

Realtime channels trigger bounded refetches. Polling remains available for operational views. Channel failure changes health state but does not disable loaded controls whose mutations can still reach the server.

## Error Handling

Server functions return stable error codes and safe messages for expected failures. Unexpected failures receive a report code and enter operational error logging. UI provides loading, empty, partial-data, retry, and mutation-failure states per section.

Health and broadcast use partial-success models. Infrastructure check failures remain isolated. Broadcast results distinguish delivered, rejected, expired, and failed targets where current command data permits it.

## Testing

Testing includes:

- unit tests for validators, filters, dashboard aggregation, custom audio IDs, broadcast scope, and exact all-restaurants confirmation;
- server tests for owner authorization, tenant isolation, restaurant aggregates, partial broadcast failure, resolution notes, and seven-to-thirty-day filtering;
- component or route tests for sidebar and mobile drawer navigation, loading/error/empty states, restaurant detail, and destructive confirmations;
- catalog tests for all three audio item types, version increments, upload failure, activation, ordering, and deletion;
- build regression tests proving server imports are bundled for Vercel;
- serial full test, typecheck, lint when configured, and production build verification.

## Acceptance Criteria

Phase 6 is complete when:

- owner can navigate all six sections on desktop and mobile;
- Dashboard reports DB, Realtime, R2, API/deployment, sync, and unresolved-error health independently;
- restaurant list and detail expose required status, device, catalog, and activity data;
- owner can manage `table:*`, `announcement:*`, and `custom:*` catalog items per restaurant;
- History defaults to seven days and can query retained data through 30 days;
- owner can resolve operational errors with an optional note;
- owner can broadcast to one restaurant or all active restaurants;
- all-restaurants broadcast requires preview and exact `BROADCAST SEMUA` confirmation;
- partial broadcast failure is visible per restaurant without undoing successful deliveries;
- old Super Admin remote-audio controls are removed;
- cross-tenant access remains denied;
- retention cleanup removes playback and error rows older than 30 days;
- focused tests, full tests, typecheck, configured lint, and production build pass.
