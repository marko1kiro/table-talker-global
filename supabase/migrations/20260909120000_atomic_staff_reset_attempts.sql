-- Bind Manager/Area Manager reset submission to one durable limiter attempt.
-- The reset row, immutable attempt ledger, audit, and limiter outcome commit or
-- roll back as one transaction. Existing reset rows remain valid (unbound).

alter table public.manager_reset_requests
  add column if not exists reservation_id uuid
  references public.owner_login_rate_limit_reservations(id);
alter table public.am_reset_requests
  add column if not exists reservation_id uuid
  references public.owner_login_rate_limit_reservations(id);

create unique index if not exists manager_reset_requests_reservation_idx
  on public.manager_reset_requests (reservation_id)
  where reservation_id is not null;
create unique index if not exists am_reset_requests_reservation_idx
  on public.am_reset_requests (reservation_id)
  where reservation_id is not null;

create table public.staff_reset_attempts (
  reservation_id uuid primary key
    references public.owner_login_rate_limit_reservations(id),
  request_kind text not null
    check (request_kind in ('manager', 'area_manager')),
  staff_id text not null,
  account_id uuid,
  request_id uuid,
  result boolean not null,
  created_at timestamptz not null default clock_timestamp(),
  check ((result and account_id is not null and request_id is not null)
      or (not result and request_id is null))
);
create index staff_reset_attempts_created_at_idx
  on public.staff_reset_attempts (created_at, reservation_id);
alter table public.staff_reset_attempts enable row level security;
revoke all on public.staff_reset_attempts from public, anon, authenticated, service_role;

create function public.reject_staff_reset_attempt_update()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  raise exception 'staff reset attempt ledger is immutable';
end;
$$;
create trigger staff_reset_attempts_immutable
before update on public.staff_reset_attempts
for each row execute function public.reject_staff_reset_attempt_update();
revoke all on function public.reject_staff_reset_attempt_update()
  from public, anon, authenticated, service_role;

