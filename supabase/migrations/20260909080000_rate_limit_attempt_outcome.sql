-- R6-C: rate-limit reservations become a durable, exactly-once state machine.
--   reserved  (consumed_at IS NULL, expires_at > now())
--   succeeded / failed  (consumed_at set, outcome recorded — CAS, one winner)
--   expired / abandoned  (consumed_at IS NULL, expires_at passed; TTL cleanup)
-- 1. Reservations carry an idempotency attempt_key: the same UNCONSUMED key
--    re-reserves the SAME reservation (a lost response + retry cannot create
--    a second reservation or double-count); a key whose attempt reached a
--    final outcome (or expired) is dead — a new logical attempt needs a new
--    key, and every new key still passes the SAME bucket enforcement.
-- 2. complete_owner_login_attempt returns a structured verdict and records
--    the outcome durably. The client/server can never flip a decided outcome
--    (compare-and-set on consumed_at) and a late reporter cannot contradict
--    the verdict the DB already banked.
-- 3. apply_owner_login_rate_limit is the shared CAS+bucket core used by the
--    completion RPC and by confirm_manager_session (activation + outcome in
--    one transaction).
-- Forward-only; no session data is migrated.

alter table public.owner_login_rate_limit_reservations
  add column if not exists attempt_key text;
alter table public.owner_login_rate_limit_reservations
  add column if not exists outcome text check (outcome in ('succeeded', 'failed'));
create unique index if not exists owner_login_rate_limit_reservations_attempt_key_idx
  on public.owner_login_rate_limit_reservations (attempt_key)
  where attempt_key is not null;

-- Idempotent reserve: same arity as before plus an optional attempt key, so
-- existing 2-arg calls keep working.
create or replace function public.reserve_owner_login_attempt(
  p_client_bucket_hash text,
  p_ip_bucket_hash text,
  p_attempt_key text default null
)
returns table(reservation_id uuid) language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_client public.owner_login_rate_limit_buckets%rowtype; v_ip public.owner_login_rate_limit_buckets%rowtype; v_id uuid;
begin
  if p_client_bucket_hash !~ '^[a-f0-9]{64}$' or p_ip_bucket_hash !~ '^[a-f0-9]{64}$' then return; end if;
  if p_attempt_key is not null and (length(p_attempt_key) < 16 or length(p_attempt_key) > 200) then return; end if;

  -- Idempotency: the same unconsumed, unexpired key maps to the SAME
  -- reservation; a consumed or expired key is dead (no reuse, ever).
  if p_attempt_key is not null then
    select r.id into v_id from public.owner_login_rate_limit_reservations r
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
  select distinct bucket_hash from unnest(array[p_client_bucket_hash, p_ip_bucket_hash]) bucket_hash order by bucket_hash
  on conflict (bucket_hash) do nothing;
  perform 1 from public.owner_login_rate_limit_buckets where bucket_hash in (p_client_bucket_hash, p_ip_bucket_hash) order by bucket_hash for update;
  select * into v_client from public.owner_login_rate_limit_buckets where bucket_hash = p_client_bucket_hash;
  select * into v_ip from public.owner_login_rate_limit_buckets where bucket_hash = p_ip_bucket_hash;
  if v_client.blocked_until > now() or v_ip.blocked_until > now() then return; end if;
  update public.owner_login_rate_limit_buckets set sequence = sequence + 1
  where bucket_hash in (p_client_bucket_hash, p_ip_bucket_hash);
  select * into v_client from public.owner_login_rate_limit_buckets where bucket_hash = p_client_bucket_hash;
  select * into v_ip from public.owner_login_rate_limit_buckets where bucket_hash = p_ip_bucket_hash;
  insert into public.owner_login_rate_limit_reservations(client_bucket_hash, ip_bucket_hash, client_sequence, ip_sequence, attempt_key)
  values (p_client_bucket_hash, p_ip_bucket_hash, v_client.sequence, v_ip.sequence, p_attempt_key) returning id into v_id;
  return query select v_id;
end;
$$;

