-- Poin 3: crew shift-claim + manager crew-admin RPCs. The account flow replaces
-- the old code+PIN check-in: a paired crew email account (auth.uid()) claims a
-- role shift for a device, and gets BOTH a role_session_token (9h, same shape
-- and expiry convention as claim_role_session) AND a fresh restaurant
-- tenant/access token (1h, same columns and expiry convention as
-- login_to_restaurant_atomic) in one call. There is no PIN step: the account +
-- pairing lifecycle IS the authorization. The tenant token is minted because
-- the audio / playback / event-flush / error-capture infra authenticates
-- devices with TENANT tokens (verifyActiveTenantSession reads
-- restaurant_access_tokens), so the browser identity object
-- (RoleSessionIdentity / CrewSessionIdentity) must stay fully populatable.
-- Result contract mirrors 20260913110000_crew_pairing_rpcs.sql: UNAUTHORIZED /
-- INVALID_ROLE / INVALID_DEVICE / INVALID_CHECKED_IN_AT / NOT_PAIRED /
-- ACCOUNT_DISABLED / INVALID_SESSION are RAISED (pre-state or auth failures,
-- nothing to persist); manager out-of-scope / unknown target collapses to one
-- generic {ok:false,error:'NOT_FOUND'} (no existence leak across restaurants).
-- Device binding is sha256 of an opaque client device token; a device change
-- revokes every role_session_token for this uid's sessions. An advisory xact
-- lock + FOR UPDATE on the account row serialize device rotation; the pairing
-- confirm re-pins the account via the SAME row lock (it does not take the
-- advisory key), so a concurrent re-pair and re-claim cannot interleave.

