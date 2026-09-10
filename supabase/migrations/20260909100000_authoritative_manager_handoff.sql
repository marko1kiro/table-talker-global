-- R8: authoritative manager handoff, retry-safe reservation identity, and
-- lifecycle tombstones. Forward-only correction after frozen 09010000-09080000
-- and R7 09090000. No remote migration is applied by this change.

-- Serialize every logical attempt before its first lookup. This closes the
-- check-then-insert race in 09080000 without rewriting the frozen migration.
create or replace function public.reserve_owner_login_attempt(
  p_client_bucket_hash text,
  p_ip_bucket_hash text,
  p_attempt_key text default null
)
returns table(reservation_id uuid)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_client public.owner_login_rate_limit_buckets%rowtype;
  v_ip public.owner_login_rate_limit_buckets%rowtype;
  v_id uuid;
begin
  if p_client_bucket_hash !~ '^[a-f0-9]{64}$'
     or p_ip_bucket_hash !~ '^[a-f0-9]{64}$' then
    return;
  end if;
  if p_attempt_key is not null
     and (length(p_attempt_key) < 16 or length(p_attempt_key) > 200) then
    return;
  end if;

  if p_attempt_key is not null then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(p_attempt_key, 915)
    );
    select r.id into v_id
    from public.owner_login_rate_limit_reservations r
    where r.attempt_key = p_attempt_key
      and r.consumed_at is null
      and r.expires_at > now();
    if v_id is not null then
      return query select v_id;
      return;
    end if;
    if exists (
      select 1 from public.owner_login_rate_limit_reservations
      where attempt_key = p_attempt_key
    ) then
      return;
    end if;
  end if;

  insert into public.owner_login_rate_limit_buckets(bucket_hash)
  select distinct bucket_hash
  from unnest(array[p_client_bucket_hash, p_ip_bucket_hash]) bucket_hash
  order by bucket_hash
  on conflict (bucket_hash) do nothing;

  perform 1
  from public.owner_login_rate_limit_buckets
  where bucket_hash in (p_client_bucket_hash, p_ip_bucket_hash)
  order by bucket_hash
  for update;

  select * into v_client
  from public.owner_login_rate_limit_buckets
  where bucket_hash = p_client_bucket_hash;
  select * into v_ip
  from public.owner_login_rate_limit_buckets
  where bucket_hash = p_ip_bucket_hash;
  if v_client.blocked_until > now() or v_ip.blocked_until > now() then
    return;
  end if;

  update public.owner_login_rate_limit_buckets
  set sequence = sequence + 1
  where bucket_hash in (p_client_bucket_hash, p_ip_bucket_hash);
  select * into v_client
  from public.owner_login_rate_limit_buckets
  where bucket_hash = p_client_bucket_hash;
  select * into v_ip
  from public.owner_login_rate_limit_buckets
  where bucket_hash = p_ip_bucket_hash;

  insert into public.owner_login_rate_limit_reservations(
    client_bucket_hash, ip_bucket_hash, client_sequence, ip_sequence, attempt_key
  ) values (
    p_client_bucket_hash, p_ip_bucket_hash,
    v_client.sequence, v_ip.sequence, p_attempt_key
  ) returning id into v_id;
  return query select v_id;
end;
$$;
revoke all on function public.reserve_owner_login_attempt(text, text, text)
  from public, anon, authenticated;
grant execute on function public.reserve_owner_login_attempt(text, text, text)
  to service_role;

-- Reservation identity is immutable after insert, including for privileged
-- callers. Confirmation always trusts this binding.
create or replace function public.reject_manager_pending_reservation_update()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if old.reservation_id is distinct from new.reservation_id then
    raise exception 'IMMUTABLE_RESERVATION_BINDING' using errcode = 'R0002';
  end if;
  return new;
end;
$$;
drop trigger if exists manager_pending_reservation_immutable
  on public.manager_pending_sessions;
create trigger manager_pending_reservation_immutable
before update of reservation_id on public.manager_pending_sessions
for each row execute function public.reject_manager_pending_reservation_update();

-- Bulk lifecycle revocation records every issued token hash before deleting it.
create or replace function public.revoke_staff_sessions(p_kind text, p_account_id uuid)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_hash text;
  v_deleted integer := 0;
begin
  if p_kind not in ('super_admin', 'area_manager') then
    return 0;
  end if;
  for v_hash in
    delete from public.staff_sessions
    where session_kind = p_kind and account_id = p_account_id
    returning token_hash
  loop
    v_deleted := v_deleted + 1;
    insert into public.revoked_session_tombstones(namespace, token_hash)
    values (p_kind, v_hash)
    on conflict (namespace, token_hash) do nothing;
  end loop;
  return v_deleted;
end;
$$;
revoke all on function public.revoke_staff_sessions(text, uuid)
  from public, anon, authenticated;