create or replace function public.submit_manager_reset_request(
  p_staff_id text,
  p_candidate_hash text,
  p_reservation_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_staff_id text := lower(trim(p_staff_id));
  v_reservation public.owner_login_rate_limit_reservations%rowtype;
  v_attempt public.staff_reset_attempts%rowtype;
  v_manager public.manager_accounts%rowtype;
  v_request_id uuid;
begin
  if p_reservation_id is null or p_candidate_hash is null or v_staff_id = '' then
    return false;
  end if;

  -- Global serialization point: lock the raw reservation before checking any
  -- kind, staff identity, liveness, bucket, or account state.
  select * into v_reservation
  from public.owner_login_rate_limit_reservations
  where id = p_reservation_id
  for update;
  if not found then
    return false;
  end if;

  select * into v_attempt
  from public.staff_reset_attempts
  where reservation_id = p_reservation_id;
  if found then
    return v_attempt.request_kind = 'manager'
      and v_attempt.staff_id = v_staff_id
      and v_attempt.result;
  end if;

  if v_reservation.consumed_at is not null
    or v_reservation.expires_at <= clock_timestamp() then
    return false;
  end if;

  -- Match the canonical ordering used by apply_owner_login_rate_limit.
  perform 1
  from public.owner_login_rate_limit_buckets
  where bucket_hash in (v_reservation.client_bucket_hash, v_reservation.ip_bucket_hash)
  order by bucket_hash
  for update;

  select * into v_manager
  from public.manager_accounts
  where lower(id_manager) = v_staff_id
  for update;

  -- Account acquisition can wait. Transaction-start now() is not a valid
  -- expiry check here; re-read wall time after that wait.
  if v_reservation.expires_at <= clock_timestamp() then
    return false;
  end if;

  if v_manager.id is null or v_manager.status <> 'aktif' then
    insert into public.staff_reset_attempts
      (reservation_id, request_kind, staff_id, account_id, result)
    values (
      p_reservation_id,
      'manager',
      v_staff_id,
      case when v_manager.id is null then null else v_manager.id end,
      false
    );
    perform public.write_admin_audit(
      'system', null, 'system', 'manager_reset.submit', 'manager',
      case when v_manager.id is null then null else v_manager.id end,
      case when v_manager.id is null then null else v_manager.restaurant_id end,
      'failed', 'unknown or inactive account', '{}'::jsonb
    );
    if not public.apply_owner_login_rate_limit(p_reservation_id, false) then
      raise exception 'reset limiter terminal transition failed';
    end if;
    return false;
  end if;

  if exists (
    select 1 from public.manager_reset_requests
    where manager_id = v_manager.id and status = 'pending'
  ) then
    insert into public.staff_reset_attempts
      (reservation_id, request_kind, staff_id, account_id, result)
    values (p_reservation_id, 'manager', v_staff_id, v_manager.id, false);
    perform public.write_admin_audit(
      'system', null, 'system', 'manager_reset.submit', 'manager',
      v_manager.id, v_manager.restaurant_id,
      'failed', 'already pending', '{}'::jsonb
    );
    if not public.apply_owner_login_rate_limit(p_reservation_id, false) then
      raise exception 'reset limiter terminal transition failed';
    end if;
    return false;
  end if;

  insert into public.manager_reset_requests
    (manager_id, candidate_hash, reservation_id)
  values (v_manager.id, p_candidate_hash, p_reservation_id)
  returning id into v_request_id;

  insert into public.staff_reset_attempts
    (reservation_id, request_kind, staff_id, account_id, request_id, result)
  values (
    p_reservation_id, 'manager', v_staff_id,
    v_manager.id, v_request_id, true
  );
  perform public.write_admin_audit(
    'system', null, 'system', 'manager_reset.submit', 'manager',
    v_manager.id, v_manager.restaurant_id, 'ok', null, '{}'::jsonb
  );
  if not public.apply_owner_login_rate_limit(p_reservation_id, true) then
    raise exception 'reset limiter terminal transition failed';
  end if;
  return true;
end;
$$;

create or replace function public.submit_am_reset_request(
  p_staff_id text,
  p_candidate_hash text,
  p_reservation_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_staff_id text := lower(trim(p_staff_id));
  v_reservation public.owner_login_rate_limit_reservations%rowtype;
  v_attempt public.staff_reset_attempts%rowtype;
  v_am public.area_manager_accounts%rowtype;
  v_request_id uuid;
begin
  if p_reservation_id is null or p_candidate_hash is null or v_staff_id = '' then
    return false;
  end if;

  select * into v_reservation
  from public.owner_login_rate_limit_reservations
  where id = p_reservation_id
  for update;
  if not found then
    return false;
  end if;

  select * into v_attempt
  from public.staff_reset_attempts
  where reservation_id = p_reservation_id;
  if found then
    return v_attempt.request_kind = 'area_manager'
      and v_attempt.staff_id = v_staff_id
      and v_attempt.result;
  end if;

  if v_reservation.consumed_at is not null
    or v_reservation.expires_at <= clock_timestamp() then
    return false;
  end if;

  perform 1
  from public.owner_login_rate_limit_buckets
  where bucket_hash in (v_reservation.client_bucket_hash, v_reservation.ip_bucket_hash)
  order by bucket_hash
  for update;

  select * into v_am
  from public.area_manager_accounts
  where staff_id = v_staff_id
  for update;

  if v_reservation.expires_at <= clock_timestamp() then
    return false;
  end if;

  if v_am.id is null or v_am.status <> 'aktif' then
    insert into public.staff_reset_attempts
      (reservation_id, request_kind, staff_id, account_id, result)
    values (
      p_reservation_id,
      'area_manager',
      v_staff_id,
      case when v_am.id is null then null else v_am.id end,
      false
    );
    perform public.write_admin_audit(
      'system', null, 'system', 'am_reset.submit', 'area_manager',
      case when v_am.id is null then null else v_am.id end,
      null, 'failed', 'unknown or inactive account', '{}'::jsonb
    );
    if not public.apply_owner_login_rate_limit(p_reservation_id, false) then
      raise exception 'reset limiter terminal transition failed';
    end if;
    return false;
  end if;

  if exists (
    select 1 from public.am_reset_requests
    where area_manager_id = v_am.id and status = 'pending'
  ) then
    insert into public.staff_reset_attempts
      (reservation_id, request_kind, staff_id, account_id, result)
    values (p_reservation_id, 'area_manager', v_staff_id, v_am.id, false);
    perform public.write_admin_audit(
      'system', null, 'system', 'am_reset.submit', 'area_manager',
      v_am.id, null, 'failed', 'already pending', '{}'::jsonb
    );
    if not public.apply_owner_login_rate_limit(p_reservation_id, false) then
      raise exception 'reset limiter terminal transition failed';
    end if;
    return false;
  end if;

  insert into public.am_reset_requests
    (area_manager_id, candidate_hash, reservation_id)
  values (v_am.id, p_candidate_hash, p_reservation_id)
  returning id into v_request_id;

  insert into public.staff_reset_attempts
    (reservation_id, request_kind, staff_id, account_id, request_id, result)
  values (
    p_reservation_id, 'area_manager', v_staff_id,
    v_am.id, v_request_id, true
  );
  perform public.write_admin_audit(
    'system', null, 'system', 'am_reset.submit', 'area_manager',
    v_am.id, null, 'ok', null, '{}'::jsonb
  );
  if not public.apply_owner_login_rate_limit(p_reservation_id, true) then
    raise exception 'reset limiter terminal transition failed';
  end if;
  return true;
end;
$$;

-- Reconciliation waits behind an in-flight transaction by locking the raw
-- reservation, then returns only a generic terminal state for this reset kind.
create function public.reconcile_staff_reset_attempt(
  p_attempt_key text,
  p_request_kind text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_reservation public.owner_login_rate_limit_reservations%rowtype;
  v_attempt public.staff_reset_attempts%rowtype;
begin
  if p_attempt_key is null
    or length(p_attempt_key) < 16
    or length(p_attempt_key) > 200
    or p_request_kind not in ('manager', 'area_manager') then
    return 'UNKNOWN';
  end if;

  select * into v_reservation
  from public.owner_login_rate_limit_reservations
  where attempt_key = p_attempt_key
  for update;
  if not found then
    return 'UNKNOWN';
  end if;

  select * into v_attempt
  from public.staff_reset_attempts
  where reservation_id = v_reservation.id
    and request_kind = p_request_kind;
  if found then
    return case when v_attempt.result then 'SUCCEEDED' else 'FAILED' end;
  end if;

  if v_reservation.consumed_at is null
    and v_reservation.expires_at > clock_timestamp() then
    return 'PENDING';
  end if;
  return 'UNKNOWN';
end;
$$;

-- Bounded ledger retention. Deletion is the sole lifecycle operation; ledger
-- rows are never updated. The reservation cleanup below skips still-ledgered
-- rows so each retention invocation has a hard upper bound.
create function public.cleanup_staff_reset_attempts()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  attempts_deleted integer;
begin
  with doomed as (
    select reservation_id
    from public.staff_reset_attempts
    where created_at < clock_timestamp() - interval '1 day'
    order by created_at, reservation_id
    limit 500
    for update skip locked
  )
  delete from public.staff_reset_attempts a
  using doomed d
  where a.reservation_id = d.reservation_id;
  get diagnostics attempts_deleted = row_count;
  return jsonb_build_object('attempts_deleted', attempts_deleted);
end;
$$;

create or replace function public.cleanup_owner_login_rate_limits()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  reservations_deleted integer;
  buckets_deleted integer;
begin
  with doomed as (
    select r.id
    from public.owner_login_rate_limit_reservations r
    where (r.consumed_at < clock_timestamp() - interval '1 day'
        or r.expires_at < clock_timestamp() - interval '1 day')
      and not exists (
        select 1 from public.staff_reset_attempts a
        where a.reservation_id = r.id
      )
    order by coalesce(r.consumed_at, r.expires_at), r.id
    limit 1000
    for update skip locked
  )
  delete from public.owner_login_rate_limit_reservations r
  using doomed d
  where r.id = d.id;
  get diagnostics reservations_deleted = row_count;

  with doomed as (
    select b.bucket_hash
    from public.owner_login_rate_limit_buckets b
    where b.window_started_at < clock_timestamp() - interval '1 day'
      and not exists (
        select 1 from public.owner_login_rate_limit_reservations r
        where r.client_bucket_hash = b.bucket_hash
           or r.ip_bucket_hash = b.bucket_hash
      )
    order by b.window_started_at, b.bucket_hash
    limit 1000
    for update skip locked
  )
  delete from public.owner_login_rate_limit_buckets b
  using doomed d
  where b.bucket_hash = d.bucket_hash;
  get diagnostics buckets_deleted = row_count;

  return jsonb_build_object(
    'reservations_deleted', reservations_deleted,
    'buckets_deleted', buckets_deleted
  );
end;
$$;

create or replace function public.run_owner_retention()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  result jsonb;
  reset_attempts jsonb;
  login_limits jsonb;
begin
  result := public.cleanup_owner_retention();
  reset_attempts := public.cleanup_staff_reset_attempts();
  login_limits := public.cleanup_owner_login_rate_limits();
  result := result || jsonb_build_object(
    'staff_reset_attempts', reset_attempts,
    'owner_login_rate_limits', login_limits
  );
  perform public.record_owner_retention_success(result);
  return result;
end;
$$;

-- Remove unbound signatures so no caller can bypass logical attempt identity.
drop function if exists public.submit_manager_reset_request(text, text);
drop function if exists public.submit_am_reset_request(text, text);

revoke all on function public.submit_manager_reset_request(text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.submit_manager_reset_request(text, text, uuid)
  to service_role;
revoke all on function public.submit_am_reset_request(text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.submit_am_reset_request(text, text, uuid)
  to service_role;
revoke all on function public.reconcile_staff_reset_attempt(text, text)
  from public, anon, authenticated;
grant execute on function public.reconcile_staff_reset_attempt(text, text)
  to service_role;
revoke all on function public.cleanup_staff_reset_attempts()
  from public, anon, authenticated;
grant execute on function public.cleanup_staff_reset_attempts()
  to service_role;
revoke all on function public.cleanup_owner_login_rate_limits()
  from public, anon, authenticated;
grant execute on function public.cleanup_owner_login_rate_limits()
  to service_role;
revoke all on function public.run_owner_retention()
  from public, anon, authenticated;
grant execute on function public.run_owner_retention()
  to service_role;
