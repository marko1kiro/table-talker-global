-- R7-C: bind each manager pending session to exactly one rate-limit reservation.
alter table public.manager_pending_sessions
  add column if not exists reservation_id uuid;

alter table public.manager_pending_sessions
  drop constraint if exists manager_pending_sessions_reservation_id_fkey;

alter table public.manager_pending_sessions
  add constraint manager_pending_sessions_reservation_id_fkey
  foreign key (reservation_id)
  references public.owner_login_rate_limit_reservations(id);

create unique index if not exists manager_pending_sessions_reservation_id_idx
  on public.manager_pending_sessions (reservation_id)
  where reservation_id is not null;

create or replace function public.create_manager_session_pending(
  p_manager_id uuid,
  p_reservation_id uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account public.manager_accounts%rowtype;
  v_token text;
begin
  delete from public.manager_pending_sessions where expires_at < now();
  if p_reservation_id is null then raise exception 'RESERVATION_REQUIRED'; end if;
  if not exists (
    select 1 from public.owner_login_rate_limit_reservations
    where id = p_reservation_id and consumed_at is null and expires_at > now()
  ) then raise exception 'RESERVATION_NOT_CONSUMABLE'; end if;
  select * into v_account from public.manager_accounts
  where id = p_manager_id and status = 'aktif';
  if v_account.id is null then raise exception 'INVALID_MANAGER'; end if;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.manager_pending_sessions
    (manager_id, restaurant_id, token_hash, reservation_id, expires_at)
  values
    (v_account.id, v_account.restaurant_id,
     encode(extensions.digest(v_token, 'sha256'), 'hex'), p_reservation_id,
     now() + interval '60 seconds');
  return v_token;
end;
$$;

revoke all on function public.create_manager_session_pending(uuid) from public, anon, authenticated;
drop function if exists public.create_manager_session_pending(uuid);
revoke all on function public.create_manager_session_pending(uuid, uuid) from public, anon, authenticated;
grant execute on function public.create_manager_session_pending(uuid, uuid) to service_role;

drop function if exists public.confirm_manager_session(text, uuid);

create function public.confirm_manager_session(
  p_token text,
  p_reservation_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text := encode(extensions.digest(p_token, 'sha256'), 'hex');
  v_pending public.manager_pending_sessions%rowtype;
begin
  select * into v_pending from public.manager_pending_sessions
  where token_hash = v_hash and confirmed_at is null
  for update;
  if v_pending.id is null or v_pending.reservation_id is null
     or v_pending.reservation_id <> p_reservation_id
     or v_pending.expires_at <= now() then return false; end if;
  update public.manager_pending_sessions set confirmed_at = now() where id = v_pending.id;
  delete from public.manager_sessions where manager_id = v_pending.manager_id;
  insert into public.manager_sessions (manager_id, restaurant_id, token_hash, expires_at)
  values (v_pending.manager_id, v_pending.restaurant_id, v_pending.token_hash, now() + interval '12 hours');
  if not public.apply_owner_login_rate_limit(v_pending.reservation_id, true) then
    raise exception 'RESERVATION_NOT_CONSUMABLE' using errcode = 'R0001';
  end if;
  return true;
end;
$$;

revoke all on function public.confirm_manager_session(text, uuid) from public, anon, authenticated;
grant execute on function public.confirm_manager_session(text, uuid) to service_role;
