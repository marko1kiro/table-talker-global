-- Fase 1 remediation (audit table-talker-global, ref commit 8d4f091):
-- C-01 (PIN bypass at the authorization boundary), H-01 (rotate/deactivate
-- doesn't revoke role_session_tokens), H-02 (pin column missing an official
-- migration -- closed by this file existing at all).
--
-- Context: `restaurants.pin` was added directly against production
-- (project kjzxtmxdbcanvkgqqdow) via two migrations applied outside the
-- repo's supabase/migrations/ chain (versions 20260901023637
-- "add_restaurant_pin" and 20260901023659 "backfill_restaurant_pin" --
-- confirmed present in `list_migrations` but absent from git history).
-- Worse, `claim_role_session` (20260829020000_table_occupancy_rpcs.sql)
-- never checks the PIN at all: `verifyRestaurantPin` in
-- restaurants.server.ts is a *separate* serverFn that only reads
-- restaurants.pin for UI feedback. Anyone who can reach claim_role_session
-- directly (a valid Kode Resto + a fresh anonymous auth session is enough --
-- both easy to obtain) bypasses the PIN entirely. This migration:
--   1. Replaces `restaurants.pin` (plaintext) with `restaurants.pin_hash`
--      (sha256 hex, same convention as every other hash column in this
--      codebase: encode(extensions.digest(value,'sha256'),'hex')).
--   2. Moves PIN verification *into* claim_role_session itself, so there is
--      exactly one authorization boundary and it cannot be bypassed by
--      skipping verifyRestaurantPin.
--   3. Adds dual-bucket (per-restaurant + per-tenant-token) PIN attempt
--      rate limiting inside the same RPC transaction, reusing the
--      bucket/failures/window_started_at/blocked_until shape already
--      established by owner_login_rate_limit_buckets
--      (20260824008000_auth_rate_limit_remediation.sql).
--   4. Adds `role_session_tokens.code_version`, backfills it, and adds a
--      matching `restaurants.is_active`/`code_version` check to every RPC
--      that trusts a role_session_tokens row -- closing H-01's gap where
--      rotating/deactivating a restaurant's Kode Resto revoked
--      restaurant_access_tokens and crew_session_tokens but left any
--      already-issued role_session_tokens (Kasir/Satgas/Clear Up/SS) live
--      until their 9-hour natural expiry.
--   5. Adds the same `delete from role_session_tokens` to
--      rotate_restaurant_credentials and deactivate_restaurant_credentials
--      that already exists for the other two token tables.
--
-- This migration is written to be safe to replay from an empty database
-- (H-03): every backfill statement below is a plain UPDATE with no WHERE
-- clause assuming specific rows exist, so it is a no-op against zero rows.

-- ---------------------------------------------------------------------------
-- Step 1: restaurants.pin (plaintext) -> restaurants.pin_hash (sha256 hex).
-- Guarded with a column-existence check so this is a no-op for a fresh
-- database that never had the ad-hoc `pin` column (it never went through a
-- committed migration there), while still correctly migrating the current
-- production data (where the column does exist).
-- ---------------------------------------------------------------------------
alter table public.restaurants add column pin_hash text
  check (pin_hash is null or pin_hash ~ '^[a-f0-9]{64}$');

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'restaurants' and column_name = 'pin'
  ) then
    update public.restaurants set pin_hash = encode(extensions.digest(pin, 'sha256'), 'hex')
    where pin_hash is null;
  end if;
end;
$$;

do $$
begin
  if exists (select 1 from public.restaurants where pin_hash is null) then
    raise exception 'UNPROVISIONED_RESTAURANT_PIN';
  end if;
end;
$$;

alter table public.restaurants alter column pin_hash set not null;

