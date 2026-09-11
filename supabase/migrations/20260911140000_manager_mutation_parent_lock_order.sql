-- R12-A (blocker P0-1): universal parent-first lock order for every manager
-- mutation RPC that revokes manager sessions.
--
-- Forward replacement only; already applied migrations are never edited.
--
-- THE BUG THIS CLOSES
-- R11 made the manager-handoff revokers parent-first: revoke_manager_sessions
-- now locks the restaurant FK parent row before the manager account row.  But
-- the three manager mutation RPCs still locked their child first:
--
--   set_staff_password('manager', ...)  UPDATE manager_accounts, then revoke
--   set_manager_status(...)             UPDATE manager_accounts, then revoke
--   decide_manager_reset(...)           UPDATE manager_reset_requests +
--                                       manager_accounts, then revoke
--
-- so the mutation held the manager row and only afterwards asked for the
-- restaurant row, while a concurrent `delete from public.restaurants` held the
-- restaurant row and asked for the manager row through its FK cascade.  That
-- is a genuine lock cycle and PostgreSQL resolves it by killing one side with
-- SQLSTATE 40P01 (deadlock detected) — an operator-visible failure on a
-- security-critical revocation path.
--
-- THE RULE APPLIED HERE
-- Every one of these RPCs now: discovers ids WITHOUT locks (a discovery read
-- decides nothing), locks the restaurant FK parent row (FOR KEY SHARE), locks
-- the manager account row (FOR UPDATE), takes the manager advisory lock (seed
-- 916), locks any manager child row it mutates, RE-READS authorization and
-- state under those locks, mutates, and only then revokes.  Because the
-- restaurant parent is held before the manager child, the mutation and the
-- cascading restaurant DELETE now request locks in the same direction and
-- simply queue instead of deadlocking.
--
-- The 'area_manager_lifecycle' advisory lock keeps its existing position
-- BEFORE the row locks (it serialises AM authority changes against these
-- decisions, review A3) so the total order is: AM lifecycle advisory ->
-- restaurant row -> manager row -> manager advisory -> manager child row.
--
-- Raw credentials are never persisted or logged here; the password/candidate
-- hashes are computed by the caller and only hashes are stored.

-- ---------------------------------------------------------------------------
-- SEPARATE DEFECT found while building the P0-1 race coverage (not a lock
-- ordering issue).
--
-- set_staff_password passes its p_kind straight through to write_admin_audit
-- as the AUDIT ACTOR kind, but admin_audit_log.actor_kind only permitted
-- ('super_admin','area_manager','system','legacy_bootstrap').  So every
-- set_staff_password('manager', ...) call aborted on the audit insert with
-- SQLSTATE 23514.  The production path
-- changeManagerPassword -> changeStaffPasswordCore('manager') -> this RPC
-- therefore ALWAYS failed: a Manager could never rotate their own password,
-- and because the RPC aborted before `perform public.revoke_manager_sessions`,
-- the mandatory post-change session revocation never ran either.
--
-- It failed CLOSED (readRpcVerdict maps the error to ok:false, and the
-- transaction rolled the hash swap back), so no bearer was ever left live by
-- this bug and no credential leaked — it was a permanent availability failure
-- on a security-critical path.  It stayed invisible because the existing
-- coverage only ever exercised the super_admin and area_manager kinds.
--
-- A Manager acting on their own account is a legitimate audit actor, so the
-- accurate fix is to admit that actor kind rather than to relabel the row as
-- 'system' and lose who acted.  Additive and forward-only.
-- ---------------------------------------------------------------------------
alter table public.admin_audit_log
  drop constraint if exists admin_audit_log_actor_kind_check;
alter table public.admin_audit_log
  add constraint admin_audit_log_actor_kind_check
  check (actor_kind in ('super_admin', 'area_manager', 'manager', 'system', 'legacy_bootstrap'));

