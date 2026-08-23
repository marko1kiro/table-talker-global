create function public.provision_restaurant_credentials(p_restaurant_id uuid, p_code_hash text, p_code_encrypted text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_code_hash = '' or p_code_encrypted = '' then raise exception 'INVALID_CREDENTIAL'; end if;
  update public.restaurants
  set code_hash = p_code_hash, code_encrypted = p_code_encrypted, credential_rotated_at = now()
  where id = p_restaurant_id and code_hash is null and code_encrypted is null;
  if not found then raise exception 'RESTAURANT_NOT_PROVISIONABLE'; end if;
  insert into public.restaurant_credential_audit (restaurant_id, operation, success, reason_category)
  values (p_restaurant_id, 'created', true, 'provisioned');
end;
$$;
revoke all on function public.provision_restaurant_credentials(uuid, text, text) from public, anon, authenticated;
grant execute on function public.provision_restaurant_credentials(uuid, text, text) to service_role;
