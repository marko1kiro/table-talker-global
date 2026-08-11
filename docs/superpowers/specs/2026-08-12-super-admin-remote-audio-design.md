# Super Admin Remote Audio Design

## Goal

Add an optional Super Admin control panel that can play an existing bundled soundboard audio item on one selected crew browser. The current login and local soundboard must continue working normally when Supabase is unavailable.

## Scope

- Identify crew browsers by a crew-provided display name.
- Show foreground crew sessions online in real time.
- Let Super Admin select one online crew session and one existing soundboard audio item.
- Deliver one short-lived playback command and report `sent`, `played`, `failed`, or `expired`.
- Retain command audit records for seven days.

Not included:

- Detecting Bluetooth or speaker connection state.
- Background playback when the tab is hidden, the browser is suspended, or the screen is locked.
- Uploading or playing ad hoc audio from the Super Admin panel.
- Retrying commands after reconnect or Supabase recovery.
- Replacing existing authentication, bundled audio catalog, or manual soundboard playback with Supabase.

## Architecture

The existing TanStack Start application remains authoritative for authentication, route access, the bundled audio catalog, and manual playback. Supabase adds only presence, remote command delivery, acknowledgement, and audit persistence.

The browser uses the Supabase anonymous key for allowed presence and acknowledgement operations under Row Level Security. The Supabase service-role key is server-only and must never enter the client bundle. Super Admin command creation runs through a protected server function or API endpoint after validating the dedicated Super Admin session.

Supabase failure is fail-open for the existing application. Crew can still log in, browse, and manually play bundled audio. Remote controls display a clear `Realtime offline` state and cannot send commands until realtime service recovers.

## Authentication and Roles

Add a `super-admin` authentication path protected by a dedicated environment-variable password. It is separate from the existing dashboard credential. The password is verified server-side and produces an HTTP-only session with the same security properties as current sessions.

Only an authenticated Super Admin server request may create a remote command. Client-side role claims are never sufficient authorization.

Crew retains the existing restaurant-code login. After successful code entry and clicking `GASSSS!`, the application asks: `Bentar, tolong isi nama kamu dulu ya!`. Clicking `LANJUT!!` performs the audio-unlock gesture and registers the crew session.

## Crew Identity and Presence

A crew session has:

- A generated opaque session ID.
- A trimmed display name.
- Basic device/browser description.
- Audio readiness status.
- Connection state and `last_seen` timestamp.
- A visibility/foreground indicator.

Display names are unique only among online sessions. Name acquisition must be atomic on the server/database so two browsers cannot claim the same normalized name concurrently. Comparison is case-insensitive and ignores surrounding whitespace. Empty or invalid names are rejected with a user-facing message. A name becomes reusable after its previous session is offline.

The browser sends a heartbeat every ten seconds while connected and visible. A session is eligible as online only when it is foreground-capable and its last heartbeat is no older than thirty seconds. Closing, disconnecting, hiding, or browser suspension may update presence immediately when possible; the thirty-second timeout remains authoritative.

Multiple crew sessions may remain online. A newly registered session does not disable older sessions. Super Admin explicitly selects the intended target.

## Audio Readiness

`LANJUT!!` is the required user gesture used to initialize or unlock browser audio. The implementation should prepare the same playback mechanism used by local soundboard controls without producing audible output.

Android Chrome and iOS Safari are primary targets. Browser policy can still reject later programmatic playback. When that occurs, the crew receives a visible `Aktifkan Suara` recovery control and the command acknowledgement becomes `failed`. Manual soundboard playback remains available.

Remote playback is foreground-only. The system does not promise playback from a hidden tab, suspended browser, locked screen, or terminated browser.

## Command Flow

1. Super Admin views online sessions with crew name, device/browser, `last_seen`, and audio readiness.
2. Super Admin selects exactly one eligible crew session and one item from the existing audio catalog.
3. The server validates the Super Admin session, target eligibility, and audio identifier.
4. The server creates a unique command with target session ID, audio identifier, creation time, and an expiry five seconds later.
5. The target receives the command through Supabase Realtime.
6. The browser verifies the target session ID, command ID, and expiry before playback.
7. A valid command plays once. Playback follows current behavior: a new audio item stops the previous item.
8. The browser records `played` after playback starts successfully or `failed` with a bounded error reason.
9. If no successful handling occurs within five seconds, the command is shown as `expired`.

Each browser keeps processed command IDs for the active session. Duplicate delivery is ignored. Commands received after expiry are discarded and never played. Reconnect does not fetch or replay pending commands. There is no retry after service recovery, preventing delayed unexpected audio.

