-- Shortens the Satgas Escort Intent window from 30 minutes to 10 minutes,
-- per user request (product decision -- no design-doc rationale beyond
-- "10 minutes is enough time to escort a guest to their table").
--
-- Re-creates create_escort_intent (originally
-- 20260829020000_table_occupancy_rpcs.sql) with the only change being the
-- expires_at interval. Every other clause -- session validation, table
-- number bounds check, actor_session_id binding -- is unchanged.
--
-- confirm_escort_intent needs no change: it only compares against the
-- expires_at value already stored on the row (`expires_at <= now()`), so a
-- shorter interval here is all that's required to shorten its effective
-- wait.
create or replace function public.create_escort_intent(
  p_restaurant_id uuid,
  p_table_number integer,
  p_session_token text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session record;
  v_id uuid;
begin
  select * into v_session
  from public.role_session_tokens
  where token_hash = encode(extensions.digest(p_session_token, 'sha256'), 'hex')
    and restaurant_id = p_restaurant_id
    and role = 'satgas'
    and expires_at > now();
  if v_session is null then raise exception 'INVALID_SESSION'; end if;

  if p_table_number not between 1 and 100 then raise exception 'INVALID_TABLE_NUMBER'; end if;

  insert into public.table_escort_intents (restaurant_id, table_number, actor_session_id, expires_at)
  values (p_restaurant_id, p_table_number, v_session.role_session_id, now() + interval '10 minutes')
  returning id into v_id;

  return v_id;
end;
$$;
revoke all on function public.create_escort_intent(uuid, integer, text) from public, anon, service_role;
grant execute on function public.create_escort_intent(uuid, integer, text) to authenticated;
