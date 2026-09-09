-- Poin 2 review fix (B10): backfill every legacy Manager login ID into the
-- permanent global staff-ID registry. The registry is the single
-- case-insensitive namespace across Manager / Area Manager / Super Admin;
-- from this migration on, every legacy ID is claimed and therefore immutable
-- and non-reusable.
--
-- Authoritative collision gate: after the (idempotent) claim insert, EVERY
-- legacy manager must be claimed. Anything left unclaimed means a
-- case-insensitive collision — duplicate legacy IDs (e.g. 'admin' vs 'ADMIN')
-- or a cross-role claim that predates this migration. The migration aborts
-- loudly instead of silently picking a winner; resolution is manual.

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