-- Shared CAS+bucket core. Returns TRUE only when THIS call performed the
-- exactly-once transition; FALSE when the reservation was missing, already
-- decided, or expired (the caller decides how to fail).
create or replace function public.apply_owner_login_rate_limit(p_reservation_id uuid, p_success boolean)
returns boolean language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_reservation public.owner_login_rate_limit_reservations%rowtype; v_now timestamptz := now();
begin
  select * into v_reservation from public.owner_login_rate_limit_reservations where id = p_reservation_id and consumed_at is null and expires_at > v_now for update;
  if not found then return false; end if;
  perform 1 from public.owner_login_rate_limit_buckets
  where bucket_hash in (v_reservation.client_bucket_hash, v_reservation.ip_bucket_hash)
  order by bucket_hash for update;
  update public.owner_login_rate_limit_reservations set consumed_at = v_now, outcome = case when p_success then 'succeeded' else 'failed' end where id = p_reservation_id;
  if p_success then
    -- Watermark first, then reset the buckets that sit at the head.
    update public.owner_login_rate_limit_buckets set
      last_success_sequence = greatest(last_success_sequence, case when bucket_hash = v_reservation.client_bucket_hash then v_reservation.client_sequence else v_reservation.ip_sequence end)
    where bucket_hash in (v_reservation.client_bucket_hash, v_reservation.ip_bucket_hash);
    update public.owner_login_rate_limit_buckets set
      failures = 0,
      window_started_at = v_now,
      blocked_until = null
    where (bucket_hash = v_reservation.client_bucket_hash and v_reservation.client_sequence = sequence)
       or (bucket_hash = v_reservation.ip_bucket_hash and v_reservation.ip_sequence = sequence);
  else
    update public.owner_login_rate_limit_buckets set
      failures = case when window_started_at <= v_now - interval '15 minutes' then 1 else failures + 1 end,
      window_started_at = case when window_started_at <= v_now - interval '15 minutes' then v_now else window_started_at end,
      blocked_until = case when window_started_at > v_now - interval '15 minutes' and failures + 1 >= 5 then v_now + interval '15 minutes' else blocked_until end
    where (bucket_hash = v_reservation.client_bucket_hash and v_reservation.client_sequence > last_success_sequence)
       or (bucket_hash = v_reservation.ip_bucket_hash and v_reservation.ip_sequence > last_success_sequence);
  end if;
  return true;
end;
$$;

-- Verdict-returning completion. The old boolean signature must be dropped
-- first: CREATE OR REPLACE cannot change a return type.
drop function if exists public.complete_owner_login_attempt(uuid, boolean);
create function public.complete_owner_login_attempt(p_reservation_id uuid, p_success boolean)
returns text language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_outcome text;
begin
  if p_success is null then return 'MALFORMED'; end if;
  select outcome into v_outcome from public.owner_login_rate_limit_reservations where id = p_reservation_id and consumed_at is not null;
  if v_outcome is not null then
    return case when v_outcome = 'succeeded' then 'ALREADY_SUCCEEDED' else 'ALREADY_FAILED' end;
  end if;
  if exists (select 1 from public.owner_login_rate_limit_reservations where id = p_reservation_id and consumed_at is null and expires_at <= now()) then
    return 'EXPIRED';
  end if;
  if not public.apply_owner_login_rate_limit(p_reservation_id, p_success) then
    -- Lost the CAS race: another completion decided first, or the row is
    -- gone/expired. Re-read for the authoritative verdict.
    select outcome into v_outcome from public.owner_login_rate_limit_reservations where id = p_reservation_id and consumed_at is not null;
    if v_outcome is not null then
      return case when v_outcome = 'succeeded' then 'ALREADY_SUCCEEDED' else 'ALREADY_FAILED' end;
    end if;
    if exists (select 1 from public.owner_login_rate_limit_reservations where id = p_reservation_id and consumed_at is null and expires_at <= now()) then
      return 'EXPIRED';
    end if;
    return 'UNKNOWN_RESERVATION';
  end if;
  return case when p_success then 'SUCCEEDED' else 'FAILED' end;
end;
$$;

-- The legacy 2-arg overload (no attempt key) is replaced by the 3-arg
-- version; dropping it forces every caller through the idempotent path.
drop function if exists public.reserve_owner_login_attempt(text, text);

revoke all on function public.reserve_owner_login_attempt(text, text, text) from public, anon, authenticated;
grant execute on function public.reserve_owner_login_attempt(text, text, text) to service_role;
revoke all on function public.apply_owner_login_rate_limit(uuid, boolean) from public, anon, authenticated;
grant execute on function public.apply_owner_login_rate_limit(uuid, boolean) to service_role;
revoke all on function public.complete_owner_login_attempt(uuid, boolean) from public, anon, authenticated;
grant execute on function public.complete_owner_login_attempt(uuid, boolean) to service_role;
