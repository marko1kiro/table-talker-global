# Super Admin: Purge Restaurant Test Data (Tombol Sakti) — Design Spec

**Date:** 2026-09-07  
**Status:** Approved

## Summary
Add a safe test/operational data purge button in Super Admin restaurant details (`/super-admin/restaurants/$id`). This wipes transient testing residue (active crew, table occupancy status, occupancy transitions, escort intents, scan events, playback logs, crew messages, operational errors) for a specific restaurant, without touching master data (restaurants, manager accounts, audio manifests, dynamic QR tokens).

## Decisions
- Scope: Per-restaurant basis (`p_restaurant_id`)
- Placement: Dedicated "Zona Bahaya / Reset Data Testing" card in `/super-admin/restaurants/$id.tsx`
- Confirmation safety: Modal requiring typing `RESET` before enabling execution
- Realtime sync: Bump `table_occupancy_revisions` so all connected clients immediately refresh to empty state

## Safe Deletion Scope vs Preserved Data

### Deleted (Transient / Testing Data only):
- `public.table_occupancy_state` (where restaurant_id = target)
- `public.occupancy_transitions` (where restaurant_id = target)
- `public.table_escort_intents` (where restaurant_id = target)
- `public.qr_scan_events` (where restaurant_id = target)
- `public.pending_qr_scans` (where restaurant_id = target)
- `public.qr_scan_debounce` (where restaurant_id = target)
- `public.role_session_tokens` (where role_session_id in crew_role_sessions of target)
- `public.role_session_pin_attempts` (where restaurant_id = target)
- `public.crew_role_sessions` (where restaurant_id = target)
- `public.crew_session_tokens` (where crew_session_id in crew_sessions of target)
- `public.crew_sessions` (where restaurant_id = target)
- `public.playback_events` (where restaurant_id = target)
- `public.crew_messages` (where restaurant_id = target)
- `public.remote_commands` (where restaurant_id = target)
- `public.operational_errors` (where restaurant_id = target)

### Preserved (STRICTLY UNTOUCHED):
- `public.restaurants` (Restaurant identity, name, code, pin_hash, credentials)
- `public.manager_accounts` (Manager accounts, email, password hash, status)
- `public.audio_manifests` (Soundboard configuration)
- `public.qr_export_batches` & `public.qr_table_tokens` (Physical printed QR tokens)

## Technical Architecture
1. **Migration / RPC**: `public.super_admin_purge_restaurant_test_data(p_restaurant_id uuid)`
   - Security Definer with public/anon revoked, granted to authenticated/service_role.
   - Cleans all transient tables atomically in a single transaction.
   - Bumps `table_occupancy_revisions` so live screens update immediately.
2. **Server Function**: `purgeRestaurantTestData` in `src/lib/admin-restaurants.server.ts`
   - Validates super-admin access / server caller and invokes RPC.
3. **UI**: In `src/routes/super-admin/restaurants/$id.tsx`
   - Danger zone card with "Reset Data Testing" button.
   - Modal dialog with text input ("Ketik 'RESET' untuk konfirmasi").
   - Triggers server function with loading feedback and query invalidation.