grant execute on function public.revoke_staff_sessions(text, uuid) to service_role;

create or replace function public.revoke_manager_sessions(p_manager_id uuid)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_hash text;
  v_deleted integer := 0;
begin
  for v_hash in
    delete from public.manager_sessions
    where manager_id = p_manager_id
    returning token_hash
  loop
    v_deleted := v_deleted + 1;
    insert into public.revoked_session_tombstones(namespace, token_hash)
    values ('manager', v_hash)
    on conflict (namespace, token_hash) do nothing;
  end loop;
  return v_deleted;
end;
$$;
revoke all on function public.revoke_manager_sessions(uuid)
  from public, anon, authenticated;
grant execute on function public.revoke_manager_sessions(uuid) to service_role;

-- Correct cross-namespace lookup for both live rows and tombstones.
create or replace function public.revoke_manager_session_by_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_hash text;
begin
  if p_token is null or length(p_token) < 1 or length(p_token) > 200 then
    return jsonb_build_object('verdict', 'UNKNOWN_TOKEN');
  end if;
  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');
  delete from public.manager_sessions where token_hash = v_hash;
  if found then
    insert into public.revoked_session_tombstones(namespace, token_hash)
    values ('manager', v_hash)
    on conflict (namespace, token_hash) do nothing;
    return jsonb_build_object('verdict', 'REVOKED');
  end if;
  if exists (
    select 1 from public.revoked_session_tombstones
    where namespace = 'manager' and token_hash = v_hash
  ) then
    return jsonb_build_object('verdict', 'ALREADY_INACTIVE');
  end if;
  if exists (select 1 from public.staff_sessions where token_hash = v_hash)
     or exists (
       select 1 from public.revoked_session_tombstones
       where namespace in ('super_admin', 'area_manager') and token_hash = v_hash
     ) then
    return jsonb_build_object('verdict', 'KIND_MISMATCH');
  end if;
  return jsonb_build_object('verdict', 'UNKNOWN_TOKEN');
end;
$$;
revoke all on function public.revoke_manager_session_by_token(text)
  from public, anon, authenticated;
grant execute on function public.revoke_manager_session_by_token(text) to service_role;