If two commands arrive close together, server creation time and unique IDs establish order. The newest valid command may replace current playback; an older command must never interrupt a newer one.

## Data Model

The exact SQL names may follow repository conventions, but responsibilities are:

### Crew Sessions

Stores session ID, normalized unique-online name, display name, device information, audio readiness, visibility, connection state, and heartbeat timestamps. Database constraints or transactional functions enforce atomic online-name claims.

### Remote Commands

Stores command ID, target session ID, validated audio identifier, creator identity, creation/expiry timestamps, status, acknowledgement timestamp, and bounded failure reason.

### Audit Retention

Command records provide the seven-day audit history: actor, target crew, audio, timestamps, and result. A scheduled cleanup deletes records older than seven days. Cleanup failure must not affect playback or the existing application.

## Row Level Security

RLS defaults to deny.

- Anonymous crew clients may create/update only their own session through narrowly scoped database functions or signed session credentials.
- Crew clients may observe only commands targeted to their session.
- Crew clients may acknowledge only their targeted, unexpired command and may set only permitted terminal statuses.
- Crew clients cannot create commands, inspect other crew sessions, list audit history, or assign themselves Super Admin privileges.
- Super Admin reads presence and audit data through authenticated server endpoints.
- Service-role access exists only in server runtime environment variables.

All payloads are schema-validated at trust boundaries. Audio commands reference an existing catalog item; arbitrary URLs and arbitrary client-provided audio are rejected.

## User Interface

### Crew Login

- Preserve restaurant-code input and `GASSSS!` action.
- On valid code, show the crew-name popup.
- Validate empty, malformed, and currently-online duplicate names.
- `LANJUT!!` unlocks audio and attempts realtime registration.
- If Supabase is unavailable, show that remote control is unavailable but allow entry to the normal soundboard.
- Show audio-readiness recovery only when needed.

### Super Admin

- Dedicated login route using the separate environment password.
- Online session list updates in real time.
- Each row shows crew name, device/browser summary, freshness, foreground eligibility, and audio readiness.
- Audio selector contains only the existing soundboard catalog.
- Play requires an explicit selected target and audio.
- Recent command status updates from `sent` to `played`, `failed`, or `expired`.
- Audit view covers the last seven days.
- Supabase outage produces a clear offline state and disables Play without affecting other routes.

## Error Handling

- Realtime connection failure: mark remote features offline; retain normal app behavior.
- Duplicate online name: reject registration with a clear prompt to choose another name.
- Stale or hidden target: reject server command creation or expire it without playback.
- Invalid audio ID: reject server-side.
- Autoplay failure: acknowledge `failed`, expose `Aktifkan Suara`, retain manual controls.
- Duplicate command: ignore without replay.
- Expired command: discard and report `expired`.
- Acknowledgement failure after local playback: do not replay audio; UI may show delivery uncertainty rather than retrying.
- Cleanup failure: preserve records until the next cleanup; never block commands.

## Verification

Automated checks should cover:

- Dedicated Super Admin authentication and route protection.
- RLS denial for command creation and cross-session reads by crew clients.
- Atomic, case-insensitive online-name uniqueness.
- Name reuse after a session becomes offline.
- Heartbeat every ten seconds and eligibility expiry after thirty seconds.
- Five-second command TTL.
- Target, audio ID, and payload validation.
- Duplicate delivery and reconnect do not replay audio.
- Newer commands cannot be interrupted by older commands.
- `played`, `failed`, and `expired` transitions.
- Supabase outage leaves login and the bundled manual soundboard operational.

Manual device verification should cover current Android Chrome and iOS Safari:

- `LANJUT!!` audio initialization.
- Foreground remote playback through the connected output device.
- Hidden tab, screen lock, suspension, reconnect, and autoplay rejection behavior.
- Manual soundboard operation during Supabase unavailability.

## Deployment Constraints

The application remains deployable on Vercel Hobby because it does not host a persistent WebSocket server. Supabase owns realtime connections and database persistence. Vercel handles the existing application plus short-lived authenticated server requests.

Required production secrets must be stored in Vercel environment variables, including dedicated Super Admin credentials and Supabase server credentials. Public Supabase project URL and anonymous key may be client-visible; RLS is therefore mandatory. Existing fallback credentials must not be relied upon in production.

Supabase free-tier limits and inactivity policies are external operational constraints. Their exhaustion or suspension disables only presence and remote control, not the existing soundboard application.
