-- Manager registration + login bootstrap RPCs. All service_role: they are only
-- ever called from trusted server functions (register/login), never from a
-- browser. get_manager_credential returns the stored hash so the Node server fn
-- can verify scrypt; create_manager_session mints a bearer token.

create or replace function public.register_manager(
  p_id_manager text,
  p_full_name text,
  p_restaurant_code text,
  p_password_hash text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant public.restaurants%rowtype;
begin
  select * into v_restaurant
  from public.restaurants
  where code = upper(trim(p_restaurant_code)) and is_active;
  if v_restaurant.id is null then raise exception 'RESTAURANT_NOT_FOUND'; end if;

  if exists (select 1 from public.manager_accounts where id_manager = lower(trim(p_id_manager))) then
    raise exception 'ID_MANAGER_TAKEN';
  end if;

  begin
    insert into public.manager_accounts (id_manager, full_name, restaurant_id, password_hash)
    values (lower(trim(p_id_manager)), trim(p_full_name), v_restaurant.id, p_password_hash);
  exception when unique_violation then
    raise exception 'ID_MANAGER_TAKEN';
  end;
  return true;
end;
$$;
revoke all on function public.register_manager(text, text, text, text) from public, anon, authenticated;
grant execute on function public.register_manager(text, text, text, text) to service_role;

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
  where ma.id_manager = lower(trim(p_id_manager));
$$;
revoke all on function public.get_manager_credential(text) from public, anon, authenticated;
grant execute on function public.get_manager_credential(text) to service_role;

create or replace function public.create_manager_session(p_manager_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account public.manager_accounts%rowtype;
  v_token text;
  v_expires timestamptz;
begin
  select * into v_account from public.manager_accounts
  where id = p_manager_id and status = 'aktif';
  if v_account.id is null then raise exception 'INVALID_MANAGER'; end if;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_expires := now() + interval '12 hours';
  insert into public.manager_sessions (manager_id, restaurant_id, token_hash, expires_at)
  values (v_account.id, v_account.restaurant_id, encode(extensions.digest(v_token, 'sha256'), 'hex'), v_expires);

  return v_token;
end;
$$;
revoke all on function public.create_manager_session(uuid) from public, anon, authenticated;
grant execute on function public.create_manager_session(uuid) to service_role;