create or replace function public.revoke_staff_session_by_token(p_kind text, p_token text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_hash text;
begin
  if p_kind not in ('super_admin', 'area_manager')
     or p_token is null or length(p_token) < 1 or length(p_token) > 200 then
    return jsonb_build_object('verdict', 'UNKNOWN_TOKEN');
  end if;
  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');
  delete from public.staff_sessions
  where session_kind = p_kind and token_hash = v_hash;
  if found then
    insert into public.revoked_session_tombstones(namespace, token_hash)
    values (p_kind, v_hash)
    on conflict (namespace, token_hash) do nothing;
    return jsonb_build_object('verdict', 'REVOKED');
  end if;
  if exists (
    select 1 from public.revoked_session_tombstones
    where namespace = p_kind and token_hash = v_hash
  ) then
    return jsonb_build_object('verdict', 'ALREADY_INACTIVE');
  end if;
  if exists (
       select 1 from public.staff_sessions
       where token_hash = v_hash and session_kind <> p_kind
     )
     or exists (select 1 from public.manager_sessions where token_hash = v_hash)
     or exists (
       select 1 from public.revoked_session_tombstones
       where token_hash = v_hash and namespace <> p_kind
     ) then
    return jsonb_build_object('verdict', 'KIND_MISMATCH');
  end if;
  return jsonb_build_object('verdict', 'UNKNOWN_TOKEN');
end;
$$;
revoke all on function public.revoke_staff_session_by_token(text, text)
  from public, anon, authenticated;
grant execute on function public.revoke_staff_session_by_token(text, text)
  to service_role;

-- The app supplies a deterministic, server-secret-derived bearer on each
-- retry. Only its SHA-256 hash is persisted. A repeated RPC with the same
-- reservation/manager/bearer is authoritative success, never a second row.
drop function if exists public.create_manager_session_pending(uuid, uuid, text);
create function public.create_manager_session_pending(
  p_manager_id uuid,
  p_reservation_id uuid,
  p_token text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_account public.manager_accounts%rowtype;
  v_reservation public.owner_login_rate_limit_reservations%rowtype;
  v_pending public.manager_pending_sessions%rowtype;
  v_hash text;
begin
  if p_reservation_id is null or p_token is null or p_token !~ '^[a-f0-9]{64}$' then
    return false;
  end if;
  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');

  select * into v_reservation
  from public.owner_login_rate_limit_reservations
  where id = p_reservation_id
  for update;
  if v_reservation.id is null then return false; end if;

  select * into v_pending
  from public.manager_pending_sessions
  where reservation_id = p_reservation_id
  for update;
  if v_pending.id is not null then
    if v_pending.manager_id <> p_manager_id or v_pending.token_hash <> v_hash then
      return false;
    end if;
    if v_pending.confirmed_at is not null then
      return v_reservation.outcome = 'succeeded'
        and exists (
          select 1 from public.manager_sessions
          where manager_id = p_manager_id and token_hash = v_hash and expires_at > now()
        );
    end if;
    return v_pending.expires_at > now()
      and v_reservation.consumed_at is null
      and v_reservation.expires_at > now();
  end if;

  if v_reservation.consumed_at is not null or v_reservation.expires_at <= now() then
    return false;
  end if;
  select * into v_account
  from public.manager_accounts
  where id = p_manager_id and status = 'aktif';
  if v_account.id is null then return false; end if;

  delete from public.manager_pending_sessions
  where expires_at < now() and confirmed_at is null;
  insert into public.manager_pending_sessions(
    manager_id, restaurant_id, token_hash, reservation_id, expires_at
  ) values (
    v_account.id, v_account.restaurant_id, v_hash, p_reservation_id,
    now() + interval '60 seconds'
  );
  return true;
end;
$$;
revoke all on function public.create_manager_session_pending(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.create_manager_session_pending(uuid, uuid, text)
  to service_role;
revoke all on function public.create_manager_session_pending(uuid, uuid)
  from public, anon, authenticated, service_role;
drop function if exists public.create_manager_session_pending(uuid, uuid);

-- Atomic activation: exact pair lookup, manager-level serialization,
-- tombstone-producing newest-wins revoke, durable success, then confirmed
-- marker. Any exception rolls the entire transaction back.
create or replace function public.confirm_manager_session(
  p_token text,
  p_reservation_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_hash text;
  v_pending public.manager_pending_sessions%rowtype;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' or p_reservation_id is null then
    return false;
  end if;
  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');

  select * into v_pending
  from public.manager_pending_sessions
  where token_hash = v_hash and reservation_id = p_reservation_id
  for update;
  if v_pending.id is null then return false; end if;

  if v_pending.confirmed_at is not null then
    return exists (
      select 1
      from public.manager_sessions s
      join public.owner_login_rate_limit_reservations r
        on r.id = v_pending.reservation_id
      where s.manager_id = v_pending.manager_id
        and s.token_hash = v_hash
        and s.expires_at > now()
        and r.outcome = 'succeeded'
        and r.consumed_at is not null
    );
  end if;
  if v_pending.expires_at <= now() then return false; end if;
  if not exists (
    select 1 from public.owner_login_rate_limit_reservations
    where id = p_reservation_id and consumed_at is null and expires_at > now()
  ) then return false; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_pending.manager_id::text, 916)
  );
  perform public.revoke_manager_sessions(v_pending.manager_id);
  insert into public.manager_sessions(manager_id, restaurant_id, token_hash, expires_at)
  values (
    v_pending.manager_id, v_pending.restaurant_id, v_pending.token_hash,
    now() + interval '12 hours'
  );
  if not public.apply_owner_login_rate_limit(p_reservation_id, true) then
    raise exception 'RESERVATION_NOT_CONSUMABLE' using errcode = 'R0001';
  end if;
  update public.manager_pending_sessions
  set confirmed_at = now()
  where id = v_pending.id and confirmed_at is null;
  if not found then
    raise exception 'CONFIRM_STATE_CHANGED' using errcode = 'R0003';
  end if;
  return true;
end;
$$;
revoke all on function public.confirm_manager_session(text, uuid)
  from public, anon, authenticated;
grant execute on function public.confirm_manager_session(text, uuid)
  to service_role;

-- Cleanup is bound to the same immutable token+reservation pair and returns an
-- explicit verdict. A caller can no longer mistake a no-op or wrong attempt
-- for successful compensation.
create or replace function public.cleanup_pending_manager_session(
  p_token text,
  p_reservation_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_hash text;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' or p_reservation_id is null then
    return false;
  end if;
  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');
  delete from public.manager_pending_sessions
  where token_hash = v_hash
    and reservation_id = p_reservation_id
    and confirmed_at is null;
  if found then return true; end if;
  -- Idempotent retry is safe only when this pair is not a confirmed handoff.
  return not exists (
    select 1 from public.manager_pending_sessions
    where token_hash = v_hash
      and reservation_id = p_reservation_id
      and confirmed_at is not null
  );
end;
$$;
revoke all on function public.cleanup_pending_manager_session(text, uuid)
  from public, anon, authenticated;
grant execute on function public.cleanup_pending_manager_session(text, uuid)
  to service_role;
revoke all on function public.cleanup_pending_manager_session(text)
  from public, anon, authenticated, service_role;
drop function if exists public.cleanup_pending_manager_session(text);