-- Preserve the uniqueness guarantee the ad-hoc `pin` column had
-- (`restaurants_pin_unique`, from the untracked 20260901023637_
-- add_restaurant_pin migration). Not a security requirement -- PIN checks
-- are always scoped to one restaurant via the tenant token, never looked
-- up globally -- but dropping it silently would still be a behavior
-- regression (two restaurants could start sharing a PIN going forward with
-- no admin-facing signal). Hashing is unsalted sha256 of a 4-digit value,
-- so uniqueness of pin_hash is exactly equivalent to uniqueness of the
-- underlying PIN.
alter table public.restaurants add constraint restaurants_pin_hash_unique unique (pin_hash);

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'restaurants' and column_name = 'pin'
  ) then
    execute 'alter table public.restaurants drop column pin';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Step 2: PIN attempt rate limiting. No client-facing grants at all (only
-- ever touched from inside the security definer claim_role_session below),
-- matching the "no client-facing grants on tables" convention from
-- 20260829020000_table_occupancy_rpcs.sql.
-- ---------------------------------------------------------------------------
create table public.role_session_pin_attempts (
  bucket_hash text primary key check (bucket_hash ~ '^[a-f0-9]{64}$'),
  failures integer not null default 0 check (failures >= 0),
  window_started_at timestamptz not null default now(),
  blocked_until timestamptz
);
alter table public.role_session_pin_attempts enable row level security;
revoke all on public.role_session_pin_attempts from public, anon, authenticated;

create function public.cleanup_role_session_pin_attempts()
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare deleted integer;
begin
  delete from public.role_session_pin_attempts
  where window_started_at < now() - interval '1 day'
    and (blocked_until is null or blocked_until < now());
  get diagnostics deleted = row_count;
  return jsonb_build_object('deleted', deleted);
end;
$$;
revoke all on function public.cleanup_role_session_pin_attempts() from public, anon, authenticated;
grant execute on function public.cleanup_role_session_pin_attempts() to service_role;

-- Fold into the existing daily retention scheduler (run_owner_retention),
-- matching how owner_login_rate_limit cleanup was already wired in.
create or replace function public.run_owner_retention()
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare result jsonb; login_limits jsonb; pin_attempts jsonb;
begin
  result := public.cleanup_owner_retention();
  login_limits := public.cleanup_owner_login_rate_limits();
  pin_attempts := public.cleanup_role_session_pin_attempts();
  result := result || jsonb_build_object(
    'owner_login_rate_limits', login_limits,
    'role_session_pin_attempts', pin_attempts
  );
  perform public.record_owner_retention_success(result);
  return result;
end;
$$;
revoke all on function public.run_owner_retention() from public, anon, authenticated;
grant execute on function public.run_owner_retention() to service_role;

-- ---------------------------------------------------------------------------
-- Step 3: role_session_tokens.code_version, backfilled to each token's
-- restaurant's *current* code_version (best-effort for any pre-existing
-- rows -- these are short-lived 9-hour tokens, so any live ones were almost
-- certainly issued under the current version anyway; this only matters
-- going forward for newly issued tokens, which now always carry the exact
-- version they were issued under).
-- ---------------------------------------------------------------------------
alter table public.role_session_tokens add column code_version integer;
update public.role_session_tokens rst set code_version = r.code_version
from public.restaurants r
where r.id = rst.restaurant_id and rst.code_version is null;
alter table public.role_session_tokens alter column code_version set not null;

-- ---------------------------------------------------------------------------
-- Step 4: claim_role_session gains p_pin, verifies it against
-- restaurants.pin_hash inside the same transaction as the tenant-token
-- check (closing C-01), and is rate-limited per (restaurant_id) and per
-- (tenant_token) bucket -- 5 failures within a 15-minute window blocks that
-- bucket for 15 minutes, identical thresholds to
-- owner_login_rate_limit_buckets. Both buckets are locked in a fixed
-- (sorted) order to avoid deadlocks under concurrent attempts, matching
-- reserve_owner_login_attempt's convention.
--
-- Signature changes (5 params -> 6), so this must be drop-then-create; the
-- old overload's revoke/grant do not carry over and are restated below.
-- ---------------------------------------------------------------------------
drop function if exists public.claim_role_session(uuid, text, text, text, timestamptz);

