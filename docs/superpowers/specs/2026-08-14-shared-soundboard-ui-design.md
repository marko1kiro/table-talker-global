# Shared Soundboard UI Design

## Goal

Make the Super Admin audio controls use the same table-button grid, announcement trigger, grouping, and drawer presentation as the crew soundboard. Future table or announcement additions and presentation changes must appear in both panels through one shared source rather than duplicated markup.

## Scope

- Preserve target crew/device selection as the first required Super Admin action.
- Disable every audio control until an eligible, audio-ready target is selected and Realtime is online.
- Send a remote command immediately when Super Admin clicks a table or announcement audio control.
- Keep existing command statuses, errors, and seven-day audit below the shared soundboard controls.
- Preserve crew local playback behavior and styling.

Not included:

- Changing remote delivery, Supabase schema, authentication, presence, command TTL, or audit behavior.
- Adding a second confirmation after selecting an audio item.
- Adding local playback to the Super Admin browser.
- Duplicating the crew soundboard markup in the Super Admin route.

## Shared Architecture

Create one shared soundboard presentation component used by both the crew dashboard and Super Admin panel. It owns only presentation and interaction wiring:

- The responsive 70-table grid.
- `TableButton` status mapping.
- The floating announcements trigger.
- Announcement drawer open/close behavior.
- INFO and LARANGAN grouping and button presentation.

The component receives catalog availability, control status, and an audio-selection callback. It does not create `Audio`, send remote commands, know about Supabase, or own target selection.

The crew route supplies bundled asset availability and a callback that starts/resumes local playback. The Super Admin route supplies the server catalog and a callback that sends `sendRemoteCommand` for the currently selected target.

## Single Source of Truth

Announcement IDs, labels, and categories move into shared server-safe metadata. Both routes derive their grouping and labels from this metadata. The shared soundboard component renders the table range and announcement groups, so neither route maintains separate button lists or category arrays.

Adding a table range item, announcement, label, category, or shared presentation rule must require changing the shared metadata/component only. Both crew and Super Admin consume the same result automatically.

Bundled asset URLs remain browser-only in `src/lib/audio.ts`. Server-safe metadata must not import Vite assets or browser globals. The Super Admin continues sending logical IDs such as `table:7` and `announcement:no-smoking`, never URLs.

## Crew Behavior

Crew behavior remains unchanged:

- Table buttons reflect empty, ready, loading, and playing states.
- Manual concurrent playback rules remain intact.
- Announcement buttons retain current pause/resume behavior.
- The floating Stop control remains crew-only.
- Remote audio received by the crew continues using the existing shared playback controller.

The shared presentation component exposes enough status inputs for the crew route to preserve these states without moving playback logic into the component.

## Super Admin Behavior

The target selector stays above the shared soundboard. Only sessions that are online, eligible, and audio-ready can be selected.

Without a valid target, all table and announcement controls are disabled and the panel shows a clear instruction to select a crew/device first. Controls also remain disabled when Realtime is offline or a command mutation is pending.

After a target is selected:

1. Super Admin clicks one table or announcement control.
2. The clicked logical audio ID is submitted immediately with the selected target ID.
3. The clicked control shows loading while the request is pending.
4. On success, the command/audit section refreshes and shows `sent`, then `played`, `failed`, or `expired`.
5. On failure, the existing alert displays the bounded error and controls become available again when safe.

There is no separate audio dropdown and no additional Play button. Target selection remains explicit, preventing accidental delivery to the wrong crew.

## Accessibility and Mobile Layout

The shared component preserves button semantics, labels, focus behavior, Escape handling, backdrop close behavior, and responsive grid columns from the crew panel. Disabled controls use native disabled behavior. The announcement drawer remains keyboard accessible and usable on narrow Super Admin screens.

The target-selection instruction is visible text, not color-only state. Mutation and Realtime errors retain `role="alert"`.

## Testing

Automated tests cover:

- All 70 table controls derive from one shared range.
- All announcement controls derive from shared metadata and correct INFO/LARANGAN categories.
- Crew and Super Admin render the same shared presentation component rather than separate mappings.
- Crew callbacks receive the correct logical audio ID without changing local playback behavior.
- Super Admin controls are disabled without a selected eligible target, while offline, and during a pending mutation.
- A table click sends its `table:<number>` ID immediately to the selected target.
- An announcement click sends its `announcement:<id>` ID immediately to the selected target.
- Mutation errors restore controls and remain visible.
- Adding shared metadata makes the item available to both consumers without route-specific mapping changes.

Verification also runs the full test suite, TypeScript check, lint, and production build. Manual production smoke testing confirms target-first selection, table playback, announcement playback, status acknowledgement, and unchanged crew controls.
