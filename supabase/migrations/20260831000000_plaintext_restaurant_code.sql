-- Revert restaurant-code storage from hash+AES-encrypted back to PLAIN TEXT,
-- and remove the tenant/restaurant-code login rate-limiting subsystem
-- entirely. User decision, 2026-08-31 (see chat: "gw mau KODE RESTO itu
-- diperlakukan sebagai PLAIN TEXT. bukan PASSWORD/HASH." + "Hilangkan Rate
-- Limiting !"), triggered by a production incident: Kampung Bulu (CKRBUL)
-- could not log in because its code_encrypted could not be decrypted with
-- the currently active RESTAURANT_CODE_ENCRYPTION_KEY (the key rotated in
-- production between Kampung Bulu's 27-Aug credential rotation and every
-- other restaurant's later 28-30-Aug provisioning). Storing the code in
-- plain text permanently removes this whole class of bug, since there is no
-- encryption key to go stale.
--
-- Scope, per explicit user answers:
-- 1. "ya hapus total saja." -- fully drop code_hash/code_encrypted, add back
--    a single plain `code` column.
-- 2. "tetap strict UPPERCASE." -- validateRestaurantCode's regex
--    (^[A-Z0-9-]{6,32}$) is UNCHANGED; the new unique index on `code` is
--    therefore intentionally case-sensitive (no lower()), matching that
--    strict-uppercase contract.
-- 3. User supplied all 9 restaurants' plain codes directly, so no
--    decryption/backfill script is needed; this migration backfills them
--    by UUID (see Step 3).
-- 4. "Hilangkan Rate Limiting !" -- tenant_login_rate_limits and
--    tenant_global_login_rate_limits (plus every RPC touching them) are
--    dropped outright. This does NOT touch the separate, unrelated
--    owner_login_rate_limit_buckets/owner_login_rate_limit_reservations
--    system (Owner/Super-Admin dashboard login), which is out of scope and
--    left completely untouched.
-- 5. Dedicated branch fix/plaintext-restaurant-code (not on Task 9's
--    branch), per user's request.
--
-- Audit logging (restaurant_credential_audit / writeRestaurantCredentialAudit)
-- was NOT explicitly named for removal by the user (only "Rate Limiting" was
-- named) and is therefore KEPT, unchanged, by this migration.
--
-- code_version / credential_rotated_at and the version-binding pattern on
-- restaurant_access_tokens / crew_session_tokens / role_session_tokens are
-- orthogonal to hash-vs-plaintext and are PRESERVED unchanged: rotating or
-- deactivating a restaurant's plain-text code still bumps code_version and
-- revokes old tokens exactly as before.

-- ---------------------------------------------------------------------------
-- Step 1: add back a plain `code` column, backfill it, then lock it down.
-- ---------------------------------------------------------------------------
alter table public.restaurants add column code text;

-- ---------------------------------------------------------------------------
-- Step 2: backfill every currently known restaurant's plain code, keyed by
-- UUID (authoritative list confirmed live against production, project
-- kjzxtmxdbcanvkgqqdow, 2026-08-31) and cross-referenced against the user's
-- supplied code list. Any restaurant created after this migration must
-- supply `code` directly through createRestaurant (see admin-restaurants.
-- server.ts), so this backfill is a one-time, closed list.
-- ---------------------------------------------------------------------------
update public.restaurants set code = 'BKSBAN' where id = 'b519a58f-1ecb-4131-9c69-4fa2a1bae18a'; -- Bantar Gebang Sétu
update public.restaurants set code = 'BKSMUT' where id = '08da5334-4244-4db7-9f63-74a0d675529c'; -- Cut Mutia
update public.restaurants set code = 'CKRTHA' where id = '19b17c7c-8847-466e-a2f7-215787d361c6'; -- M.H. Thamrin
update public.restaurants set code = 'CKRTAR' where id = '09828e0e-77f1-432c-81bc-3f5b82bf7ba3'; -- Tarum Barat
update public.restaurants set code = 'CKRMAR' where id = '51a23c85-7e72-4395-ba88-710cfbc200e8'; -- R.E. Martadinata
update public.restaurants set code = 'CKRCIK' where id = '10587808-9ab2-42b2-a190-e2205c25c2a2'; -- Cikoronjo Cibarusah
update public.restaurants set code = 'CKRBUL' where id = '33916a05-7e95-42fa-bc3c-050bed2402c5'; -- Kampung Bulu
update public.restaurants set code = 'BKSGOL' where id = '98aa2a5c-560c-42e3-ace6-e8561cb40f62'; -- Golden City
update public.restaurants set code = 'CKRBOS' where id = 'fa2dea0f-8c68-4c2f-bb72-17c34825c61e'; -- Bosih Raya

-- Fail loudly (instead of silently leaving rows unloginable) if any
-- restaurant is not covered by the fixed backfill list above -- mirrors the
-- fail-closed convention of 20260823120000_remove_legacy_restaurant_code.sql.
do $$
begin
  if exists (select 1 from public.restaurants where code is null) then
    raise exception 'UNPROVISIONED_RESTAURANT_PLAINTEXT_CODE';
  end if;
end;
$$;

alter table public.restaurants alter column code set not null;
alter table public.restaurants add constraint restaurants_code_format
  check (code ~ '^[A-Z0-9-]{6,32}$');
create unique index restaurants_code_key on public.restaurants (code);

-- ---------------------------------------------------------------------------
-- Step 3: drop the hash/encrypted columns and their unique index entirely
-- (user's point 1: "ya hapus total saja").
-- ---------------------------------------------------------------------------
drop index if exists public.restaurants_code_hash_key;
alter table public.restaurants drop column if exists code_hash;
alter table public.restaurants drop column if exists code_encrypted;

-- ---------------------------------------------------------------------------
-- Step 4: rewrite login_to_restaurant_atomic. Drops all rate-limit params
-- and logic; looks up the restaurant by direct plain `code` equality
-- instead of a lookup hash. Return shape (p_rid, p_rname, p_rversion) is
-- kept identical so restaurants.server.ts's `login.p_rid` etc. access
-- pattern is unaffected.
--
-- Must drop-then-create (not create-or-replace) because the parameter list
-- is changing.
-- ---------------------------------------------------------------------------
drop function if exists public.login_to_restaurant_atomic(text, text, text, text, timestamptz);

create function public.login_to_restaurant_atomic(
  p_code text,
  p_token_hash text,
  p_expires_at timestamptz
)
returns table(p_rid uuid, p_rname text, p_rversion integer)
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_now timestamptz := now();
  v_restaurant public.restaurants%rowtype;
begin
  if p_code is null
    or p_token_hash is null
    or p_expires_at is null
    or p_code !~ '^[A-Z0-9-]{6,32}$'
    or p_token_hash !~ '^[a-f0-9]{64}$'
    or p_expires_at <= v_now
    or p_expires_at > v_now + interval '1 hour' + interval '5 minutes' then
    raise exception 'INVALID_LOGIN_INPUT';
  end if;

  select * into v_restaurant from public.restaurants
  where code = p_code and is_active
  for key share;
  if not found then
    return;
  end if;

  insert into public.restaurant_sessions(restaurant_id, session_date)
  values (v_restaurant.id, current_date)
  on conflict (restaurant_id, session_date) do update
  set restaurant_id = excluded.restaurant_id;
  insert into public.restaurant_access_tokens(token_hash, restaurant_id, code_version, expires_at)
  values (p_token_hash, v_restaurant.id, v_restaurant.code_version, p_expires_at);
  return query select v_restaurant.id, v_restaurant.display_name, v_restaurant.code_version;
end;
$$;

revoke all on function public.login_to_restaurant_atomic(text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.login_to_restaurant_atomic(text, text, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- Step 5: rewrite provision_restaurant_credentials / rotate_restaurant_
-- credentials to take a plain `code` parameter instead of
-- (code_hash, code_encrypted). deactivate_restaurant_credentials is
-- unaffected (never touched code_hash/code_encrypted) and is intentionally
-- left alone.
-- ---------------------------------------------------------------------------
drop function if exists public.provision_restaurant_credentials(uuid, text, text);
create function public.provision_restaurant_credentials(p_restaurant_id uuid, p_code text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_code is null or p_code !~ '^[A-Z0-9-]{6,32}$' then raise exception 'INVALID_CREDENTIAL'; end if;
  update public.restaurants
  set code = p_code, credential_rotated_at = now()
  where id = p_restaurant_id and code is null;
  if not found then raise exception 'RESTAURANT_NOT_PROVISIONABLE'; end if;
  insert into public.restaurant_credential_audit (restaurant_id, operation, success, reason_category)
  values (p_restaurant_id, 'created', true, 'provisioned');
end;
$$;
revoke all on function public.provision_restaurant_credentials(uuid, text) from public, anon, authenticated;
grant execute on function public.provision_restaurant_credentials(uuid, text) to service_role;

drop function if exists public.rotate_restaurant_credentials(uuid, text, text, integer);
create function public.rotate_restaurant_credentials(p_restaurant_id uuid, p_code text, p_next_code_version integer)
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
end;
$$;
revoke all on function public.rotate_restaurant_credentials(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.rotate_restaurant_credentials(uuid, text, integer) to service_role;

-- ---------------------------------------------------------------------------
-- Step 6: remove the tenant/restaurant-code login rate-limiting subsystem
-- entirely (user's point 4: "Hilangkan Rate Limiting !"). This is strictly
-- the TENANT-side system; the separate OWNER-side
-- owner_login_rate_limit_buckets/owner_login_rate_limit_reservations system
-- (Super Admin dashboard login) is untouched.
-- ---------------------------------------------------------------------------
drop function if exists public.check_tenant_login_rate_limit(text, text);
drop function if exists public.record_tenant_login_failure(text, text);
drop function if exists public.clear_tenant_login_failures(text, text);
drop function if exists public.check_global_tenant_login_rate_limit(text);
drop function if exists public.record_global_tenant_login_failure(text);
drop function if exists public.clear_global_tenant_login_failures(text);
drop function if exists public.cleanup_tenant_login_rate_limits();
drop table if exists public.tenant_login_rate_limits;
drop table if exists public.tenant_global_login_rate_limits;

-- run_owner_retention() must stop calling the now-dropped
-- cleanup_tenant_login_rate_limits() and stop reporting tenant_login_rate_limits
-- in its result. Owner-side login rate limiting (cleanup_owner_login_rate_limits)
-- is untouched.
create or replace function public.run_owner_retention()
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare result jsonb; login_limits jsonb;
begin
  result := public.cleanup_owner_retention();
  login_limits := public.cleanup_owner_login_rate_limits();
  result := result || jsonb_build_object('owner_login_rate_limits', login_limits);
  perform public.record_owner_retention_success(result);
  return result;
end;
$$;
revoke all on function public.run_owner_retention() from public, anon, authenticated;
grant execute on function public.run_owner_retention() to service_role;