-- Step 1: shift claim. auth.uid()-scoped (like claim_role_session): revoked
-- from public/anon/service_role, granted to authenticated.
create or replace function public.crew_shift_claim(
  p_role text,
  p_checked_in_at timestamptz,
  p_device_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_acc public.crew_accounts%rowtype;
  v_rest public.restaurants%rowtype;
  v_device_hash text;
  v_token text;
  v_tenant text;
  v_session public.crew_role_sessions;
begin
  if v_uid is null then raise exception 'UNAUTHORIZED'; end if;
  if p_device_token is null or char_length(p_device_token) < 16 then
    raise exception 'INVALID_DEVICE';
  end if;
  if p_role is null or p_role not in ('ss', 'kasir', 'satgas', 'clear_up') then
    raise exception 'INVALID_ROLE';
  end if;
  if p_checked_in_at is null then raise exception 'INVALID_CHECKED_IN_AT'; end if;

  v_device_hash := encode(extensions.digest(p_device_token, 'sha256'), 'hex');

  -- serialize device rotation against a concurrent re-pair, then lock the
  -- account row before reading/kicking the device. crew_confirm_pairing re-pins
  -- via the same row lock (its ON CONFLICT DO UPDATE), not this advisory key.
  perform pg_advisory_xact_lock(hashtext('crew_pairing'), hashtext(v_uid::text));
  select * into v_acc from public.crew_accounts where auth_uid = v_uid for update;
  if not found then raise exception 'NOT_PAIRED'; end if;
  if v_acc.status <> 'aktif' then raise exception 'ACCOUNT_DISABLED'; end if;

  -- The account's restaurant may have died since pairing. Reuse the generic
  -- ACCOUNT_DISABLED verdict rather than leaking a distinct "resto gone" code.
  select * into v_rest from public.restaurants
  where id = v_acc.restaurant_id and is_active;
  if not found then raise exception 'ACCOUNT_DISABLED'; end if;

  -- device kick: a different device revokes every role_session_token this uid
  -- ever accumulated, so the old browser's ROLE actions stop immediately. The
  -- tenant token minted alongside them (restaurant_access_tokens, which has no
  -- owner/auth_uid column) is NOT revoked here: it survives orphaned until its
  -- natural <=1h expiry, during which the old device keeps read-only audio /
  -- event-ingest access. Acceptable for a 1h window; if a device must be locked
  -- out of tenant access instantly, record a per-device owner on the tenant row
  -- or add a token registry keyed by auth_uid.
  -- ponytail: ceiling = tenant-token revocation lags the role-token kick by up
  --   to 1h; upgrade path = owner column on restaurant_access_tokens (or a
  --   auth_uid->token registry) so this delete also purges the tenant rows.
  if v_acc.active_device_hash is not null and v_acc.active_device_hash <> v_device_hash then
    delete from public.role_session_tokens
    where role_session_id in (
      select id from public.crew_role_sessions where auth_uid = v_uid
    );
  end if;

  update public.crew_accounts
  set active_device_hash = v_device_hash, updated_at = now()
  where auth_uid = v_uid;

  insert into public.crew_role_sessions (restaurant_id, role, display_name, checked_in_at, auth_uid)
  values (v_acc.restaurant_id, p_role, v_acc.full_name, p_checked_in_at, v_uid)
  returning * into v_session;

  -- role session token: 9h, code_version pinned to the restaurant (claim_role_session convention).
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.role_session_tokens
    (token_hash, restaurant_id, role_session_id, role, expires_at, code_version)
  values
    (encode(extensions.digest(v_token, 'sha256'), 'hex'), v_acc.restaurant_id, v_session.id,
     p_role, now() + interval '9 hours', v_rest.code_version);

  -- tenant token: 1h, restaurant_access_tokens(token_hash, restaurant_id,
  -- code_version, expires_at) — exactly the column set and the now()+1h expiry
  -- convention login_to_restaurant_atomic's caller (restaurants.server.ts) uses.
  v_tenant := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.restaurant_access_tokens
    (token_hash, restaurant_id, code_version, expires_at)
  values
    (encode(extensions.digest(v_tenant, 'sha256'), 'hex'), v_acc.restaurant_id,
     v_rest.code_version, now() + interval '1 hour');

  return jsonb_build_object(
    'session', to_jsonb(v_session), 'session_token', v_token,
    'tenant_token', v_tenant, 'restaurant_id', v_acc.restaurant_id,
    'restaurant_name', v_rest.display_name, 'restaurant_code', v_rest.code);
end;
$$;
revoke all on function public.crew_shift_claim(text, timestamptz, text) from public, anon, service_role;
grant execute on function public.crew_shift_claim(text, timestamptz, text) to authenticated;

-- Step 2: browser bootstrap. auth.uid()-scoped account probe: is this uid
-- paired, and is the calling device the currently-pinned one? A nonaktif
-- account still reports paired:true so the client can render the disabled
-- state; it never gets to claim (see crew_shift_claim's ACCOUNT_DISABLED).
create or replace function public.crew_me(p_device_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_acc public.crew_accounts%rowtype;
  v_rest_name text;
  v_device_hash text;
begin
  if v_uid is null then raise exception 'UNAUTHORIZED'; end if;
  select * into v_acc from public.crew_accounts where auth_uid = v_uid;
  if not found then return jsonb_build_object('paired', false); end if;

  select display_name into v_rest_name from public.restaurants where id = v_acc.restaurant_id;
  if p_device_token is not null and char_length(p_device_token) >= 16 then
    v_device_hash := encode(extensions.digest(p_device_token, 'sha256'), 'hex');
  end if;

  return jsonb_build_object(
    'paired', true, 'status', v_acc.status, 'full_name', v_acc.full_name,
    'restaurant_id', v_acc.restaurant_id, 'restaurant_name', v_rest_name,
    -- active_device_hash is null before the first claim, so the boolean must be
    -- coalesced (a bare `null = hash` comparison would yield a JSON null).
    'device_current', coalesce(
      v_device_hash is not null and v_acc.active_device_hash = v_device_hash, false));
end;
$$;
revoke all on function public.crew_me(text) from public, anon, service_role;
grant execute on function public.crew_me(text) to authenticated;

-- Step 3: manager crew roster. Same bearer-token auth / INVALID_SESSION raise
-- as get_crew_pairing_requests, but reads crew_accounts (not pending requests).
-- active_sessions counts live (unexpired) role_session_tokens reached through
-- this account's role sessions; has_active_device reflects the pinned device.
create or replace function public.get_crew_accounts(p_manager_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant uuid;
begin
  select ms.restaurant_id into v_restaurant
  from public.manager_sessions ms
  join public.manager_accounts ma on ma.id = ms.manager_id
  join public.restaurants r on r.id = ms.restaurant_id
  where ms.token_hash = encode(extensions.digest(p_manager_token, 'sha256'), 'hex')
    and ma.status = 'aktif'
    and ms.expires_at > now()
    and r.is_active;
  if v_restaurant is null then raise exception 'INVALID_SESSION'; end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'auth_uid', q.auth_uid, 'email', q.email, 'full_name', q.full_name,
      'status', q.status, 'paired_at', q.paired_at,
      'has_active_device', q.active_device_hash is not null,
      'active_sessions', q.active_sessions))
    from (
      select ca.auth_uid, ca.email, ca.full_name, ca.status, ca.paired_at, ca.active_device_hash,
        (
          select count(*)
          from public.role_session_tokens rst
          join public.crew_role_sessions crs on crs.id = rst.role_session_id
          where crs.auth_uid = ca.auth_uid and rst.expires_at > now()
        ) as active_sessions
      from public.crew_accounts ca
      where ca.restaurant_id = v_restaurant
      order by ca.paired_at desc
      limit 200
    ) q
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.get_crew_accounts(text) from public, anon, service_role;
grant execute on function public.get_crew_accounts(text) to authenticated;

-- Step 4: manager reset of one crew account. Same manager CTE / scope checks as
-- get_crew_accounts; out-of-scope or unknown target -> generic NOT_FOUND. The
-- account row is kept (status 'nonaktif', device hash wiped) so the email stays
-- re-registerable through the Task 4 pairing flow (ALREADY_PAIRED only blocks
-- aktif). All role session tokens for the uid are deleted (device locked out),
-- and the action is audited.
create or replace function public.reset_crew_account(
  p_manager_token text,
  p_auth_uid uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_manager uuid;
  v_manager_label text;
  v_restaurant uuid;
  v_acc public.crew_accounts%rowtype;
begin
  select ms.manager_id, ma.id_manager, ms.restaurant_id
  into v_manager, v_manager_label, v_restaurant
  from public.manager_sessions ms
  join public.manager_accounts ma on ma.id = ms.manager_id
  join public.restaurants r on r.id = ms.restaurant_id
  where ms.token_hash = encode(extensions.digest(p_manager_token, 'sha256'), 'hex')
    and ma.status = 'aktif'
    and ms.expires_at > now()
    and r.is_active;
  if v_restaurant is null then raise exception 'INVALID_SESSION'; end if;

  select * into v_acc from public.crew_accounts
  where auth_uid = p_auth_uid and restaurant_id = v_restaurant
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;

  update public.crew_accounts
  set status = 'nonaktif', active_device_hash = null, updated_at = now()
  where auth_uid = p_auth_uid;

  delete from public.role_session_tokens
  where role_session_id in (
    select id from public.crew_role_sessions where auth_uid = p_auth_uid
  );

  perform public.write_admin_audit('manager', v_manager, v_manager_label, 'crew.account.reset',
    'crew', p_auth_uid, v_restaurant, 'ok', null, null);
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.reset_crew_account(text, uuid) from public, anon, service_role;
grant execute on function public.reset_crew_account(text, uuid) to authenticated;

-- Step 5: manager force-end of live role sessions without disabling the account.
-- Deletes only the still-live tokens (natural re-auth is then allowed), leaves
-- the aktif account untouched, and audits.
create or replace function public.end_active_crew_sessions(
  p_manager_token text,
  p_auth_uid uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_manager uuid;
  v_manager_label text;
  v_restaurant uuid;
  v_found boolean;
begin
  select ms.manager_id, ma.id_manager, ms.restaurant_id
  into v_manager, v_manager_label, v_restaurant
  from public.manager_sessions ms
  join public.manager_accounts ma on ma.id = ms.manager_id
  join public.restaurants r on r.id = ms.restaurant_id
  where ms.token_hash = encode(extensions.digest(p_manager_token, 'sha256'), 'hex')
    and ma.status = 'aktif'
    and ms.expires_at > now()
    and r.is_active;
  if v_restaurant is null then raise exception 'INVALID_SESSION'; end if;

  select exists (
    select 1 from public.crew_accounts
    where auth_uid = p_auth_uid and restaurant_id = v_restaurant
  ) into v_found;
  if not v_found then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;

  delete from public.role_session_tokens rst
  where rst.expires_at > now()
    and rst.role_session_id in (
      select id from public.crew_role_sessions where auth_uid = p_auth_uid
    );

  perform public.write_admin_audit('manager', v_manager, v_manager_label, 'crew.sessions.end',
    'crew', p_auth_uid, v_restaurant, 'ok', null, null);
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.end_active_crew_sessions(text, uuid) from public, anon, service_role;
grant execute on function public.end_active_crew_sessions(text, uuid) to authenticated;
