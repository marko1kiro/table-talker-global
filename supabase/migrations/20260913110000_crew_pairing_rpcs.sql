-- Poin 3: crew pairing lifecycle RPCs. OTP generation/encryption lives in the
-- SERVER layer (Task 6) — these RPCs only ever receive the sha256 hash and an
-- opaque AES-GCM envelope; plaintext OTP never enters or leaves the database,
-- and the manager listing exposes only the envelope for the server to decrypt.
-- Browser-facing (auth.uid()-scoped) functions follow the claim_role_session
-- grant pattern: revoked from public/anon/service_role, granted to
-- authenticated. Manager-bearer functions mirror get_manager_snapshot: same
-- token-hash auth, same INVALID_SESSION raise, service_role revoked.
-- Result contract: UNAUTHORIZED / INVALID_CODE / INVALID_NAME / ALREADY_PAIRED
-- / INTERNAL / NOT_FOUND / INVALID_SESSION are RAISED (unexpected or
-- pre-state failures); pairing business verdicts (EXPIRED, NOT_PENDING,
-- INVALID_OTP, TOO_MANY_ATTEMPTS, dead-resto INVALID_CODE, reject-NOT_FOUND)
-- are RETURNED as {ok:false,error:...} jsonb so the attempts counter and
-- lazy-expire status write-ups COMMIT with the verdict instead of rolling back
-- with a raise (same shape as the Poin 2 mutating RPCs).

-- Step 1: kode resto -> restaurant identity. The crew app shows display_name
-- before any pairing row exists. Case-insensitive: the restaurants code CHECK
-- (20260831000000: `^[A-Z0-9-]{6,32}$`) forces stored codes uppercase, so
-- lower(trim(input)) against lower(code) is collision-safe.
create or replace function public.crew_validate_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant_id uuid;
  v_display_name text;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  select id, display_name into v_restaurant_id, v_display_name
  from public.restaurants
  where lower(code) = lower(trim(p_code)) and is_active;
  if v_restaurant_id is null then raise exception 'INVALID_CODE'; end if;
  return jsonb_build_object('restaurant_id', v_restaurant_id, 'display_name', v_display_name);
end;
$$;
revoke all on function public.crew_validate_code(text) from public, anon, service_role;
grant execute on function public.crew_validate_code(text) to authenticated;

