-- Fix PIN rate limit: bucket by restaurant only, not tenant token.
-- Previously tenant token rotated on each login_to_restaurant_atomic call,
-- giving each PIN attempt a fresh rate limit window.

create or replace function public.claim_role_session(
  p_restaurant_id uuid,
  p_tenant_token text,
  p_role text,
  p_display_name text,
  p_checked_in_at timestamptz,
  p_pin text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.crew_role_sessions;
  v_token text := encode(extensions.gen_random_bytes(32), 'hex');
  v_pin_hash text;
  v_code_version integer;
  v_restaurant_bucket text;
  v_now timestamptz := now();
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  if p_role not in ('ss', 'kasir', 'satgas', 'clear_up') then raise exception 'INVALID_ROLE'; end if;

  select r.pin_hash, r.code_version into v_pin_hash, v_code_version
  from public.restaurant_access_tokens rat
  join public.restaurants r on r.id = rat.restaurant_id
  where rat.restaurant_id = p_restaurant_id
    and rat.token_hash = encode(extensions.digest(p_tenant_token, 'sha256'), 'hex')
    and rat.expires_at > v_now
    and r.is_active
    and rat.code_version = r.code_version;
  if v_pin_hash is null then raise exception 'INVALID_TENANT_SESSION'; end if;

  if p_display_name !~ '^[[:print:]]+$' or char_length(p_display_name) not between 1 and 40
  then raise exception 'INVALID_NAME'; end if;

  if p_checked_in_at is null then raise exception 'INVALID_CHECKED_IN_AT'; end if;

  if p_pin is null or p_pin !~ '^[0-9]{4}$' then raise exception 'INVALID_PIN'; end if;

  -- FIX: bucket by restaurant only (tenant bucket removed — rotates each login)
  v_restaurant_bucket := encode(extensions.digest('restaurant:' || p_restaurant_id::text, 'sha256'), 'hex');

  insert into public.role_session_pin_attempts(bucket_hash)
  values (v_restaurant_bucket)
  on conflict (bucket_hash) do nothing;

  perform 1 from public.role_session_pin_attempts
  where bucket_hash = v_restaurant_bucket
  for update;

  if exists (
    select 1 from public.role_session_pin_attempts
    where bucket_hash = v_restaurant_bucket and blocked_until > v_now
  ) then raise exception 'PIN_RATE_LIMITED'; end if;

  if v_pin_hash <> encode(extensions.digest(p_pin, 'sha256'), 'hex') then
    update public.role_session_pin_attempts set
      failures = case when window_started_at <= v_now - interval '15 minutes' then 1 else failures + 1 end,
      window_started_at = case when window_started_at <= v_now - interval '15 minutes' then v_now else window_started_at end,
      blocked_until = case
        when window_started_at > v_now - interval '15 minutes' and failures + 1 >= 5 then v_now + interval '15 minutes'
        else blocked_until
      end
    where bucket_hash = v_restaurant_bucket;
    raise exception 'INVALID_PIN';
  end if;

  update public.role_session_pin_attempts set failures = 0, window_started_at = v_now, blocked_until = null
  where bucket_hash = v_restaurant_bucket;

  insert into public.crew_role_sessions (restaurant_id, role, display_name, checked_in_at)
  values (p_restaurant_id, p_role, p_display_name, p_checked_in_at)
  returning * into result;

  insert into public.role_session_tokens (token_hash, restaurant_id, role_session_id, role, expires_at, code_version)
  values (
    encode(extensions.digest(v_token, 'sha256'), 'hex'),
    p_restaurant_id,
    result.id,
    p_role,
    v_now + interval '9 hours',
    v_code_version
  );

  return jsonb_build_object('session', to_jsonb(result), 'session_token', v_token);
end;
$$;
