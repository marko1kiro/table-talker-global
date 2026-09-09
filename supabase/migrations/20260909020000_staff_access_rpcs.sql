-- Poin 2: privileged staff RPCs. Every function is SECURITY DEFINER with a
-- pinned search_path and is granted ONLY to service_role — they are callable
-- exclusively from trusted server functions, never from a browser (review B5:
-- EXECUTE is revoked from PUBLIC/anon/authenticated on EVERY Poin 2 function;
-- there is no default-PUBLIC surface left). Each mutating function re-derives
-- authority from its actor parameters (never from frontend-provided scope)
-- and writes to the append-only admin_audit_log.
--
-- Result contract (review B8): mutating RPCs return a jsonb verdict
--   {ok: true, id?: uuid} | {ok: false, error: code}
-- instead of raising for business outcomes. A denial writes its audit row and
-- COMMITS with the verdict — the transaction never rolls the audit away.
-- Raising is reserved for truly unexpected failures. Concurrent AM-scoped
-- actions share the 'area_manager_lifecycle' advisory lock with assignment
-- revocation and AM deactivation, and RE-CHECK authority after acquiring it
-- (review A3): a revoke/deactivate that commits first makes every later
-- scoped action fail.
-- Forward-only; no data migration, no backfilled accounts.

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------

create or replace function public.normalize_staff_id(p_raw text)
returns text
language sql
stable
as $$ select lower(trim(p_raw)) $$;

create or replace function public.staff_id_is_valid(p_staff_id text)
returns boolean
language sql
stable
as $$ select p_staff_id ~ '^[a-z0-9._-]{3,32}$' $$;

-- Pure helpers are not part of the browser surface either (B5 hygiene):
-- service_role only, no default PUBLIC execute.
revoke all on function public.normalize_staff_id(text) from public, anon, authenticated;
grant execute on function public.normalize_staff_id(text) to service_role;
revoke all on function public.staff_id_is_valid(text) from public, anon, authenticated;
grant execute on function public.staff_id_is_valid(text) to service_role;

