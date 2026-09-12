# P1-5 Durable Manager Handoff Reconciliation Design

## Scope

Close P1-5 only: exact manager handoff reconciliation survives active-session revocation, manager or restaurant cascades, and pending/reservation retention. No expiry batching, browser behavior, or revocation-policy change.

## Registry

Add one forward migration creating a service-private lifecycle registry keyed by `(token_hash, reservation_id)`. Each row contains `manager_id`, authoritative state (`PENDING`, `SUCCEEDED`, or `FAILED`), and timestamps. It stores SHA-256 hash only; never raw bearer.

RLS is enabled. Table privileges revoke access from `public`, `anon`, and `authenticated`; only lifecycle security-definer functions may access it. Functions use fixed `search_path = pg_catalog, public`; helper functions receive no execute grant.

## Writes

`create_manager_session_pending` creates exact `PENDING` evidence in its existing lock order. Exact retry validates the same identity and leaves it `PENDING` only for a live pending row.

`confirm_manager_session` changes exact evidence to `SUCCEEDED` in its existing transaction after activation and rate-limit success. Every terminal pending deletion path changes exact evidence to `FAILED` before deleting source data: explicit cleanup, expiry, overlap terminalization, reservation cascade, manager cascade, restaurant cascade, and retention. Existing anti-reuse register and tombstones remain; registry augments, not replaces, them.

## Reconciliation

`reconcile_manager_session_handoff` validates token and reservation, takes existing canonical available locks, then reads exact registry evidence. `SUCCEEDED` returns only for `SUCCEEDED`; `FAILED` returns only for `FAILED`; `PENDING` is returned only when exact live pending state and unconsumed/unexpired reservation remain. Missing/inconsistent evidence returns `UNKNOWN` fail closed. Registry terminal evidence wins after source-row cascade/retention.

## Tests

Disposable PostgreSQL integration tests prove:

- mint produces exact `PENDING` evidence;
- confirm produces `SUCCEEDED`, then active revoke resolves exact pair `FAILED`;
- manager and restaurant cascades preserve exact terminal `FAILED` evidence;
- reservation and pending retention preserve terminal exact evidence;
- wrong reservation for same token is never accepted;
- concurrent confirm/cascade yields one authoritative result with no raw bearer persistence;
- registry RLS, grants, function `search_path`, and no raw bearer storage.

Ablation removes registry read/write paths and must fail exact cascade/retention tests.

## Constraints

Forward migration only. Do not apply remote migrations, deploy, merge, force-push, begin P2-6, or weaken Manager mandatory revocation/P1-3/P1-4 behavior.
