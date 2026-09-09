-- Poin 2 review fix (A2/B10): backfill every legacy Manager login ID into the
-- permanent global staff-ID registry. The registry is the single
-- case-insensitive namespace across Manager / Area Manager / Super Admin;
-- from this migration on, every legacy ID is claimed and therefore immutable
-- and non-reusable.
--
-- Collision safety is enforced twice, both fail-closed:
--  1. A UNIQUE index on lower(id_manager) makes the legacy namespace itself
--     case-insensitively unique. Duplicate legacy rows (e.g. 'admin' vs
--     'ADMIN') abort the migration here — the guard re-raises them as
--     STAFF_ID_BACKFILL_COLLISION with the offending IDs.
--  2. The registry claim gate below: after the (idempotent) claim insert,
--     EVERY legacy manager must be claimed. Anything left unclaimed means a
--     case-insensitive cross-role collision that predates this migration.
-- The migration aborts loudly instead of silently picking a winner; resolution
-- is manual. No legacy row is ever renamed, deleted, or re-homed: identity
-- display and history stay intact.

do $$
declare
  v_duplicates text;
begin
  begin
    create unique index if not exists manager_accounts_lower_id_manager_uq
      on public.manager_accounts (lower(id_manager));
  exception when unique_violation then
    select string_agg(distinct lower(id_manager), ', ' order by lower(id_manager))
      into v_duplicates
      from public.manager_accounts m
      where exists (
        select 1 from public.manager_accounts other
        where other.id <> m.id and lower(other.id_manager) = lower(m.id_manager)
      );
    raise exception 'STAFF_ID_BACKFILL_COLLISION: duplicate legacy manager IDs (case-insensitive): %',
      coalesce(v_duplicates, 'unknown')
      using hint = 'Resolve duplicate legacy staff IDs before upgrading.';
  end;
end $$;

insert into public.staff_id_registry (staff_id, account_kind, account_id)
select lower(m.id_manager), 'manager', m.id
from public.manager_accounts m
on conflict (staff_id) do nothing;

do $$
declare
  v_unclaimed text;
begin
  select string_agg(distinct lower(m.id_manager), ', ' order by lower(m.id_manager))
    into v_unclaimed
  from public.manager_accounts m
  where not exists (
    select 1 from public.staff_id_registry r
    where r.staff_id = lower(m.id_manager)
      and r.account_kind = 'manager'
      and r.account_id = m.id
  );
  if v_unclaimed is not null then
    raise exception 'STAFF_ID_BACKFILL_COLLISION: unclaimed legacy manager IDs: %', v_unclaimed
      using hint = 'Resolve case-insensitive staff-ID collisions before upgrading.';
  end if;
end $$;