create or replace function public.write_admin_audit(
  p_actor_kind text,
  p_actor_id uuid,
  p_actor_label text,
  p_action text,
  p_target_kind text,
  p_target_id uuid,
  p_restaurant_id uuid,
  p_result text,
  p_reason text,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.admin_audit_log
    (actor_kind, actor_id, actor_label, action, target_kind, target_id, restaurant_id, result, reason, metadata)
  values
    (p_actor_kind, p_actor_id, p_actor_label, p_action, p_target_kind, p_target_id, p_restaurant_id,
     coalesce(p_result, 'ok'), p_reason, coalesce(p_metadata, '{}'::jsonb));
$$;
revoke all on function public.write_admin_audit(text, uuid, text, text, text, uuid, uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.write_admin_audit(text, uuid, text, text, text, uuid, uuid, text, text, jsonb) to service_role;

-- Claims a staff ID in the permanent global registry. Raises STAFF_ID_TAKEN
-- on any collision, including collisions with legacy manager_accounts rows
-- compared CASE-INSENSITIVELY (review A2 — 'AgusKasir' must block 'aguskasir'),
-- the account being created in the same transaction excluded so
-- claim-after-insert stays atomic. IDs are never released once their account
-- becomes usable.
create or replace function public.claim_staff_id(
  p_staff_id text,
  p_kind text,
  p_account_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text := lower(trim(p_staff_id));
begin
  if not public.staff_id_is_valid(v_id) then
    raise exception 'STAFF_ID_INVALID';
  end if;
  if p_kind = 'manager' and exists (
    select 1 from public.manager_accounts where lower(id_manager) = v_id and id <> p_account_id
  ) then
    raise exception 'STAFF_ID_TAKEN';
  end if;
  begin
    insert into public.staff_id_registry (staff_id, account_kind, account_id)
    values (v_id, p_kind, p_account_id);
  exception when unique_violation then
    raise exception 'STAFF_ID_TAKEN';
  end;
  return true;
end;
$$;
revoke all on function public.claim_staff_id(text, text, uuid) from public, anon, authenticated;
grant execute on function public.claim_staff_id(text, text, uuid) to service_role;

-- Serializes claim+insert for one staff ID so two concurrent creations of the
-- same ID deterministically produce exactly one winner (advisory transaction
-- lock, released at transaction end).
create or replace function public.lock_staff_id_claim(p_staff_id text)
returns void
language sql
security definer
set search_path = public, pg_catalog
as $$
  select pg_advisory_xact_lock(hashtextextended('staff_claim:' || lower(trim(p_staff_id)), 0));
$$;
revoke all on function public.lock_staff_id_claim(text) from public, anon, authenticated;
grant execute on function public.lock_staff_id_claim(text) to service_role;

-- ---------------------------------------------------------------------------
-- Sessions
-- ---------------------------------------------------------------------------

create or replace function public.create_staff_session(p_kind text, p_account_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text;
  v_active boolean;
begin
  if p_kind = 'super_admin' then
    select status = 'aktif' into v_active from public.super_admin_accounts where id = p_account_id;
  elsif p_kind = 'area_manager' then
    select status = 'aktif' into v_active from public.area_manager_accounts where id = p_account_id;
  else
    raise exception 'INVALID_KIND';
  end if;
  if v_active is not true then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.staff_sessions (session_kind, account_id, token_hash, expires_at)
  values (p_kind, p_account_id, encode(extensions.digest(v_token, 'sha256'), 'hex'), now() + interval '12 hours');
  return v_token;
end;
$$;
revoke all on function public.create_staff_session(text, uuid) from public, anon, authenticated;
grant execute on function public.create_staff_session(text, uuid) to service_role;

create or replace function public.get_staff_session(p_kind text, p_token text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select account_id from public.staff_sessions
  where session_kind = p_kind
    and token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and expires_at > now();
$$;
revoke all on function public.get_staff_session(text, text) from public, anon, authenticated;
grant execute on function public.get_staff_session(text, text) to service_role;

-- Revokes EVERY session of an account (all devices, including the current
-- one). Used by deactivation, password change, and approvals.
create or replace function public.revoke_staff_sessions(p_kind text, p_account_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  delete from public.staff_sessions
  where session_kind = p_kind and account_id = p_account_id;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;
revoke all on function public.revoke_staff_sessions(text, uuid) from public, anon, authenticated;
grant execute on function public.revoke_staff_sessions(text, uuid) to service_role;

create or replace function public.revoke_manager_sessions(p_manager_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  delete from public.manager_sessions where manager_id = p_manager_id;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;
revoke all on function public.revoke_manager_sessions(uuid) from public, anon, authenticated;
grant execute on function public.revoke_manager_sessions(uuid) to service_role;

create or replace function public.get_manager_id_by_token(p_token text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select manager_id from public.manager_sessions
  where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and expires_at > now();
$$;
revoke all on function public.get_manager_id_by_token(text) from public, anon, authenticated;
grant execute on function public.get_manager_id_by_token(text) to service_role;

-- By-id credential readers for self-service password change (old-password
-- verification happens in Node via scrypt; only service_role can read hashes).
create or replace function public.get_super_admin_credential_by_id(p_account_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('id', id, 'status', status, 'password_hash', password_hash,
    'password_changed_at', password_changed_at)
  from public.super_admin_accounts where id = p_account_id;
$$;
revoke all on function public.get_super_admin_credential_by_id(uuid) from public, anon, authenticated;
grant execute on function public.get_super_admin_credential_by_id(uuid) to service_role;

create or replace function public.get_area_manager_credential_by_id(p_account_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('id', id, 'status', status, 'password_hash', password_hash)
  from public.area_manager_accounts where id = p_account_id;
$$;
revoke all on function public.get_area_manager_credential_by_id(uuid) from public, anon, authenticated;
grant execute on function public.get_area_manager_credential_by_id(uuid) to service_role;

create or replace function public.get_manager_credential_by_id(p_account_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('id', id, 'status', status, 'password_hash', password_hash)
  from public.manager_accounts where id = p_account_id;
$$;
revoke all on function public.get_manager_credential_by_id(uuid) from public, anon, authenticated;
grant execute on function public.get_manager_credential_by_id(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Individual Super Admin: credentials, bootstrap, invites, recovery
-- ---------------------------------------------------------------------------

create or replace function public.get_super_admin_credential(p_staff_id text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', id, 'staff_id', staff_id, 'password_hash', password_hash,
    'status', status, 'full_name', full_name
  )
  from public.super_admin_accounts
  where staff_id = lower(trim(p_staff_id));
$$;
revoke all on function public.get_super_admin_credential(text) from public, anon, authenticated;
grant execute on function public.get_super_admin_credential(text) to service_role;

-- Manager login/reset credential reader, re-emitted with a CANONICAL
-- case-insensitive lookup (review A2): legacy rows keep their original mixed
-- case ('AgusKasir'), and every casing variant of the same ID must resolve to
-- exactly one account. The unique index manager_accounts_lower_id_manager_uq
-- (backfill migration) makes lower(id_manager) a 1:1 key, so this comparison
-- is collision-safe and authoritative.
create or replace function public.get_manager_credential(p_id_manager text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', ma.id,
    'password_hash', ma.password_hash,
    'status', ma.status,
    'full_name', ma.full_name,
    'restaurant_id', ma.restaurant_id,
    'restaurant_display_name', r.display_name,
    'restaurant_code', r.code
  )
  from public.manager_accounts ma
  join public.restaurants r on r.id = ma.restaurant_id
  where lower(ma.id_manager) = lower(trim(p_id_manager));
$$;
revoke all on function public.get_manager_credential(text) from public, anon, authenticated;
grant execute on function public.get_manager_credential(text) to service_role;

create or replace function public.bootstrap_super_admin_state()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'open', (select value->>'open' = 'true' from public.system_settings where key = 'super_admin_bootstrap'),
    'individual_count', (select count(*) from public.super_admin_accounts where status <> 'cancelled'),
    'active_count', (select count(*) from public.super_admin_accounts where status = 'aktif')
  );
$$;
revoke all on function public.bootstrap_super_admin_state() from public, anon, authenticated;
grant execute on function public.bootstrap_super_admin_state() to service_role;

-- One-time: the shared-password holder creates the FIRST individual Super
-- Admin (pending email verification). Refuses if the bootstrap gate is
-- closed or any individual account already exists. Concurrency-safe: the
-- gate is re-read inside the bootstrap advisory lock. Result contract (B8):
-- denials are audited and returned, never raised past the caller.
create or replace function public.bootstrap_create_super_admin(
  p_staff_id text,
  p_full_name text,
  p_email text,
  p_verify_token_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_open boolean;
  v_count integer;
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('super_admin_bootstrap'));
  select value->>'open' = 'true', (select count(*) from public.super_admin_accounts where status <> 'cancelled')
  into v_open, v_count
  from public.system_settings where key = 'super_admin_bootstrap';
  if v_open is not true or v_count > 0 then
    perform public.write_admin_audit('legacy_bootstrap', null, 'bootstrap', 'super_admin.bootstrap_create',
      null, null, null, 'denied', 'bootstrap gate closed', '{}');
    return jsonb_build_object('ok', false, 'error', 'BOOTSTRAP_CLOSED');
  end if;
  if not public.staff_id_is_valid(lower(trim(p_staff_id))) then
    perform public.write_admin_audit('legacy_bootstrap', null, 'bootstrap', 'super_admin.bootstrap_create',
      null, null, null, 'denied', 'invalid staff id', '{}');
    return jsonb_build_object('ok', false, 'error', 'STAFF_ID_INVALID');
  end if;
  perform public.lock_staff_id_claim(p_staff_id);

  begin
    insert into public.super_admin_accounts
      (staff_id, full_name, email, password_hash, status, invitation_token_hash, invitation_expires_at)
    values
      (lower(trim(p_staff_id)), trim(p_full_name), lower(trim(p_email)), null, 'pending_activation',
       p_verify_token_hash, now() + interval '24 hours')
    returning id into v_id;
  exception when unique_violation then
    perform public.write_admin_audit('legacy_bootstrap', null, 'bootstrap', 'super_admin.bootstrap_create',
      null, null, null, 'denied', 'staff id taken', '{}');
    return jsonb_build_object('ok', false, 'error', 'STAFF_ID_TAKEN');
  end;

  perform public.claim_staff_id(p_staff_id, 'super_admin', v_id);
  perform public.write_admin_audit('legacy_bootstrap', null, 'bootstrap', 'super_admin.bootstrap_create',
    'super_admin', v_id, null, 'ok', null,
    jsonb_build_object('staff_id', lower(trim(p_staff_id))));
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;
revoke all on function public.bootstrap_create_super_admin(text, text, text, text) from public, anon, authenticated;
grant execute on function public.bootstrap_create_super_admin(text, text, text, text) to service_role;

create or replace function public.create_super_admin_invite(
  p_staff_id text,
  p_full_name text,
  p_email text,
  p_invitation_token_hash text,
  p_creator_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_creator public.super_admin_accounts%rowtype;
  v_id uuid;
begin
  select * into v_creator from public.super_admin_accounts
  where id = p_creator_id and status = 'aktif';
  if v_creator.id is null then
    perform public.write_admin_audit('super_admin', p_creator_id, null, 'super_admin.invite_create',
      null, null, null, 'denied', 'not authorized', '{}');
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORIZED');
  end if;
  if not public.staff_id_is_valid(lower(trim(p_staff_id))) then
    perform public.write_admin_audit('super_admin', p_creator_id, v_creator.staff_id, 'super_admin.invite_create',
      null, null, null, 'denied', 'invalid staff id', '{}');
    return jsonb_build_object('ok', false, 'error', 'STAFF_ID_INVALID');
  end if;
  perform public.lock_staff_id_claim(p_staff_id);

  begin
    insert into public.super_admin_accounts
      (staff_id, full_name, email, password_hash, status, invitation_token_hash, invitation_expires_at, created_by)
    values
      (lower(trim(p_staff_id)), trim(p_full_name), lower(trim(p_email)), null, 'pending_activation',
       p_invitation_token_hash, now() + interval '24 hours', p_creator_id)
    returning id into v_id;
  exception when unique_violation then
    perform public.write_admin_audit('super_admin', p_creator_id, v_creator.staff_id, 'super_admin.invite_create',
      null, null, null, 'denied', 'staff id taken', '{}');
    return jsonb_build_object('ok', false, 'error', 'STAFF_ID_TAKEN');
  end;

  perform public.claim_staff_id(p_staff_id, 'super_admin', v_id);
  perform public.write_admin_audit('super_admin', p_creator_id, v_creator.staff_id,
    'super_admin.invite_create', 'super_admin', v_id, null, 'ok', null,
    jsonb_build_object('staff_id', lower(trim(p_staff_id))));
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;
revoke all on function public.create_super_admin_invite(text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.create_super_admin_invite(text, text, text, text, uuid) to service_role;

create or replace function public.resend_super_admin_invite(
  p_super_admin_id uuid,
  p_new_token_hash text,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.super_admin_accounts%rowtype;
  v_target public.super_admin_accounts%rowtype;
begin
  select * into v_actor from public.super_admin_accounts where id = p_actor_id and status = 'aktif';
  if v_actor.id is null then
    perform public.write_admin_audit('super_admin', p_actor_id, null, 'super_admin.invite_resend',
      'super_admin', p_super_admin_id, null, 'denied', 'not authorized', '{}');
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORIZED');
  end if;
  select * into v_target from public.super_admin_accounts where id = p_super_admin_id;
  if v_target.id is null or v_target.status <> 'pending_activation' then
    perform public.write_admin_audit('super_admin', p_actor_id, v_actor.staff_id, 'super_admin.invite_resend',
      'super_admin', p_super_admin_id, null, 'denied', 'target not pending', '{}');
    return jsonb_build_object('ok', false, 'error', 'NOT_PENDING');
  end if;
  update public.super_admin_accounts
  set invitation_token_hash = p_new_token_hash,
      invitation_expires_at = now() + interval '24 hours',
      updated_at = now()
  where id = p_super_admin_id;
  perform public.write_admin_audit('super_admin', p_actor_id, v_actor.staff_id,
    'super_admin.invite_resend', 'super_admin', p_super_admin_id, null, 'ok', null, '{}');
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.resend_super_admin_invite(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.resend_super_admin_invite(uuid, text, uuid) to service_role;

create or replace function public.cancel_super_admin_invite(p_super_admin_id uuid, p_actor_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.super_admin_accounts%rowtype;
begin
  select * into v_actor from public.super_admin_accounts where id = p_actor_id and status = 'aktif';
  if v_actor.id is null then
    perform public.write_admin_audit('super_admin', p_actor_id, null, 'super_admin.invite_cancel',
      'super_admin', p_super_admin_id, null, 'denied', 'not authorized', '{}');
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORIZED');
  end if;
  update public.super_admin_accounts
  set status = 'cancelled', invitation_token_hash = null, invitation_expires_at = null, updated_at = now()
  where id = p_super_admin_id and status = 'pending_activation';
  if not found then
    perform public.write_admin_audit('super_admin', p_actor_id, v_actor.staff_id, 'super_admin.invite_cancel',
      'super_admin', p_super_admin_id, null, 'denied', 'target not pending', '{}');
    return jsonb_build_object('ok', false, 'error', 'NOT_PENDING');
  end if;
  perform public.write_admin_audit('super_admin', p_actor_id, v_actor.staff_id,
    'super_admin.invite_cancel', 'super_admin', p_super_admin_id, null, 'ok', null, '{}');
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.cancel_super_admin_invite(uuid, uuid) from public, anon, authenticated;
grant execute on function public.cancel_super_admin_invite(uuid, uuid) to service_role;

-- Accepts an invite / bootstrap verification: verifies the token, activates
-- the account (stamping password_changed_at — the initial password is
-- established here), and — for the first active account — permanently closes
-- the shared-password bootstrap gate. All atomic.
create or replace function public.accept_super_admin_invite(
  p_staff_id text,
  p_token text,
  p_password_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account public.super_admin_accounts%rowtype;
  v_was_first boolean;
begin
  -- Serializes first-activation/cutover with lifecycle mutations so the
  -- was_first determination and the one-way gate flip stay race-free.
  perform pg_advisory_xact_lock(hashtext('super_admin_lifecycle'));
  select * into v_account from public.super_admin_accounts
  where staff_id = lower(trim(p_staff_id))
    and invitation_token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and status = 'pending_activation'
  for update;
  if v_account.id is null then
    perform public.write_admin_audit('system', null, 'system', 'super_admin.activated',
      'super_admin', null, null, 'denied', 'invalid invitation', '{}');
    return jsonb_build_object('ok', false, 'error', 'INVALID_INVITATION');
  end if;
  if v_account.invitation_expires_at is null or v_account.invitation_expires_at <= now() then
    perform public.write_admin_audit('system', null, 'system', 'super_admin.activated',
      'super_admin', v_account.id, null, 'denied', 'invitation expired', '{}');
    return jsonb_build_object('ok', false, 'error', 'INVITATION_EXPIRED');
  end if;

  v_was_first := not exists (select 1 from public.super_admin_accounts where status = 'aktif');

  update public.super_admin_accounts
  set status = 'aktif',
      password_hash = p_password_hash,
      password_changed_at = now(),
      email_verified_at = now(),
      invitation_token_hash = null,
      invitation_expires_at = null,
      updated_at = now()
  where id = v_account.id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'INVALID_INVITATION');
  end if;

  if v_was_first then
    update public.system_settings
    set value = '{"open": false}'::jsonb, updated_at = now()
    where key = 'super_admin_bootstrap' and value->>'open' = 'true';
    perform public.write_admin_audit('system', null, 'system', 'super_admin.bootstrap_cutover',
      'super_admin', v_account.id, null, 'ok', 'bootstrap closed permanently', '{}');
  end if;

  perform public.write_admin_audit('system', null, 'system', 'super_admin.activated',
    'super_admin', v_account.id, null, 'ok', null,
    jsonb_build_object('staff_id', v_account.staff_id));
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.accept_super_admin_invite(text, text, text) from public, anon, authenticated;
grant execute on function public.accept_super_admin_invite(text, text, text) to service_role;

-- Issues a recovery token after the email carrying it was delivered, and
-- atomically INVALIDATES every sibling token of the same account (review B6):
-- only the newest token is ever live.
create or replace function public.create_super_admin_recovery_token(
  p_super_admin_id uuid,
  p_token_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.super_admin_recovery_tokens
  set used_at = now()
  where super_admin_id = p_super_admin_id and used_at is null;
  insert into public.super_admin_recovery_tokens (super_admin_id, token_hash, expires_at)
  values (p_super_admin_id, p_token_hash, now() + interval '30 minutes');
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.create_super_admin_recovery_token(uuid, text) from public, anon, authenticated;
grant execute on function public.create_super_admin_recovery_token(uuid, text) to service_role;

-- Single-use consume. The ACCOUNT row is locked first (review B6) so two
-- concurrent consumes of sibling tokens serialize: exactly the first valid
-- token wins, and every other live token of the account is invalidated in the
-- same transaction. Stamps password_changed_at and revokes all sessions.
create or replace function public.consume_super_admin_recovery_token(
  p_super_admin_id uuid,
  p_token text,
  p_password_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.super_admin_recovery_tokens%rowtype;
begin
  if not exists (
    select 1 from public.super_admin_accounts
    where id = p_super_admin_id and status = 'aktif'
  ) then
    return jsonb_build_object('ok', false, 'error', 'INVALID_TOKEN');
  end if;
  -- Serialize concurrent consumes per account.
  perform pg_advisory_xact_lock(hashtextextended('sa_recovery:' || p_super_admin_id::text, 0));

  select * into v_row from public.super_admin_recovery_tokens
  where super_admin_id = p_super_admin_id
    and token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and used_at is null
    and expires_at > now()
  for update;
  if v_row.id is null then
    perform public.write_admin_audit('system', null, 'system', 'super_admin.recovery_reset',
      'super_admin', p_super_admin_id, null, 'failed', 'invalid recovery token', '{}');
    return jsonb_build_object('ok', false, 'error', 'INVALID_TOKEN');
  end if;

  update public.super_admin_recovery_tokens set used_at = now() where id = v_row.id;
  -- Sibling tokens die with the first successful consume.
  update public.super_admin_recovery_tokens
  set used_at = now()
  where super_admin_id = p_super_admin_id and id <> v_row.id and used_at is null;
  update public.super_admin_accounts
  set password_hash = p_password_hash, password_changed_at = now(), updated_at = now()
  where id = p_super_admin_id and status = 'aktif';
  if not found then
    return jsonb_build_object('ok', false, 'error', 'INVALID_TOKEN');
  end if;

  perform public.revoke_staff_sessions('super_admin', p_super_admin_id);
  perform public.write_admin_audit('system', null, 'system', 'super_admin.recovery_reset',
    'super_admin', p_super_admin_id, null, 'ok', null, '{}');
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.consume_super_admin_recovery_token(uuid, text, text) from public, anon, authenticated;
grant execute on function public.consume_super_admin_recovery_token(uuid, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Individual Super Admin lifecycle + profile
-- ---------------------------------------------------------------------------

create or replace function public.set_super_admin_status(p_actor_id uuid, p_target_id uuid, p_new_status text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.super_admin_accounts%rowtype;
  v_target public.super_admin_accounts%rowtype;
begin
  select * into v_actor from public.super_admin_accounts where id = p_actor_id and status = 'aktif';
  if v_actor.id is null then
    perform public.write_admin_audit('super_admin', p_actor_id, null, 'super_admin.status',
      'super_admin', p_target_id, null, 'denied', 'not authorized', '{}');
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORIZED');
  end if;
  -- Serialize lifecycle mutations: two parallel deactivations can never both
  -- pass the "more than one active" check (min-1-active invariant).
  perform pg_advisory_xact_lock(hashtext('super_admin_lifecycle'));
  select * into v_target from public.super_admin_accounts where id = p_target_id for update;
  if v_target.id is null or v_target.status = 'cancelled' then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;
  if p_new_status not in ('aktif','nonaktif') then
    perform public.write_admin_audit('super_admin', p_actor_id, v_actor.staff_id,
      'super_admin.status', 'super_admin', p_target_id, null, 'denied', 'invalid status', '{}');
    return jsonb_build_object('ok', false, 'error', 'INVALID_STATUS');
  end if;

  if p_new_status = 'nonaktif' then
    if (select count(*) from public.super_admin_accounts where status = 'aktif') <= 1 then
      -- Durable denial audit (B8): committed together with the verdict.
      perform public.write_admin_audit('super_admin', p_actor_id, v_actor.staff_id,
        'super_admin.deactivate', 'super_admin', p_target_id, null, 'denied', 'last active super admin', '{}');
      return jsonb_build_object('ok', false, 'error', 'LAST_ACTIVE_SUPER_ADMIN');
    end if;
  end if;

  update public.super_admin_accounts
  set status = p_new_status, updated_at = now() where id = p_target_id;
  perform public.revoke_staff_sessions('super_admin', p_target_id);
  perform public.write_admin_audit('super_admin', p_actor_id, v_actor.staff_id,
    case p_new_status when 'aktif' then 'super_admin.activate' else 'super_admin.deactivate' end,
    'super_admin', p_target_id, null, 'ok', null, '{}');
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.set_super_admin_status(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.set_super_admin_status(uuid, uuid, text) to service_role;

-- Profile rename. A Super Admin actor may rename ANY staff profile (other
-- Super Admins, Area Managers, Managers — review C13); an Area Manager may
-- rename ONLY their own profile, or a Manager inside their assigned
-- restaurants. IDs are immutable everywhere. Shares the AM lifecycle lock and
-- re-checks scope after acquiring it (A3).
create or replace function public.update_staff_profile(
  p_actor_kind text,
  p_actor_id uuid,
  p_target_kind text,
  p_target_id uuid,
  p_full_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_label text;
  v_ok boolean := false;
  v_restaurant_id uuid;
begin
  if p_full_name is null or length(trim(p_full_name)) not between 1 and 80 then
    return jsonb_build_object('ok', false, 'error', 'INVALID_NAME');
  end if;

  -- Serialize with assignment revocation / AM deactivation (A3) BEFORE any
  -- authority check so the check below is always made under the lock.
  if p_actor_kind = 'area_manager' then
    perform pg_advisory_xact_lock(hashtext('area_manager_lifecycle'));
  end if;

  if p_actor_kind = 'super_admin' and p_target_kind in ('super_admin','area_manager','manager') then
    select staff_id into v_actor_label from public.super_admin_accounts
    where id = p_actor_id and status = 'aktif';
    v_ok := v_actor_label is not null;
  elsif p_actor_kind = 'area_manager' and p_target_kind = 'manager' then
    select am.staff_id into v_actor_label from public.area_manager_accounts am
    where am.id = p_actor_id and am.status = 'aktif';
    select ma.restaurant_id into v_restaurant_id from public.manager_accounts ma where ma.id = p_target_id;
    v_ok := v_actor_label is not null and v_restaurant_id is not null and exists (
      select 1 from public.area_manager_assignments a
      where a.area_manager_id = p_actor_id and a.restaurant_id = v_restaurant_id and a.removed_at is null
    );
  elsif p_actor_kind = 'area_manager' and p_target_kind = 'area_manager' then
    -- An Area Manager may rename ONLY their own profile (ID is immutable).
    select am.staff_id into v_actor_label from public.area_manager_accounts am
    where am.id = p_actor_id and am.status = 'aktif';
    v_ok := v_actor_label is not null and p_target_id = p_actor_id;
  else
    v_ok := false;
  end if;
  if not v_ok then
    perform public.write_admin_audit(p_actor_kind, p_actor_id, v_actor_label,
      'profile.update', p_target_kind, p_target_id, v_restaurant_id, 'denied', 'not authorized', '{}');
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORIZED');
  end if;

  case p_target_kind
    when 'super_admin' then
      update public.super_admin_accounts set full_name = trim(p_full_name), updated_at = now() where id = p_target_id;
    when 'area_manager' then
      update public.area_manager_accounts set full_name = trim(p_full_name), updated_at = now() where id = p_target_id;
    when 'manager' then
      update public.manager_accounts set full_name = trim(p_full_name), updated_at = now() where id = p_target_id;
    else return jsonb_build_object('ok', false, 'error', 'INVALID_TARGET');
  end case;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;

  perform public.write_admin_audit(p_actor_kind, p_actor_id, v_actor_label,
    'profile.update', p_target_kind, p_target_id, v_restaurant_id, 'ok', null,
    jsonb_build_object('full_name', trim(p_full_name)));
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.update_staff_profile(text, uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.update_staff_profile(text, uuid, text, uuid, text) to service_role;

-- Password self-service: the OLD password is verified in Node (scrypt) before
-- this RPC is called; this RPC re-checks account liveness, swaps the hash,
-- stamps password_changed_at (present for ALL kinds — A1) and revokes every
-- session.
create or replace function public.set_staff_password(
  p_kind text,
  p_account_id uuid,
  p_password_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  case p_kind
    when 'super_admin' then
      update public.super_admin_accounts
      set password_hash = p_password_hash, password_changed_at = now(), updated_at = now()
      where id = p_account_id and status = 'aktif';
    when 'area_manager' then
      update public.area_manager_accounts
      set password_hash = p_password_hash, password_changed_at = now(), updated_at = now()
      where id = p_account_id and status = 'aktif';
    when 'manager' then
      update public.manager_accounts
      set password_hash = p_password_hash, password_changed_at = now(), updated_at = now()
      where id = p_account_id and status = 'aktif';
    else
      return jsonb_build_object('ok', false, 'error', 'INVALID_KIND');
  end case;
  if not found then
    perform public.write_admin_audit(p_kind, p_account_id, null, 'password.change',
      p_kind, p_account_id, null, 'denied', 'account inactive or missing', '{}');
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORIZED');
  end if;
  if p_kind = 'manager' then
    perform public.revoke_manager_sessions(p_account_id);
  else
    perform public.revoke_staff_sessions(p_kind, p_account_id);
  end if;
  perform public.write_admin_audit(p_kind, p_account_id, null, 'password.change',
    p_kind, p_account_id, null, 'ok', null, '{}');
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.set_staff_password(text, uuid, text) from public, anon, authenticated;
grant execute on function public.set_staff_password(text, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- Area Manager: assignments
-- ---------------------------------------------------------------------------

create or replace function public.assign_area_manager(p_actor_id uuid, p_am_id uuid, p_restaurant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.super_admin_accounts%rowtype;
  v_am public.area_manager_accounts%rowtype;
begin
  select * into v_actor from public.super_admin_accounts where id = p_actor_id and status = 'aktif';
  if v_actor.id is null then
    perform public.write_admin_audit('super_admin', p_actor_id, null, 'assignment.add',
      'area_manager', p_am_id, p_restaurant_id, 'denied', 'not authorized', '{}');
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORIZED');
  end if;
  -- Assignments participate in the same serialization domain (A3).
  perform pg_advisory_xact_lock(hashtext('area_manager_lifecycle'));
  select * into v_am from public.area_manager_accounts where id = p_am_id;
  if v_am.id is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;
  if not exists (select 1 from public.restaurants where id = p_restaurant_id) then
    return jsonb_build_object('ok', false, 'error', 'RESTAURANT_NOT_FOUND');
  end if;

  insert into public.area_manager_assignments (area_manager_id, restaurant_id, assigned_by)
  values (p_am_id, p_restaurant_id, p_actor_id)
  on conflict (area_manager_id, restaurant_id) where removed_at is null do nothing;

  perform public.write_admin_audit('super_admin', p_actor_id, v_actor.staff_id,
    'assignment.add', 'area_manager', p_am_id, p_restaurant_id, 'ok', null, '{}');
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.assign_area_manager(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.assign_area_manager(uuid, uuid, uuid) to service_role;

-- Revoking an assignment is refused if it would leave the restaurant without
-- any active AM (last-active guard). The denial audit is durable (B8).
create or replace function public.revoke_area_manager_assignment(
  p_actor_id uuid,
  p_am_id uuid,
  p_restaurant_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.super_admin_accounts%rowtype;
  v_active_am_count integer;
begin
  select * into v_actor from public.super_admin_accounts where id = p_actor_id and status = 'aktif';
  if v_actor.id is null then
    perform public.write_admin_audit('super_admin', p_actor_id, null, 'assignment.remove',
      'area_manager', p_am_id, p_restaurant_id, 'denied', 'not authorized', '{}');
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORIZED');
  end if;
  -- Shared serialization key with every AM-scoped action and
  -- set_area_manager_status (min-1-active-AM invariant across all of them).
  perform pg_advisory_xact_lock(hashtext('area_manager_lifecycle'));

  select count(distinct a.area_manager_id) into v_active_am_count
  from public.area_manager_assignments a
  join public.area_manager_accounts am on am.id = a.area_manager_id and am.status = 'aktif'
  where a.restaurant_id = p_restaurant_id and a.removed_at is null;

  if v_active_am_count <= 1 and exists (
    select 1 from public.area_manager_assignments a
    where a.area_manager_id = p_am_id and a.restaurant_id = p_restaurant_id and a.removed_at is null
  ) then
    perform public.write_admin_audit('super_admin', p_actor_id, v_actor.staff_id,
      'assignment.remove', 'area_manager', p_am_id, p_restaurant_id, 'denied', 'last active area manager', '{}');
    return jsonb_build_object('ok', false, 'error', 'LAST_ACTIVE_AREA_MANAGER');
  end if;

  update public.area_manager_assignments
  set removed_at = now(), removed_by = p_actor_id
  where area_manager_id = p_am_id and restaurant_id = p_restaurant_id and removed_at is null;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;

  perform public.write_admin_audit('super_admin', p_actor_id, v_actor.staff_id,
    'assignment.remove', 'area_manager', p_am_id, p_restaurant_id, 'ok', null, '{}');
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.revoke_area_manager_assignment(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.revoke_area_manager_assignment(uuid, uuid, uuid) to service_role;

-- Readiness gate: restaurants that currently have NO active AM (legacy gap).
-- Surfaces them for manual assignment; no fake accounts are ever created.
create or replace function public.list_restaurants_without_active_am()
returns table (restaurant_id uuid, display_name text)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.display_name
  from public.restaurants r
  where r.is_active
    and not exists (
      select 1 from public.area_manager_assignments a
      join public.area_manager_accounts am on am.id = a.area_manager_id and am.status = 'aktif'
      where a.restaurant_id = r.id and a.removed_at is null
    )
  order by r.display_name;
$$;
revoke all on function public.list_restaurants_without_active_am() from public, anon, authenticated;
grant execute on function public.list_restaurants_without_active_am() to service_role;

-- Readiness gate (review B10): an authoritative, queryable verdict that the
-- AM rollout is NOT ready while any active restaurant lacks at least one
-- active Area Manager. Super Admin keeps the ability to bootstrap and add
-- assignments; this gate only states deployment readiness. No fake accounts.
create or replace function public.get_am_rollout_readiness()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'restaurants_total', (select count(*) from public.restaurants where is_active),
    'restaurants_covered', (
      select count(*) from public.restaurants r
      where r.is_active and exists (
        select 1 from public.area_manager_assignments a
        join public.area_manager_accounts am on am.id = a.area_manager_id and am.status = 'aktif'
        where a.restaurant_id = r.id and a.removed_at is null
      )
    ),
    'uncovered', (
      select coalesce(jsonb_agg(jsonb_build_object('restaurant_id', r.id, 'display_name', r.display_name)
                 order by r.display_name), '[]'::jsonb)
      from public.restaurants r
      where r.is_active and not exists (
        select 1 from public.area_manager_assignments a
        join public.area_manager_accounts am on am.id = a.area_manager_id and am.status = 'aktif'
        where a.restaurant_id = r.id and a.removed_at is null
      )
    )
  );
$$;
revoke all on function public.get_am_rollout_readiness() from public, anon, authenticated;
grant execute on function public.get_am_rollout_readiness() to service_role;

-- ---------------------------------------------------------------------------
-- Area Manager: lifecycle
-- ---------------------------------------------------------------------------

create or replace function public.get_area_manager_credential(p_staff_id text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', id, 'staff_id', staff_id, 'password_hash', password_hash,
    'status', status, 'full_name', full_name, 'password_changed_at', password_changed_at
  )
  from public.area_manager_accounts
  where staff_id = lower(trim(p_staff_id));
$$;
revoke all on function public.get_area_manager_credential(text) from public, anon, authenticated;
grant execute on function public.get_area_manager_credential(text) to service_role;

create or replace function public.create_area_manager(
  p_actor_id uuid,
  p_staff_id text,
  p_full_name text,
  p_password_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.super_admin_accounts%rowtype;
  v_id uuid;
begin
  select * into v_actor from public.super_admin_accounts where id = p_actor_id and status = 'aktif';
  if v_actor.id is null then
    perform public.write_admin_audit('super_admin', p_actor_id, null, 'area_manager.create',
      null, null, null, 'denied', 'not authorized', '{}');
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORIZED');
  end if;
  if not public.staff_id_is_valid(lower(trim(p_staff_id))) then
    perform public.write_admin_audit('super_admin', p_actor_id, v_actor.staff_id, 'area_manager.create',
      null, null, null, 'denied', 'invalid staff id', '{}');
    return jsonb_build_object('ok', false, 'error', 'STAFF_ID_INVALID');
  end if;
  perform public.lock_staff_id_claim(p_staff_id);

  begin
    insert into public.area_manager_accounts (staff_id, full_name, password_hash, created_by)
    values (lower(trim(p_staff_id)), trim(p_full_name), p_password_hash, p_actor_id)
    returning id into v_id;
  exception when unique_violation then
    perform public.write_admin_audit('super_admin', p_actor_id, v_actor.staff_id, 'area_manager.create',
      null, null, null, 'denied', 'staff id taken', '{}');
    return jsonb_build_object('ok', false, 'error', 'STAFF_ID_TAKEN');
  end;

  perform public.claim_staff_id(p_staff_id, 'area_manager', v_id);
  perform public.write_admin_audit('super_admin', p_actor_id, v_actor.staff_id,
    'area_manager.create', 'area_manager', v_id, null, 'ok', null,
    jsonb_build_object('staff_id', lower(trim(p_staff_id))));
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;
revoke all on function public.create_area_manager(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.create_area_manager(uuid, text, text, text) to service_role;

-- Deactivating an AM is refused if any of their restaurants would lose its
-- only active AM. The guard is evaluated under the shared lifecycle lock, and
-- every AM-scoped action re-checks authority under the same lock (A3).
create or replace function public.set_area_manager_status(p_actor_id uuid, p_target_id uuid, p_new_status text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor public.super_admin_accounts%rowtype;
  v_target public.area_manager_accounts%rowtype;
  v_guarded_restaurant uuid;
begin
  select * into v_actor from public.super_admin_accounts where id = p_actor_id and status = 'aktif';
  if v_actor.id is null then
    perform public.write_admin_audit('super_admin', p_actor_id, null, 'area_manager.status',
      'area_manager', p_target_id, null, 'denied', 'not authorized', '{}');
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORIZED');
  end if;
  perform pg_advisory_xact_lock(hashtext('area_manager_lifecycle'));
  -- Reject a missing target before any audit write or session revocation.
  select * into v_target from public.area_manager_accounts where id = p_target_id for update;
  if v_target.id is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;
  if p_new_status not in ('aktif','nonaktif') then
    perform public.write_admin_audit('super_admin', p_actor_id, v_actor.staff_id,
      'area_manager.status', 'area_manager', p_target_id, null, 'denied', 'invalid status', '{}');
    return jsonb_build_object('ok', false, 'error', 'INVALID_STATUS');
  end if;

  if p_new_status = 'nonaktif' then
    select a.restaurant_id into v_guarded_restaurant
    from public.area_manager_assignments a
    where a.area_manager_id = p_target_id and a.removed_at is null
      and (
        select count(distinct a2.area_manager_id)
        from public.area_manager_assignments a2
        join public.area_manager_accounts am2 on am2.id = a2.area_manager_id and am2.status = 'aktif'
        where a2.restaurant_id = a.restaurant_id and a2.removed_at is null
      ) <= 1
    limit 1;
    if v_guarded_restaurant is not null then
      perform public.write_admin_audit('super_admin', p_actor_id, v_actor.staff_id,
        'area_manager.deactivate', 'area_manager', p_target_id, v_guarded_restaurant, 'denied',
        'last active area manager of a restaurant', '{}');
      return jsonb_build_object('ok', false, 'error', 'LAST_ACTIVE_AREA_MANAGER');
    end if;
  end if;

  update public.area_manager_accounts
  set status = p_new_status, updated_at = now() where id = p_target_id;
  perform public.revoke_staff_sessions('area_manager', p_target_id);
  perform public.write_admin_audit('super_admin', p_actor_id, v_actor.staff_id,
    case p_new_status when 'aktif' then 'area_manager.activate' else 'area_manager.deactivate' end,
    'area_manager', p_target_id, null, 'ok', null, '{}');
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.set_area_manager_status(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.set_area_manager_status(uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- Manager administration (Super Admin global, AM scoped to assignments)
-- ---------------------------------------------------------------------------

-- Authority predicate. Callable ONLY by service_role (review B5 — no default
-- PUBLIC execute on any Poin 2 function).
create or replace function public.actor_can_manage_restaurant(p_kind text, p_actor_id uuid, p_restaurant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_kind = 'super_admin' then exists (
      select 1 from public.super_admin_accounts where id = p_actor_id and status = 'aktif')
    when p_kind = 'area_manager' then exists (
      select 1
      from public.area_manager_accounts am
      join public.area_manager_assignments a
        on a.area_manager_id = am.id and a.removed_at is null
      where am.id = p_actor_id and am.status = 'aktif' and a.restaurant_id = p_restaurant_id)
    else false
  end;
$$;
revoke all on function public.actor_can_manage_restaurant(text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.actor_can_manage_restaurant(text, uuid, uuid) to service_role;

-- Creates a Manager. The AM actor path shares the 'area_manager_lifecycle'
-- advisory lock and RE-CHECKS scope after acquiring it (review A3): a
-- revocation that commits first makes this fail. Result contract (B8).
create or replace function public.create_manager_account(
  p_actor_kind text,
  p_actor_id uuid,
  p_staff_id text,
  p_full_name text,
  p_restaurant_id uuid,
  p_password_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_label text;
  v_restaurant public.restaurants%rowtype;
  v_id uuid;
  v_staff_id text := lower(trim(p_staff_id));
begin
  -- Serialize with revoke/deactivate BEFORE the authority check (A3).
  if p_actor_kind = 'area_manager' then
    perform pg_advisory_xact_lock(hashtext('area_manager_lifecycle'));
  end if;

  select * into v_restaurant from public.restaurants where id = p_restaurant_id and is_active;
  if v_restaurant.id is null then
    return jsonb_build_object('ok', false, 'error', 'RESTAURANT_NOT_FOUND');
  end if;
  if not public.actor_can_manage_restaurant(p_actor_kind, p_actor_id, p_restaurant_id) then
    perform public.write_admin_audit(p_actor_kind, p_actor_id, null, 'manager.create',
      'manager', null, p_restaurant_id, 'denied', 'not authorized', '{}');
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORIZED');
  end if;
  if not public.staff_id_is_valid(v_staff_id) then
    select staff_id into v_actor_label from public.super_admin_accounts where id = p_actor_id;
    if v_actor_label is null then
      select staff_id into v_actor_label from public.area_manager_accounts where id = p_actor_id;
    end if;
    perform public.write_admin_audit(p_actor_kind, p_actor_id, v_actor_label, 'manager.create',
      'manager', null, p_restaurant_id, 'denied', 'invalid staff id',
      jsonb_build_object('staff_id', v_staff_id));
    return jsonb_build_object('ok', false, 'error', 'STAFF_ID_INVALID');
  end if;

  if p_actor_kind = 'super_admin' then
    select staff_id into v_actor_label from public.super_admin_accounts where id = p_actor_id;
  elsif p_actor_kind = 'area_manager' then
    select staff_id into v_actor_label from public.area_manager_accounts where id = p_actor_id;
  end if;

  -- Atomic claim: serialize per-ID, verify availability (registry + legacy
  -- namespace, both CASE-INSENSITIVELY per review A2) BEFORE the insert, then
  -- insert account and registry row in the same transaction.
  perform public.lock_staff_id_claim(v_staff_id);
  if exists (select 1 from public.staff_id_registry where staff_id = v_staff_id)
     or exists (select 1 from public.manager_accounts where lower(id_manager) = v_staff_id) then
    perform public.write_admin_audit(p_actor_kind, p_actor_id, v_actor_label, 'manager.create',
      'manager', null, p_restaurant_id, 'denied', 'staff id taken',
      jsonb_build_object('staff_id', v_staff_id));
    return jsonb_build_object('ok', false, 'error', 'STAFF_ID_TAKEN');
  end if;

  begin
    insert into public.manager_accounts (id_manager, full_name, restaurant_id, password_hash, status)
    values (v_staff_id, trim(p_full_name), p_restaurant_id, p_password_hash, 'aktif')
    returning id into v_id;
  exception when unique_violation then
    perform public.write_admin_audit(p_actor_kind, p_actor_id, v_actor_label, 'manager.create',
      'manager', null, p_restaurant_id, 'denied', 'staff id taken',
      jsonb_build_object('staff_id', v_staff_id));
    return jsonb_build_object('ok', false, 'error', 'STAFF_ID_TAKEN');
  end;

  insert into public.staff_id_registry (staff_id, account_kind, account_id)
  values (v_staff_id, 'manager', v_id);

  perform public.write_admin_audit(p_actor_kind, p_actor_id, v_actor_label, 'manager.create',
    'manager', v_id, p_restaurant_id, 'ok', null,
    jsonb_build_object('staff_id', v_staff_id));
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;
revoke all on function public.create_manager_account(text, uuid, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.create_manager_account(text, uuid, text, text, uuid, text) to service_role;

-- Manager activate/deactivate. The AM actor path shares the lifecycle lock
-- and re-checks scope after acquiring it (A3).
create or replace function public.set_manager_status(
  p_actor_kind text,
  p_actor_id uuid,
  p_manager_id uuid,
  p_new_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_label text;
  v_restaurant_id uuid;
begin
  -- Serialize with revoke/deactivate BEFORE the authority check (A3).
  if p_actor_kind = 'area_manager' then
    perform pg_advisory_xact_lock(hashtext('area_manager_lifecycle'));
  end if;

  select restaurant_id into v_restaurant_id from public.manager_accounts where id = p_manager_id;
  if v_restaurant_id is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;
  if not public.actor_can_manage_restaurant(p_actor_kind, p_actor_id, v_restaurant_id) then
    perform public.write_admin_audit(p_actor_kind, p_actor_id, null, 'manager.status',
      'manager', p_manager_id, v_restaurant_id, 'denied', 'not authorized', '{}');
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORIZED');
  end if;
  if p_new_status not in ('aktif','nonaktif') then
    select staff_id into v_actor_label from public.super_admin_accounts where id = p_actor_id;
    if v_actor_label is null then
      select staff_id into v_actor_label from public.area_manager_accounts where id = p_actor_id;
    end if;
    perform public.write_admin_audit(p_actor_kind, p_actor_id, v_actor_label, 'manager.status',
      'manager', p_manager_id, v_restaurant_id, 'denied', 'invalid status', '{}');
    return jsonb_build_object('ok', false, 'error', 'INVALID_STATUS');
  end if;

  if p_actor_kind = 'super_admin' then
    select staff_id into v_actor_label from public.super_admin_accounts where id = p_actor_id;
  elsif p_actor_kind = 'area_manager' then
    select staff_id into v_actor_label from public.area_manager_accounts where id = p_actor_id;
  end if;

  update public.manager_accounts
  set status = p_new_status, updated_at = now() where id = p_manager_id;
  perform public.revoke_manager_sessions(p_manager_id);
  perform public.write_admin_audit(p_actor_kind, p_actor_id, v_actor_label,
    case p_new_status when 'aktif' then 'manager.activate' else 'manager.deactivate' end,
    'manager', p_manager_id, v_restaurant_id, 'ok', null, '{}');
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.set_manager_status(text, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.set_manager_status(text, uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- Password reset flows
-- ---------------------------------------------------------------------------

-- Manager reset submission. Canonical case-insensitive lookup (review A2):
-- legacy mixed-case IDs ('AgusKasir') resolve like any casing variant.
create or replace function public.submit_manager_reset_request(
  p_staff_id text,
  p_candidate_hash text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_manager public.manager_accounts%rowtype;
begin
  select * into v_manager from public.manager_accounts
  where lower(id_manager) = lower(trim(p_staff_id)) and status = 'aktif';
  if v_manager.id is null then
    -- Generic caller-level response; a distinct internal reason keeps
    -- enumeration impossible while still auditing the attempt.
    perform public.write_admin_audit('system', null, 'system', 'manager_reset.submit',
      'manager', null, null, 'failed', 'unknown or inactive account', '{}');
    return false;
  end if;

  begin
    insert into public.manager_reset_requests (manager_id, candidate_hash)
    values (v_manager.id, p_candidate_hash);
  exception when unique_violation then
    perform public.write_admin_audit('system', null, 'system', 'manager_reset.submit',
      'manager', v_manager.id, v_manager.restaurant_id, 'failed', 'already pending', '{}');
    return false;
  end;

  perform public.write_admin_audit('system', null, 'system', 'manager_reset.submit',
    'manager', v_manager.id, v_manager.restaurant_id, 'ok', null, '{}');
  return true;
end;
$$;
revoke all on function public.submit_manager_reset_request(text, text) from public, anon, authenticated;
grant execute on function public.submit_manager_reset_request(text, text) to service_role;

create or replace function public.submit_am_reset_request(p_staff_id text, p_candidate_hash text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_am public.area_manager_accounts%rowtype;
begin
  select * into v_am from public.area_manager_accounts
  where staff_id = lower(trim(p_staff_id)) and status = 'aktif';
  if v_am.id is null then
    perform public.write_admin_audit('system', null, 'system', 'am_reset.submit',
      'area_manager', null, null, 'failed', 'unknown or inactive account', '{}');
    return false;
  end if;

  begin
    insert into public.am_reset_requests (area_manager_id, candidate_hash)
    values (v_am.id, p_candidate_hash);
  exception when unique_violation then
    perform public.write_admin_audit('system', null, 'system', 'am_reset.submit',
      'area_manager', v_am.id, null, 'failed', 'already pending', '{}');
    return false;
  end;

  perform public.write_admin_audit('system', null, 'system', 'am_reset.submit',
    'area_manager', v_am.id, null, 'ok', null, '{}');
  return true;
end;
$$;
revoke all on function public.submit_am_reset_request(text, text) from public, anon, authenticated;
grant execute on function public.submit_am_reset_request(text, text) to service_role;

-- Manager reset approval: ONLY an active AM currently assigned to the
-- manager's restaurant may decide, and only for a 'pending' request — the
-- atomic status flip makes the first decision final. The decision shares the
-- 'area_manager_lifecycle' lock and re-checks scope after acquiring it (A3):
-- a revocation/deactivation that commits first makes the decision fail.
create or replace function public.decide_manager_reset(
  p_decider_kind text,
  p_decider_id uuid,
  p_request_id uuid,
  p_decision text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.manager_reset_requests%rowtype;
  v_manager public.manager_accounts%rowtype;
  v_actor_label text;
begin
  if p_decision not in ('approved','rejected') then
    perform public.write_admin_audit(p_decider_kind, p_decider_id, null, 'manager_reset.decide',
      'manager_reset', p_request_id, null, 'denied', 'invalid decision', '{}');
    return jsonb_build_object('ok', false, 'error', 'INVALID_DECISION');
  end if;
  if p_decider_kind <> 'area_manager' then
    perform public.write_admin_audit(p_decider_kind, p_decider_id, null, 'manager_reset.decide',
      'manager_reset', p_request_id, null, 'denied', 'not authorized', '{}');
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORIZED');
  end if;

  -- Serialize with revoke/deactivate BEFORE the authority check (A3).
  perform pg_advisory_xact_lock(hashtext('area_manager_lifecycle'));

  select * into v_request from public.manager_reset_requests where id = p_request_id for update;
  if v_request.id is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;

  select * into v_manager from public.manager_accounts where id = v_request.manager_id;
  if not public.actor_can_manage_restaurant('area_manager', p_decider_id, v_manager.restaurant_id) then
    perform public.write_admin_audit('area_manager', p_decider_id, null, 'manager_reset.decide',
      'manager_reset', p_request_id, v_manager.restaurant_id, 'denied', 'out of scope', '{}');
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORIZED');
  end if;
  select staff_id into v_actor_label from public.area_manager_accounts where id = p_decider_id;

  update public.manager_reset_requests
  set status = p_decision, decided_at = now(), decided_by = p_decider_id, decided_by_kind = 'area_manager'
  where id = p_request_id and status = 'pending';
  if not found then
    perform public.write_admin_audit('area_manager', p_decider_id, v_actor_label, 'manager_reset.decide',
      'manager_reset', p_request_id, v_manager.restaurant_id, 'failed', 'already decided', '{}');
    return jsonb_build_object('ok', false, 'error', 'ALREADY_DECIDED');
  end if;

  if p_decision = 'approved' then
    update public.manager_accounts
    set password_hash = v_request.candidate_hash, password_changed_at = now(), updated_at = now()
    where id = v_manager.id;
    perform public.revoke_manager_sessions(v_manager.id);
  end if;

  perform public.write_admin_audit('area_manager', p_decider_id, v_actor_label, 'manager_reset.decide',
    'manager_reset', p_request_id, v_manager.restaurant_id, 'ok', p_decision, '{}');
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.decide_manager_reset(text, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.decide_manager_reset(text, uuid, uuid, text) to service_role;

-- AM reset approval: ONLY an active Super Admin may decide; same atomic
-- first-decision-wins semantics with a durable already-decided audit (B8).
create or replace function public.decide_am_reset(p_decider_id uuid, p_request_id uuid, p_decision text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.am_reset_requests%rowtype;
  v_actor_label text;
begin
  if p_decision not in ('approved','rejected') then
    perform public.write_admin_audit('super_admin', p_decider_id, null, 'am_reset.decide',
      'am_reset', p_request_id, null, 'denied', 'invalid decision', '{}');
    return jsonb_build_object('ok', false, 'error', 'INVALID_DECISION');
  end if;
  select staff_id into v_actor_label from public.super_admin_accounts
  where id = p_decider_id and status = 'aktif';
  if v_actor_label is null then
    perform public.write_admin_audit('super_admin', p_decider_id, null, 'am_reset.decide',
      'am_reset', p_request_id, null, 'denied', 'not authorized', '{}');
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORIZED');
  end if;

  select * into v_request from public.am_reset_requests where id = p_request_id for update;
  if v_request.id is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;

  update public.am_reset_requests
  set status = p_decision, decided_at = now(), decided_by = p_decider_id
  where id = p_request_id and status = 'pending';
  if not found then
    perform public.write_admin_audit('super_admin', p_decider_id, v_actor_label, 'am_reset.decide',
      'am_reset', p_request_id, null, 'failed', 'already decided', '{}');
    return jsonb_build_object('ok', false, 'error', 'ALREADY_DECIDED');
  end if;

  if p_decision = 'approved' then
    update public.area_manager_accounts
    set password_hash = v_request.candidate_hash, password_changed_at = now(), updated_at = now()
    where id = v_request.area_manager_id;
    perform public.revoke_staff_sessions('area_manager', v_request.area_manager_id);
  end if;

  perform public.write_admin_audit('super_admin', p_decider_id, v_actor_label, 'am_reset.decide',
    'am_reset', p_request_id, null, 'ok', p_decision, '{}');
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.decide_am_reset(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.decide_am_reset(uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- Read models (scope-authoritative)
-- ---------------------------------------------------------------------------

create or replace function public.list_am_scope_restaurants(p_am_id uuid)
returns table (restaurant_id uuid, display_name text, restaurant_code text)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.display_name, r.code
  from public.area_manager_assignments a
  join public.restaurants r on r.id = a.restaurant_id
  join public.area_manager_accounts am on am.id = a.area_manager_id and am.status = 'aktif'
  where a.area_manager_id = p_am_id and a.removed_at is null
  order by r.display_name;
$$;
revoke all on function public.list_am_scope_restaurants(uuid) from public, anon, authenticated;
grant execute on function public.list_am_scope_restaurants(uuid) to service_role;

create or replace function public.list_managers_for_scope(p_am_id uuid)
returns table (
  manager_id uuid, staff_id text, full_name text, status text,
  restaurant_id uuid, restaurant_name text, created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select ma.id, ma.id_manager, ma.full_name, ma.status, ma.restaurant_id, r.display_name, ma.created_at
  from public.manager_accounts ma
  join public.restaurants r on r.id = ma.restaurant_id
  where ma.restaurant_id in (
    select a.restaurant_id
    from public.area_manager_assignments a
    join public.area_manager_accounts am on am.id = a.area_manager_id and am.status = 'aktif'
    where a.area_manager_id = p_am_id and a.removed_at is null
  )
  order by r.display_name, ma.full_name;
$$;
revoke all on function public.list_managers_for_scope(uuid) from public, anon, authenticated;
grant execute on function public.list_managers_for_scope(uuid) to service_role;

create or replace function public.list_pending_manager_resets(p_am_id uuid)
returns table (
  request_id uuid, manager_id uuid, staff_id text, full_name text,
  restaurant_id uuid, restaurant_name text, requested_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select rq.id, rq.manager_id, ma.id_manager, ma.full_name, ma.restaurant_id, r.display_name, rq.requested_at
  from public.manager_reset_requests rq
  join public.manager_accounts ma on ma.id = rq.manager_id
  join public.restaurants r on r.id = ma.restaurant_id
  where rq.status = 'pending'
    and ma.restaurant_id in (
      select a.restaurant_id
      from public.area_manager_assignments a
      join public.area_manager_accounts am on am.id = a.area_manager_id and am.status = 'aktif'
      where a.area_manager_id = p_am_id and a.removed_at is null
    )
  order by rq.requested_at;
$$;
revoke all on function public.list_pending_manager_resets(uuid) from public, anon, authenticated;
grant execute on function public.list_pending_manager_resets(uuid) to service_role;

create or replace function public.list_pending_am_resets()
returns table (
  request_id uuid, area_manager_id uuid, staff_id text, full_name text, requested_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select rq.id, rq.area_manager_id, am.staff_id, am.full_name, rq.requested_at
  from public.am_reset_requests rq
  join public.area_manager_accounts am on am.id = rq.area_manager_id
  where rq.status = 'pending'
  order by rq.requested_at;
$$;
revoke all on function public.list_pending_am_resets() from public, anon, authenticated;
grant execute on function public.list_pending_am_resets() to service_role;

create or replace function public.get_manager_reset_requester_scope(p_request_id uuid, p_am_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.manager_reset_requests rq
    join public.manager_accounts ma on ma.id = rq.manager_id
    where rq.id = p_request_id
      and exists (
        select 1 from public.area_manager_assignments a
        join public.area_manager_accounts am on am.id = a.area_manager_id and am.status = 'aktif'
        where a.area_manager_id = p_am_id and a.restaurant_id = ma.restaurant_id and a.removed_at is null
      )
  );
$$;
revoke all on function public.get_manager_reset_requester_scope(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_manager_reset_requester_scope(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Audit read models (Super Admin: everything; AM: manager admin within scope)
-- ---------------------------------------------------------------------------

create or replace function public.list_admin_audit_for_actor(p_kind text, p_actor_id uuid)
returns table (
  id uuid, actor_kind text, actor_label text, action text, target_kind text,
  target_id uuid, restaurant_id uuid, result text, reason text, created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select l.id, l.actor_kind, l.actor_label, l.action, l.target_kind,
         l.target_id, l.restaurant_id, l.result, l.reason, l.created_at
  from public.admin_audit_log l
  where (p_kind = 'super_admin' and exists (
            select 1 from public.super_admin_accounts sa
            where sa.id = p_actor_id and sa.status = 'aktif'))
     or (p_kind = 'area_manager'
         and l.restaurant_id in (
           select a.restaurant_id
           from public.area_manager_assignments a
           join public.area_manager_accounts am on am.id = a.area_manager_id and am.status = 'aktif'
           where a.area_manager_id = p_actor_id and a.removed_at is null)
         and (
           l.actor_kind = 'area_manager'
           -- Manager-admin lifecycle events recorded by the system/Super Admin
           -- (e.g. reset submissions) are visible in scope. The projection
           -- below excludes metadata, so candidate hashes never leak.
           or l.action in (
             'manager.create', 'manager.activate', 'manager.deactivate', 'manager.status',
             'manager_reset.submit', 'manager_reset.decide', 'profile.update'
           )
         ))
  order by l.created_at desc
  limit 500;
$$;
revoke all on function public.list_admin_audit_for_actor(text, uuid) from public, anon, authenticated;
grant execute on function public.list_admin_audit_for_actor(text, uuid) to service_role;
