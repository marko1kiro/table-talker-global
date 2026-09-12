-- Forward-only reconciliation for manager handoff response loss.
-- Reads the exact bearer + reservation pair without mutating session state.
create or replace function public.reconcile_manager_session_handoff(
  p_token text,
  p_reservation_id uuid
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_hash text;
  v_pending public.manager_pending_sessions%rowtype;
  v_reservation public.owner_login_rate_limit_reservations%rowtype;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' or p_reservation_id is null then
    return 'UNKNOWN';
  end if;
  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');

  select * into v_pending
  from public.manager_pending_sessions
  where token_hash = v_hash
    and reservation_id = p_reservation_id;
  if v_pending.id is null then return 'UNKNOWN'; end if;

  select * into v_reservation
  from public.owner_login_rate_limit_reservations
  where id = p_reservation_id;
  if v_reservation.id is null then return 'UNKNOWN'; end if;

  if v_pending.confirmed_at is not null then
    if v_reservation.outcome = 'succeeded'
      and v_reservation.consumed_at is not null
      and exists (
        select 1
        from public.manager_sessions
        where manager_id = v_pending.manager_id
          and restaurant_id = v_pending.restaurant_id
          and token_hash = v_hash
          and expires_at > now()
      )
    then
      return 'SUCCEEDED';
    end if;
    return 'FAILED';
  end if;

  if v_pending.expires_at > now()
    and v_reservation.consumed_at is null
    and v_reservation.expires_at > now()
  then
    return 'PENDING';
  end if;

  return 'FAILED';
end;
$$;

revoke all on function public.reconcile_manager_session_handoff(text, uuid)
  from public, anon, authenticated;
grant execute on function public.reconcile_manager_session_handoff(text, uuid)
  to service_role;