-- ---------------------------------------------------------------------------
-- Password self-service. The OLD password is verified in Node (scrypt) before
-- this RPC runs; this RPC re-checks account liveness UNDER the canonical
-- locks, swaps the hash, stamps password_changed_at (A1) and revokes every
-- session.
-- ---------------------------------------------------------------------------
create or replace function public.set_staff_password(
  p_kind text,
  p_account_id uuid,
  p_password_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_restaurant_id uuid;
  v_status text;
begin
  if p_kind = 'manager' then
    -- Unlocked discovery: identifies the canonical parent only.
    select restaurant_id into v_restaurant_id
    from public.manager_accounts where id = p_account_id;
    if v_restaurant_id is not null then
      perform 1 from public.restaurants where id = v_restaurant_id for key share;
    end if;
    -- Re-read the manager row under its own lock; the discovery value above is
    -- never trusted for the decision.
    select status into v_status
    from public.manager_accounts where id = p_account_id for update;
    if v_status is not null then
      perform public.lock_manager_session_lifecycle(p_account_id);
    end if;
    if v_status is distinct from 'aktif' then
      perform public.write_admin_audit(p_kind, p_account_id, null, 'password.change',
        p_kind, p_account_id, null, 'denied', 'account inactive or missing', '{}');
      return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORIZED');
    end if;
    update public.manager_accounts
    set password_hash = p_password_hash, password_changed_at = now(), updated_at = now()
    where id = p_account_id;
    perform public.revoke_manager_sessions(p_account_id);
    perform public.write_admin_audit(p_kind, p_account_id, null, 'password.change',
      p_kind, p_account_id, null, 'ok', null, '{}');
    return jsonb_build_object('ok', true);
  end if;

  case p_kind
    when 'super_admin' then
      update public.super_admin_accounts
      set password_hash = p_password_hash, password_changed_at = now(), updated_at = now()
      where id = p_account_id and status = 'aktif';
    when 'area_manager' then
      update public.area_manager_accounts
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
  perform public.revoke_staff_sessions(p_kind, p_account_id);
  perform public.write_admin_audit(p_kind, p_account_id, null, 'password.change',
    p_kind, p_account_id, null, 'ok', null, '{}');
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.set_staff_password(text, uuid, text) from public, anon, authenticated;
grant execute on function public.set_staff_password(text, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- Manager activate/deactivate. The AM actor path shares the AM lifecycle lock
-- and re-checks scope after acquiring the canonical locks (A3).
-- ---------------------------------------------------------------------------
create or replace function public.set_manager_status(
  p_actor_kind text,
  p_actor_id uuid,
  p_manager_id uuid,
  p_new_status text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor_label text;
  v_discovered_restaurant_id uuid;
  v_restaurant_id uuid;
begin
  -- Serialize with revoke/deactivate BEFORE the authority check (A3).
  if p_actor_kind = 'area_manager' then
    perform pg_advisory_xact_lock(hashtext('area_manager_lifecycle'));
  end if;

  -- Unlocked discovery of the FK parent, then parent -> child locks.
  select restaurant_id into v_discovered_restaurant_id
  from public.manager_accounts where id = p_manager_id;
  if v_discovered_restaurant_id is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;
  perform 1 from public.restaurants where id = v_discovered_restaurant_id for key share;
  -- Authoritative re-read under the manager row lock.
  select restaurant_id into v_restaurant_id
  from public.manager_accounts where id = p_manager_id for update;
  if v_restaurant_id is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;
  perform public.lock_manager_session_lifecycle(p_manager_id);

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
-- Manager reset approval: ONLY an active AM currently assigned to the
-- manager's restaurant may decide, and only for a 'pending' request — the
-- atomic status flip keeps the first decision final. The reset request is a
-- CHILD of manager_accounts, so it is now locked AFTER the restaurant and
-- manager parents instead of before them.
-- ---------------------------------------------------------------------------
create or replace function public.decide_manager_reset(
  p_decider_kind text,
  p_decider_id uuid,
  p_request_id uuid,
  p_decision text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_request public.manager_reset_requests%rowtype;
  v_manager public.manager_accounts%rowtype;
  v_actor_label text;
  v_manager_id uuid;
  v_restaurant_id uuid;
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

  -- Unlocked discovery walks child -> parents WITHOUT taking any lock, so the
  -- locks themselves are still acquired strictly parent-first below.
  select manager_id into v_manager_id
  from public.manager_reset_requests where id = p_request_id;
  if v_manager_id is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;
  select restaurant_id into v_restaurant_id
  from public.manager_accounts where id = v_manager_id;
  if v_restaurant_id is not null then
    perform 1 from public.restaurants where id = v_restaurant_id for key share;
  end if;
  select * into v_manager from public.manager_accounts where id = v_manager_id for update;
  if v_manager.id is not null then
    perform public.lock_manager_session_lifecycle(v_manager.id);
  end if;

  -- Child row last, and every decision below is re-read under the full order.
  select * into v_request from public.manager_reset_requests where id = p_request_id for update;
  if v_request.id is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;
  if v_request.manager_id is distinct from v_manager_id then
    -- The request was re-pointed between discovery and locking; fail closed
    -- rather than deciding under a stale parent lock.
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;

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