-- Step 2: request pairing. The email is derived from the auth.users row of the
-- CALLER (never trusted from the client); full_name is validated here with the
-- same printability/length rule claim_role_session uses for display names.
-- NEWEST-WINS re-request semantics (runbook): every previous pending of this
-- uid is expired BEFORE the insert, so the single-pending partial unique index
-- can never clash and the newest request is always the live one. There is no
-- PAIRING_PENDING verdict: a double-tapped crew simply replaces their pending
-- row, and the OTP the manager must read is the one on the MOST RECENT row
-- (get_crew_pairing_requests already orders created_at desc — top of the list;
-- older pendings of the same uid show status 'expired' in the DB and are not
-- listed). A nonaktif account (manager reset) may re-pair; only an aktif
-- account is hard-blocked with ALREADY_PAIRED.
create or replace function public.crew_request_pairing(
  p_restaurant_id uuid,
  p_full_name text,
  p_otp_hash text,
  p_otp_encrypted text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_id uuid;
begin
  if v_uid is null then raise exception 'UNAUTHORIZED'; end if;
  if p_full_name is null or p_full_name !~ '^[[:print:]]+$'
     or char_length(p_full_name) not between 1 and 40 then
    raise exception 'INVALID_NAME';
  end if;
  -- server-supplied crypto material must be well-formed; anything else is a
  -- server bug, surfaced as INTERNAL (never leaks into a user-facing code)
  if p_otp_hash is null or p_otp_hash !~ '^[a-f0-9]{64}$'
     or p_otp_encrypted is null or p_otp_encrypted !~ '^4c494d4551523031[a-f0-9]+$' then
    raise exception 'INTERNAL';
  end if;
  if not exists (select 1 from public.restaurants where id = p_restaurant_id and is_active) then
    raise exception 'INVALID_CODE';
  end if;
  if exists (select 1 from public.crew_accounts where auth_uid = v_uid and status = 'aktif') then
    raise exception 'ALREADY_PAIRED';
  end if;
  select email into v_email from auth.users where id = v_uid;
  if v_email is null then raise exception 'UNAUTHORIZED'; end if;

  update public.crew_pairing_requests
  set status = 'expired'
  where auth_uid = v_uid and status = 'pending';

  insert into public.crew_pairing_requests
    (auth_uid, restaurant_id, email, full_name, otp_hash, otp_encrypted, expires_at)
  values
    (v_uid, p_restaurant_id, v_email, p_full_name, p_otp_hash, p_otp_encrypted,
     now() + interval '15 minutes')
  returning id into v_id;
  return jsonb_build_object('ok', true, 'request_id', v_id);
end;
$$;
revoke all on function public.crew_request_pairing(uuid, text, text, text) from public, anon, service_role;
grant execute on function public.crew_request_pairing(uuid, text, text, text) to authenticated;

-- Step 3: confirm with the sha256 of the OTP the server computed. Verdicts are
-- RETURNED (never raised) so the persisted attempts/lazy-expire survive.
-- attempts is incremented BEFORE the hash comparison and the check constraint
-- caps it at 5, so >= 5 is turned into expired + TOO_MANY_ATTEMPTS before any
-- increment (5 wrong attempts burn the request; the 6th call reports it).
create or replace function public.crew_confirm_pairing(
  p_request_id uuid,
  p_otp_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_req public.crew_pairing_requests%rowtype;
begin
  if v_uid is null then raise exception 'UNAUTHORIZED'; end if;
  if p_otp_hash is null or p_otp_hash !~ '^[a-f0-9]{64}$' then raise exception 'INTERNAL'; end if;

  select * into v_req from public.crew_pairing_requests
  where id = p_request_id and auth_uid = v_uid
  for update;
  if not found then raise exception 'NOT_FOUND'; end if;

  if v_req.status <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'NOT_PENDING');
  end if;
  if v_req.expires_at < now() then
    update public.crew_pairing_requests set status = 'expired' where id = p_request_id;
    return jsonb_build_object('ok', false, 'error', 'EXPIRED');
  end if;
  if v_req.attempts >= 5 then
    update public.crew_pairing_requests set status = 'expired' where id = p_request_id;
    return jsonb_build_object('ok', false, 'error', 'TOO_MANY_ATTEMPTS');
  end if;

  update public.crew_pairing_requests set attempts = attempts + 1 where id = p_request_id;
  if v_req.otp_hash <> p_otp_hash then
    return jsonb_build_object('ok', false, 'error', 'INVALID_OTP');
  end if;

  -- The restaurant may have died between request and confirm. Do not approve
  -- against an inactive resto: the request is expired so it can never be
  -- retried, and the crew account is left untouched (same generic INVALID_CODE
  -- the client already knows how to render).
  if not exists (
    select 1 from public.restaurants where id = v_req.restaurant_id and is_active
  ) then
    update public.crew_pairing_requests set status = 'expired' where id = p_request_id;
    return jsonb_build_object('ok', false, 'error', 'INVALID_CODE');
  end if;

  update public.crew_pairing_requests
  set status = 'approved', decided_at = now()
  where id = p_request_id;

  -- Self-service pairing has no manager actor: paired_by stays null. An
  -- existing (nonaktif) account is re-activated and re-pointed atomically,
  -- and its active_device_hash is wiped: the device binding belongs to the
  -- old pairing and must not survive a manager-reset re-pair.
  insert into public.crew_accounts
    (auth_uid, restaurant_id, email, full_name, status, active_device_hash, paired_by, paired_at)
  values
    (v_uid, v_req.restaurant_id, v_req.email, v_req.full_name, 'aktif', null, null, now())
  on conflict (auth_uid) do update set
    restaurant_id = excluded.restaurant_id,
    full_name = excluded.full_name,
    email = excluded.email,
    status = 'aktif',
    active_device_hash = null,
    paired_at = now(),
    updated_at = now();

  perform public.write_admin_audit('system', null, null, 'crew.pairing.approve',
    'crew', v_uid, v_req.restaurant_id, 'ok', null,
    jsonb_build_object('request_id', p_request_id));
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.crew_confirm_pairing(uuid, text) from public, anon, service_role;
grant execute on function public.crew_confirm_pairing(uuid, text) to authenticated;

-- Step 4: manager review list. Same bearer-token auth as get_manager_snapshot
-- (manager_sessions.token_hash = sha256(token), active manager, active
-- restaurant, unexpired session) and the same INVALID_SESSION raise. The
-- envelope is handed out for server-side decryption; the hash never leaves.
create or replace function public.get_crew_pairing_requests(p_manager_token text)
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

  -- lazy-expire, globally: the list is the manager dashboard's only expiry pump
  update public.crew_pairing_requests
  set status = 'expired'
  where status = 'pending' and expires_at < now();

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', q.id, 'email', q.email, 'full_name', q.full_name,
      'otp_encrypted', q.otp_encrypted, 'created_at', q.created_at, 'expires_at', q.expires_at))
    from (
      select id, email, full_name, otp_encrypted, created_at, expires_at
      from public.crew_pairing_requests
      where restaurant_id = v_restaurant and status = 'pending'
      order by created_at desc
      limit 50
    ) q
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.get_crew_pairing_requests(text) from public, anon, service_role;
grant execute on function public.get_crew_pairing_requests(text) to authenticated;

-- Step 5: manager rejection. Same auth; out-of-scope or non-pending collapse
-- to one generic NOT_FOUND verdict (no existence leak across restaurants).
create or replace function public.reject_crew_pairing_request(
  p_manager_token text,
  p_request_id uuid
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
  v_req public.crew_pairing_requests%rowtype;
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

  select * into v_req from public.crew_pairing_requests
  where id = p_request_id and restaurant_id = v_restaurant and status = 'pending'
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;

  update public.crew_pairing_requests
  set status = 'rejected', decided_by = v_manager, decided_at = now()
  where id = p_request_id;

  perform public.write_admin_audit('manager', v_manager, v_manager_label, 'crew.pairing.reject',
    'crew', v_req.auth_uid, v_req.restaurant_id, 'ok', null,
    jsonb_build_object('request_id', p_request_id));
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.reject_crew_pairing_request(text, uuid) from public, anon, service_role;
grant execute on function public.reject_crew_pairing_request(text, uuid) to authenticated;