create function public.claim_role_session(
  p_restaurant_id uuid,
  p_tenant_token text,
  p_role text,
  p_display_name text,
  p_checked_in_at timestamptz,
  p_pin text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.crew_role_sessions;
  v_token text := encode(extensions.gen_random_bytes(32), 'hex');
  v_pin_hash text;
  v_code_version integer;
  v_restaurant_bucket text;
  v_tenant_bucket text;
  v_now timestamptz := now();
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  if p_role not in ('ss', 'kasir', 'satgas', 'clear_up') then raise exception 'INVALID_ROLE'; end if;

  select r.pin_hash, r.code_version into v_pin_hash, v_code_version
  from public.restaurant_access_tokens rat
  join public.restaurants r on r.id = rat.restaurant_id
  where rat.restaurant_id = p_restaurant_id
    and rat.token_hash = encode(extensions.digest(p_tenant_token, 'sha256'), 'hex')
    and rat.expires_at > v_now
    and r.is_active
    and rat.code_version = r.code_version;
  if v_pin_hash is null then raise exception 'INVALID_TENANT_SESSION'; end if;

  if p_display_name !~ '^[[:print:]]+$' or char_length(p_display_name) not between 1 and 40
  then raise exception 'INVALID_NAME'; end if;

  if p_checked_in_at is null then raise exception 'INVALID_CHECKED_IN_AT'; end if;

  if p_pin is null or p_pin !~ '^[0-9]{4}$' then raise exception 'INVALID_PIN'; end if;

  v_restaurant_bucket := encode(extensions.digest('restaurant:' || p_restaurant_id::text, 'sha256'), 'hex');
  v_tenant_bucket := encode(extensions.digest('tenant:' || p_tenant_token, 'sha256'), 'hex');

  insert into public.role_session_pin_attempts(bucket_hash)
  select distinct bucket_hash from unnest(array[v_restaurant_bucket, v_tenant_bucket]) bucket_hash
  order by bucket_hash
  on conflict (bucket_hash) do nothing;

  perform 1 from public.role_session_pin_attempts
  where bucket_hash in (v_restaurant_bucket, v_tenant_bucket)
  order by bucket_hash for update;

  if exists (
    select 1 from public.role_session_pin_attempts
    where bucket_hash in (v_restaurant_bucket, v_tenant_bucket) and blocked_until > v_now
  ) then raise exception 'PIN_RATE_LIMITED'; end if;

  if v_pin_hash <> encode(extensions.digest(p_pin, 'sha256'), 'hex') then
    update public.role_session_pin_attempts set
      failures = case when window_started_at <= v_now - interval '15 minutes' then 1 else failures + 1 end,
      window_started_at = case when window_started_at <= v_now - interval '15 minutes' then v_now else window_started_at end,
      blocked_until = case
        when window_started_at > v_now - interval '15 minutes' and failures + 1 >= 5 then v_now + interval '15 minutes'
        else blocked_until
      end
    where bucket_hash in (v_restaurant_bucket, v_tenant_bucket);
    raise exception 'INVALID_PIN';
  end if;

  update public.role_session_pin_attempts set failures = 0, window_started_at = v_now, blocked_until = null
  where bucket_hash in (v_restaurant_bucket, v_tenant_bucket);

  insert into public.crew_role_sessions (restaurant_id, role, display_name, checked_in_at)
  values (p_restaurant_id, p_role, p_display_name, p_checked_in_at)
  returning * into result;

  insert into public.role_session_tokens (token_hash, restaurant_id, role_session_id, role, expires_at, code_version)
  values (
    encode(extensions.digest(v_token, 'sha256'), 'hex'),
    p_restaurant_id,
    result.id,
    p_role,
    v_now + interval '9 hours',
    v_code_version
  );

  return jsonb_build_object('session', to_jsonb(result), 'session_token', v_token);
end;
$$;
revoke all on function public.claim_role_session(uuid, text, text, text, timestamptz, text) from public, anon, service_role;
grant execute on function public.claim_role_session(uuid, text, text, text, timestamptz, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Step 5: defense-in-depth (H-01 point 2) -- every RPC that trusts an
-- existing role_session_tokens row now also joins restaurants and requires
-- is_active + code_version match, so a role session issued before a
-- rotation/deactivation stops working immediately rather than surviving
-- until its natural 9-hour expiry (belt-and-suspenders alongside Step 6's
-- explicit delete on rotate/deactivate).
-- ---------------------------------------------------------------------------
create or replace function public.set_table_occupied_kasir(
  p_restaurant_id uuid,
  p_table_number integer,
  p_session_token text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session record;
begin
  select rst.* into v_session
  from public.role_session_tokens rst
  join public.restaurants r on r.id = rst.restaurant_id
  where rst.token_hash = encode(extensions.digest(p_session_token, 'sha256'), 'hex')
    and rst.restaurant_id = p_restaurant_id
    and rst.role = 'kasir'
    and rst.expires_at > now()
    and r.is_active
    and rst.code_version = r.code_version;
  if v_session is null then raise exception 'INVALID_SESSION'; end if;

  if p_table_number not between 1 and 100 then raise exception 'INVALID_TABLE_NUMBER'; end if;

  insert into public.table_occupancy_state (restaurant_id, table_number, status, occupied_at, occupied_source)
  values (p_restaurant_id, p_table_number, 'terisi', now(), 'kasir')
  on conflict (restaurant_id, table_number) do update set
    status = 'terisi',
    occupied_at = now(),
    occupied_source = 'kasir',
    updated_at = now()
  where public.table_occupancy_state.status = 'kosong';
end;
$$;
revoke all on function public.set_table_occupied_kasir(uuid, integer, text) from public, anon, service_role;
grant execute on function public.set_table_occupied_kasir(uuid, integer, text) to authenticated;

create or replace function public.set_table_empty_cleanup(
  p_restaurant_id uuid,
  p_table_number integer,
  p_session_token text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session record;
begin
  select rst.* into v_session
  from public.role_session_tokens rst
  join public.restaurants r on r.id = rst.restaurant_id
  where rst.token_hash = encode(extensions.digest(p_session_token, 'sha256'), 'hex')
    and rst.restaurant_id = p_restaurant_id
    and rst.role = 'clear_up'
    and rst.expires_at > now()
    and r.is_active
    and rst.code_version = r.code_version;
  if v_session is null then raise exception 'INVALID_SESSION'; end if;

  if p_table_number not between 1 and 100 then raise exception 'INVALID_TABLE_NUMBER'; end if;

  insert into public.table_occupancy_state (restaurant_id, table_number, status, occupied_at, occupied_source)
  values (p_restaurant_id, p_table_number, 'kosong', null, null)
  on conflict (restaurant_id, table_number) do update set
    status = 'kosong',
    occupied_at = null,
    occupied_source = null,
    updated_at = now()
  where public.table_occupancy_state.status = 'terisi';
end;
$$;
revoke all on function public.set_table_empty_cleanup(uuid, integer, text) from public, anon, service_role;
grant execute on function public.set_table_empty_cleanup(uuid, integer, text) to authenticated;

create or replace function public.create_escort_intent(
  p_restaurant_id uuid,
  p_table_number integer,
  p_session_token text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session record;
  v_id uuid;
begin
  select rst.* into v_session
  from public.role_session_tokens rst
  join public.restaurants r on r.id = rst.restaurant_id
  where rst.token_hash = encode(extensions.digest(p_session_token, 'sha256'), 'hex')
    and rst.restaurant_id = p_restaurant_id
    and rst.role = 'satgas'
    and rst.expires_at > now()
    and r.is_active
    and rst.code_version = r.code_version;
  if v_session is null then raise exception 'INVALID_SESSION'; end if;

  if p_table_number not between 1 and 100 then raise exception 'INVALID_TABLE_NUMBER'; end if;

  insert into public.table_escort_intents (restaurant_id, table_number, actor_session_id, expires_at)
  values (p_restaurant_id, p_table_number, v_session.role_session_id, now() + interval '30 minutes')
  returning id into v_id;

  return v_id;
end;
$$;
revoke all on function public.create_escort_intent(uuid, integer, text) from public, anon, service_role;
grant execute on function public.create_escort_intent(uuid, integer, text) to authenticated;

create or replace function public.confirm_escort_intent(
  p_intent_id uuid,
  p_session_token text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session record;
  v_intent record;
begin
  select rst.* into v_session
  from public.role_session_tokens rst
  join public.restaurants r on r.id = rst.restaurant_id
  where rst.token_hash = encode(extensions.digest(p_session_token, 'sha256'), 'hex')
    and rst.role = 'satgas'
    and rst.expires_at > now()
    and r.is_active
    and rst.code_version = r.code_version;
  if v_session is null then raise exception 'INVALID_SESSION'; end if;

  select * into v_intent
  from public.table_escort_intents
  where id = p_intent_id
    and restaurant_id = v_session.restaurant_id
    and actor_session_id = v_session.role_session_id
    and expires_at <= now()
    and resolved = false;
  if v_intent is null then raise exception 'INTENT_NOT_FOUND'; end if;

  if not exists (
    select 1 from public.table_occupancy_state
    where restaurant_id = v_intent.restaurant_id
      and table_number = v_intent.table_number
      and status = 'kosong'
  ) and exists (
    select 1 from public.table_occupancy_state
    where restaurant_id = v_intent.restaurant_id
      and table_number = v_intent.table_number
  ) then raise exception 'ALREADY_OCCUPIED'; end if;

  insert into public.table_occupancy_state (restaurant_id, table_number, status, occupied_at, occupied_source)
  values (v_intent.restaurant_id, v_intent.table_number, 'terisi', now(), 'satgas_escort')
  on conflict (restaurant_id, table_number) do update set
    status = 'terisi',
    occupied_at = now(),
    occupied_source = 'satgas_escort',
    updated_at = now()
  where public.table_occupancy_state.status = 'kosong';

  if not found then raise exception 'ALREADY_OCCUPIED'; end if;

  update public.table_escort_intents set resolved = true where id = p_intent_id;
end;
$$;
revoke all on function public.confirm_escort_intent(uuid, text) from public, anon, service_role;
grant execute on function public.confirm_escort_intent(uuid, text) to authenticated;

create or replace function public.get_table_occupancy_snapshot(
  p_restaurant_id uuid,
  p_session_token text
)
returns table (
  table_number integer,
  status text,
  occupied_at timestamptz,
  occupied_source text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session record;
begin
  select rst.* into v_session
  from public.role_session_tokens rst
  join public.restaurants r on r.id = rst.restaurant_id
  where rst.token_hash = encode(extensions.digest(p_session_token, 'sha256'), 'hex')
    and rst.restaurant_id = p_restaurant_id
    and rst.role <> 'ss'
    and rst.expires_at > now()
    and r.is_active
    and rst.code_version = r.code_version;
  if v_session is null then raise exception 'INVALID_SESSION'; end if;

  return query
  select
    gs.table_number,
    coalesce(tos.status, 'kosong'),
    tos.occupied_at,
    tos.occupied_source
  from generate_series(1, 100) as gs(table_number)
  left join public.table_occupancy_state tos
    on tos.restaurant_id = p_restaurant_id
    and tos.table_number = gs.table_number
  order by gs.table_number;
end;
$$;
revoke all on function public.get_table_occupancy_snapshot(uuid, text) from public, anon, service_role;
grant execute on function public.get_table_occupancy_snapshot(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Step 6: rotate/deactivate now also revoke role_session_tokens (H-01
-- point 1). Signatures are unchanged, so grants carry over automatically;
-- revokes/grants are restated for auditability, matching repo convention.
-- ---------------------------------------------------------------------------
create or replace function public.rotate_restaurant_credentials(p_restaurant_id uuid, p_code text, p_next_code_version integer)
returns void language plpgsql security definer set search_path = public as $$
declare v_current_code_version integer;
begin
  if p_code is null or p_code !~ '^[A-Z0-9-]{6,32}$' then raise exception 'INVALID_CREDENTIAL'; end if;
  select code_version into v_current_code_version from public.restaurants where id = p_restaurant_id for update;
  if v_current_code_version is null then raise exception 'RESTAURANT_NOT_FOUND'; end if;
  if p_next_code_version <= v_current_code_version then raise exception 'INVALID_CODE_VERSION'; end if;
  update public.restaurants set code = p_code, code_version = p_next_code_version, credential_rotated_at = now() where id = p_restaurant_id;
  delete from public.restaurant_access_tokens where restaurant_id = p_restaurant_id;
  delete from public.crew_session_tokens where restaurant_id = p_restaurant_id;
  delete from public.role_session_tokens where restaurant_id = p_restaurant_id;
end;
$$;
revoke all on function public.rotate_restaurant_credentials(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.rotate_restaurant_credentials(uuid, text, integer) to service_role;

create or replace function public.deactivate_restaurant_credentials(p_restaurant_id uuid, p_next_code_version integer)
returns void language plpgsql security definer set search_path = public as $$
declare v_current_code_version integer;
begin
  select code_version into v_current_code_version from public.restaurants where id = p_restaurant_id for update;
  if v_current_code_version is null then raise exception 'RESTAURANT_NOT_FOUND'; end if;
  if p_next_code_version <= v_current_code_version then raise exception 'INVALID_CODE_VERSION'; end if;
  update public.restaurants set is_active = false, code_version = p_next_code_version, credential_rotated_at = now() where id = p_restaurant_id;
  delete from public.restaurant_access_tokens where restaurant_id = p_restaurant_id;
  delete from public.crew_session_tokens where restaurant_id = p_restaurant_id;
  delete from public.role_session_tokens where restaurant_id = p_restaurant_id;
end;
$$;
revoke all on function public.deactivate_restaurant_credentials(uuid, integer) from public, anon, authenticated;
grant execute on function public.deactivate_restaurant_credentials(uuid, integer) to service_role;
