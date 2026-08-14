# Crew Session Continuity Design

## Goal

Preserve a crew's identity across refreshes in the same browser tab, keep recently active crew visible in Super Admin for three hours, and allow remote playback only when the target has a live Realtime subscription and fresh audio readiness.

## Scope

- Restore crew name and anonymous Supabase identity after a same-tab refresh.
- Do not ask for the crew name again after a normal refresh.
- Do not persist identity across a closed tab, new tab, or restarted browser session.
- Require a fresh user gesture to restore audio readiness after refresh.
- Show recently active but offline crew in Super Admin for three hours.
- Disable remote audio controls unless the selected target is currently online and audio-ready.
- Reconnect presence when a backgrounded or locked device returns to the foreground.
- Preserve the existing five-second command TTL and no-retry/no-replay behavior.

Not included:

- Guaranteed JavaScript execution, Realtime connectivity, or audio playback while a mobile browser is backgrounded, suspended, or screen-locked.
- Push notifications, service-worker audio, native mobile wrappers, or Bluetooth detection.
- Cross-tab identity sharing.
- Replaying commands missed while offline.

## Browser Session Persistence

Use `sessionStorage`, not `localStorage`, for both crew identity and Supabase anonymous authentication persistence.

The stored crew value contains only the validated display name and normalized name. It does not contain dashboard authorization, Super Admin authorization, audio readiness, command IDs, or arbitrary server data.

Supabase browser auth uses a custom storage adapter backed by `sessionStorage`, with session persistence and token refresh enabled. This retains the anonymous user ID across refreshes in the same tab. A new tab receives separate storage and therefore asks for a crew name.

Storage access is wrapped in safe reads and writes. Invalid JSON, malformed names, missing browser storage, storage exceptions, expired tokens, or revoked anonymous sessions must not crash or block the soundboard.

## Refresh Flow

On initial authenticated dashboard render:

1. Read the crew identity from `sessionStorage`.
2. Validate it using the existing shared name normalization rules.
3. If valid, initialize the crew identity immediately and skip the name popup.
4. Restore the Supabase anonymous auth session for the same tab.
5. Reclaim/update the same database crew row through the existing `auth.uid()`-bound claim RPC.
6. Register Realtime presence when the tab is visible.

If stored identity is absent or invalid, preserve the existing name popup flow. A successful `LANJUT!!` stores the validated identity for the current tab.

If Supabase is unavailable, the restored crew identity still skips the popup and the manual soundboard remains usable. Remote status becomes unavailable without blocking local playback.

## Audio Readiness After Refresh

Audio readiness is never persisted. Browser autoplay permission is treated as page-lifetime state.

After refresh with a restored name:

- The soundboard opens immediately.
- The crew registers with `audio_ready = false`.
- A visible `Aktifkan Suara` button asks for a fresh user gesture.
- That gesture unlocks the same persistent audio element used by local and remote playback.
- Only after successful unlock does the next heartbeat publish `audio_ready = true`.

Until then, Super Admin sees the crew but cannot select it for remote playback.

## Presence States

The server/admin snapshot classifies each crew row into one of three states:

- `online`: connection is `connected`, visibility is `visible`, Realtime has subscribed, audio readiness is reported separately, and `last_seen` is no older than thirty seconds.
- `recent`: not currently online, but `last_seen` is no older than three hours.
- `expired`: `last_seen` is older than three hours and the row is omitted from the admin snapshot.

The three-hour window affects visibility in the admin list only. It never makes an offline crew eligible for remote commands.

When a tab becomes hidden, pagehide fires, Realtime fails, or cleanup runs, the client sends a best-effort disconnected heartbeat. If the browser is suspended before that request completes, freshness expiry still moves the row from `online` to `recent` after thirty seconds.

When the tab becomes visible again, the client reconnects/re-subscribes, sends a fresh connected heartbeat only after Realtime is subscribed, and becomes selectable again only after audio readiness is true.

## Super Admin UI

The target section displays:

- Online, audio-ready crew as selectable targets.
- Online crew with audio not ready as visible but disabled, labelled `Aktifkan suara di perangkat`.
- Recently active crew as visible but disabled, labelled with relative or absolute `last_seen` and `Offline / terakhir aktif`.

Recently active rows remain visible for up to three hours. They cannot be selected, and an already selected target is cleared synchronously if it becomes recent, stale, hidden, disconnected, or audio-not-ready.

All table and announcement controls remain disabled unless the selected crew remains `online + audio-ready` and the Super Admin Realtime channel is subscribed. Server-side `create_remote_command` eligibility validation remains authoritative against race conditions.

## Data and Cleanup

No new table is required. Existing `crew_sessions.last_seen`, connection state, visibility, and audio readiness support the classification.

Stale command cleanup remains seven days. Crew rows may be retained in the database beyond three hours, but snapshots omit them. Optional database cleanup may delete very old crew rows later; it is not required for this feature.

Online-name uniqueness remains enforced for `connecting` and `connected` rows. A restored same-tab anonymous user updates its existing row. A genuinely different tab/device cannot claim the same currently reserved name. Stale reservations remain reclaimable under the existing thirty-second cleanup rules.

## Security and Privacy

- Dashboard and Super Admin authorization remain signed HttpOnly server cookies.
- `sessionStorage` contains only the crew display identity and Supabase anonymous auth session.
- Anonymous token capabilities remain constrained by RLS and narrow RPC grants.
- No service-role key or privileged authorization enters browser storage.
- Closing the tab clears the intended browser-session identity boundary.

## Error Handling

- Invalid stored identity: remove it and show the name popup.
- Storage unavailable: use in-memory identity; refresh may ask again, but the app remains functional.
- Anonymous session expired/revoked: create a new anonymous session; if the saved name is still reserved by the old UID, surface the duplicate-name state and let the stale reservation expire after thirty seconds.
- Realtime unavailable: classify remote state offline, disable remote controls, retain manual soundboard.
- Audio unlock fails: keep `audio_ready = false`, show the recovery control, and do not make the target selectable.
- Background command delivery: discard expired/missed commands without retry or replay.

## Testing

Automated tests cover:

- Valid session identity round-trip and same-tab hydration.
- Invalid/malformed storage removal and safe fallback.
- New tab semantics through isolated `sessionStorage` adapters.
- Supabase auth configuration uses session-scoped persisted storage and token refresh.
- Refresh restores the same anonymous user ID and reclaims the same crew row.
- Restored identity skips the name popup while audio readiness starts false.
- Fresh audio unlock changes readiness to true.
- Online classification at thirty seconds, recent classification through three hours, and omission after three hours.
- Recently active targets remain visible but cannot be selected or receive commands.
- Selected targets clear synchronously when no longer online/audio-ready.
- Foreground return re-subscribes before publishing connected presence.
- No command retry or replay after background/reconnect.
- Supabase/storage failures remain fail-open for manual soundboard use.

Verification runs the full test suite, TypeScript check, lint, and production build. Manual Android Chrome and iOS Safari checks cover refresh, tab close/new tab, screen lock/background, foreground return, audio reactivation, admin last-active display, and successful remote playback after reconnection.
