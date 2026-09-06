-- Super Admin: Safe purge of operational and testing data for a specific restaurant.
-- Preserves master data: restaurants, manager_accounts, audio_manifests, qr_table_tokens.

create or replace function public.super_admin_purge_restaurant_test_data(
  p_restaurant_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exists boolean;
  v_rev bigint;
begin
  select exists(select 1 from public.restaurants where id = p_restaurant_id) into v_exists;
  if not v_exists then
    return jsonb_build_object('ok', false, 'error', 'RESTAURANT_NOT_FOUND');
  end if;

  -- 1. Table occupancy & status
  delete from public.table_occupancy_state where restaurant_id = p_restaurant_id;
  delete from public.occupancy_transitions where restaurant_id = p_restaurant_id;
  delete from public.table_escort_intents where restaurant_id = p_restaurant_id;
  delete from public.qr_scan_events where restaurant_id = p_restaurant_id;
  delete from public.pending_qr_scans where restaurant_id = p_restaurant_id;
  delete from public.qr_scan_debounce where restaurant_id = p_restaurant_id;

  -- 2. Crew sessions & tokens (all roles)
  delete from public.role_session_tokens
  where role_session_id in (
    select id from public.crew_role_sessions where restaurant_id = p_restaurant_id
  );
  delete from public.role_session_pin_attempts where restaurant_id = p_restaurant_id;
  delete from public.crew_role_sessions where restaurant_id = p_restaurant_id;

  -- 3. Soundboard legacy crew sessions & tokens
  delete from public.crew_session_tokens
  where crew_session_id in (
    select id from public.crew_sessions where restaurant_id = p_restaurant_id
  );
  delete from public.crew_sessions where restaurant_id = p_restaurant_id;

  -- 4. Activity, playback, errors, and messages
  delete from public.playback_events where restaurant_id = p_restaurant_id;
  delete from public.crew_messages where restaurant_id = p_restaurant_id;
  delete from public.remote_commands where restaurant_id = p_restaurant_id;
  delete from public.operational_errors where restaurant_id = p_restaurant_id;

  -- 5. Realtime revision bump (so Kasir/Satgas/Manager see instant empty state)
  v_rev := public.bump_table_occupancy_revision(p_restaurant_id);

  return jsonb_build_object('ok', true, 'revision', v_rev);
end;
$$;

revoke all on function public.super_admin_purge_restaurant_test_data(uuid) from public, anon;
grant execute on function public.super_admin_purge_restaurant_test_data(uuid) to authenticated, service_role;
