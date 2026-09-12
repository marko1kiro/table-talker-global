# P1-4 Stale Identity Cleanup Design

## Scope

Close P1-4 only: browser identity cleanup after definitive manager handoff failures, recovery after pre-confirm navigation/unmount, and stale manager identity removal before Area Manager or Super Admin login. No migration, durable lifecycle registry, batching, or revocation relaxation.

## State ownership

`table-talker.manager-identity` is usable manager identity. `table-talker.manager-pending-handoff` is exact pending bearer/reservation recovery state.

After identity write:

- Successful confirm or reconciliation `succeeded`: retain identity, remove pending record.
- Definitive failure: navigation reject, reconciliation `failed`, or successful pending cleanup: remove both records.
- Unresolved failure: reconciliation `unknown` or failed pending cleanup: retain both records.

Cleanup remains authoritative server-side. Browser removal never changes lifecycle verdicts or relaxes mandatory revocation.

## Recovery

Use route-level recovery. `/manager` checks for a pending-handoff record before trusting a stored manager identity. If one exists, it removes stale usable identity and redirects to `/manager/login`, where existing resume logic confirms or reconciles the exact pair. This survives navigation followed by component unmount without background work or timers.

The login route clears stale manager identity before Area Manager or Super Admin outcomes. This removes an earlier pending manager bearer before any later role login can surrender it as an old credential.

## Core boundary

`managerLoginHandoffCore` receives identity-removal dependency. On every definitive post-write path it removes newly written identity only after successful cleanup or authoritative failed reconciliation. It does not remove identity when cleanup/reconciliation remains unknown.

## Tests

Focused unit and route tests assert exact keys after navigation failure, authoritative failure, successful cleanup, unknown state, cleanup failure, absent/partial storage, route redirect/unmount recovery, and Area Manager/Super Admin stale identity cleanup. Tests use callback ordering and rendered route behavior; no sleeps.

Ablation removes definitive identity cleanup and pending-route guard independently. Their focused tests must fail.

## Security

No raw bearer enters URL, UI, logs, SQL, or returned errors. No Supabase migration changes. Mandatory revocation, P1-3 equality guard, and persistence hard-failure behavior remain unchanged.
