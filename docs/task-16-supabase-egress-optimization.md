# Task 16 — Supabase Egress Optimization

## Objective

Reduce occupancy-snapshot egress while keeping the Kasir, Satgas, and Clear Up operational behavior unchanged.

## Changes

- Supabase Realtime Broadcast is the primary refresh path.
- The former unconditional 30-second route polling is removed.
- While realtime is not yet `SUBSCRIBED`, a 12-second fallback keeps snapshots fresh.
- Fallback polling pauses while the page is hidden and resumes when visible.
- `get_table_occupancy_snapshot` now returns only `terisi` rows. Missing rows remain semantically `kosong`, matching the existing client behavior.
- The RPC signature, role-session validation, and grants remain unchanged.

## Expected traffic pattern

With healthy realtime, each device fetches on initial load and then on invalidate/focus events rather than every 30 seconds. Snapshot size scales with occupied tables instead of always returning 100 rows. If realtime fails, visible devices retain the 12-second operational fallback with the compact payload.

## Deferred

Delta fetching and an external cache layer remain out of scope. They should only be reconsidered if post-deployment usage metrics still approach the Supabase Free limits.
