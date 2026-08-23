create function public.rotate_restaurant_credentials(p_restaurant_id uuid, p_code_hash text, p_code_encrypted text, p_next_code_version integer)
returns void language plpgsql security definer set search_path = public as $$
declare v_current_code_version integer;
begin
  select code_version into v_current_code_version from public.restaurants where id = p_restaurant_id for update;
  if v_current_code_version is null then raise exception 'RESTAURANT_NOT_FOUND'; end if;
  if p_next_code_version <= v_current_code_version then raise exception 'INVALID_CODE_VERSION'; end if;
  update public.restaurants set code_hash = p_code_hash, code_encrypted = p_code_encrypted, code_version = p_next_code_version, credential_rotated_at = now() where id = p_restaurant_id;
  delete from public.restaurant_access_tokens where restaurant_id = p_restaurant_id;
  delete from public.crew_session_tokens where restaurant_id = p_restaurant_id;
  update public.crew_sessions set connection_state = 'disconnected', offline_at = now(), updated_at = now() where restaurant_id = p_restaurant_id and connection_state in ('connecting', 'connected');
end;
$$;
revoke all on function public.rotate_restaurant_credentials(uuid, text, text, integer) from public, anon, authenticated;

create function public.deactivate_restaurant_credentials(p_restaurant_id uuid, p_next_code_version integer)
returns void language plpgsql security definer set search_path = public as $$
declare v_current_code_version integer;
begin
  select code_version into v_current_code_version from public.restaurants where id = p_restaurant_id for update;
  if v_current_code_version is null then raise exception 'RESTAURANT_NOT_FOUND'; end if;
  if p_next_code_version <= v_current_code_version then raise exception 'INVALID_CODE_VERSION'; end if;
  update public.restaurants set is_active = false, code_version = p_next_code_version, credential_rotated_at = now() where id = p_restaurant_id;
  delete from public.restaurant_access_tokens where restaurant_id = p_restaurant_id;
  delete from public.crew_session_tokens where restaurant_id = p_restaurant_id;
  update public.crew_sessions set connection_state = 'disconnected', offline_at = now(), updated_at = now() where restaurant_id = p_restaurant_id and connection_state in ('connecting', 'connected');
end;
$$;
revoke all on function public.deactivate_restaurant_credentials(uuid, integer) from public, anon, authenticated;
