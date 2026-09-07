-- Manager → Crew messaging: instructions with ACK + reply.

-- 1. Tables
create table public.manager_instructions (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  manager_id uuid not null references public.manager_accounts (id) on delete cascade,
  target_type text not null check (target_type in ('all', 'individual')),
  target_session_id uuid references public.crew_role_sessions (id) on delete set null,
  message text not null check (char_length(message) <= 200),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index manager_instructions_restaurant_idx
  on public.manager_instructions (restaurant_id, created_at desc);
alter table public.manager_instructions enable row level security;
revoke all on public.manager_instructions from public, anon, authenticated;

create table public.instruction_receipts (
  id uuid primary key default gen_random_uuid(),
  instruction_id uuid not null references public.manager_instructions (id) on delete cascade,
  role_session_id uuid not null references public.crew_role_sessions (id) on delete cascade,
  ack_at timestamptz,
  reply_text text check (reply_text is null or char_length(reply_text) <= 100),
  replied_at timestamptz,
  unique (instruction_id, role_session_id)
);
create index instruction_receipts_pending_idx
  on public.instruction_receipts (role_session_id, ack_at)
  where ack_at is null;
alter table public.instruction_receipts enable row level security;
revoke all on public.instruction_receipts from public, anon, authenticated;

-- 2. RPC: send_manager_instruction
create or replace function public.send_manager_instruction(
  p_manager_token text,
  p_target_type text,
  p_target_role_session_id uuid default null,
  p_message text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_manager_id uuid;
  v_restaurant uuid;
  v_instruction_id uuid;
  v_inserted_count integer;
begin
  select ma.id, ms.restaurant_id into v_manager_id, v_restaurant
  from public.manager_sessions ms
  join public.manager_accounts ma on ma.id = ms.manager_id
  join public.restaurants r on r.id = ms.restaurant_id
  where ms.token_hash = encode(extensions.digest(p_manager_token, 'sha256'), 'hex')
    and ma.status = 'aktif'
    and ms.expires_at > now()
    and r.is_active;
  if v_restaurant is null then raise exception 'INVALID_SESSION'; end if;

  if p_target_type not in ('all', 'individual') then
    raise exception 'INVALID_TARGET_TYPE';
  end if;
  if char_length(p_message) < 1 or char_length(p_message) > 200 then
    raise exception 'INVALID_MESSAGE';
  end if;

  insert into public.manager_instructions
    (restaurant_id, manager_id, target_type, target_session_id, message, expires_at)
  values (
    v_restaurant, v_manager_id, p_target_type,
    case when p_target_type = 'individual' then p_target_role_session_id else null end,
    p_message,
    date_trunc('day', now() at time zone 'Asia/Jakarta' + interval '1 day') at time zone 'Asia/Jakarta'
  )
  returning id into v_instruction_id;

  if p_target_type = 'all' then
    insert into public.instruction_receipts (instruction_id, role_session_id)
    select v_instruction_id, rst.role_session_id
    from public.role_session_tokens rst
    where rst.restaurant_id = v_restaurant
      and rst.expires_at > now()
    group by rst.role_session_id;

    get diagnostics v_inserted_count = row_count;
    if v_inserted_count = 0 then
      delete from public.manager_instructions where id = v_instruction_id;
      raise exception 'NO_ACTIVE_CREW';
    end if;
  else
    if p_target_role_session_id is null then
      raise exception 'INVALID_TARGET';
    end if;
    insert into public.instruction_receipts (instruction_id, role_session_id)
    values (v_instruction_id, p_target_role_session_id);
  end if;

  return v_instruction_id;
end;
$$;
revoke all on function public.send_manager_instruction(text, text, uuid, text)
  from public, anon, service_role;
grant execute on function public.send_manager_instruction(text, text, uuid, text)
  to authenticated;

-- 3. RPC: ack_instruction
create or replace function public.ack_instruction(
  p_role_session_token text,
  p_instruction_id uuid,
  p_reply_text text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role_session_id uuid;
  v_updated integer;
begin
  select rst.role_session_id into v_role_session_id
  from public.role_session_tokens rst
  where rst.token_hash = encode(extensions.digest(p_role_session_token, 'sha256'), 'hex')
    and rst.expires_at > now();
  if v_role_session_id is null then raise exception 'INVALID_SESSION'; end if;

  if p_reply_text is not null and char_length(p_reply_text) > 100 then
    raise exception 'REPLY_TOO_LONG';
  end if;

  update public.instruction_receipts
  set ack_at = now(),
      reply_text = p_reply_text,
      replied_at = case when p_reply_text is not null then now() else null end
  where instruction_id = p_instruction_id
    and role_session_id = v_role_session_id
    and ack_at is null;

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;
revoke all on function public.ack_instruction(text, uuid, text)
  from public, anon, service_role;
grant execute on function public.ack_instruction(text, uuid, text)
  to authenticated;

-- 4. RPC: get_pending_instructions
create or replace function public.get_pending_instructions(
  p_role_session_token text
)
returns table (
  instruction_id uuid,
  message text,
  manager_name text,
  created_at timestamptz,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role_session_id uuid;
begin
  select rst.role_session_id into v_role_session_id
  from public.role_session_tokens rst
  where rst.token_hash = encode(extensions.digest(p_role_session_token, 'sha256'), 'hex')
    and rst.expires_at > now();
  if v_role_session_id is null then raise exception 'INVALID_SESSION'; end if;

  return query
  select mi.id as instruction_id, mi.message, ma.full_name as manager_name,
         mi.created_at, mi.expires_at
  from public.instruction_receipts ir
  join public.manager_instructions mi on mi.id = ir.instruction_id
  join public.manager_accounts ma on ma.id = mi.manager_id
  where ir.role_session_id = v_role_session_id
    and ir.ack_at is null
    and mi.expires_at > now()
  order by mi.created_at asc;
end;
$$;
revoke all on function public.get_pending_instructions(text)
  from public, anon, service_role;
grant execute on function public.get_pending_instructions(text)
  to authenticated;

-- 5. RPC: get_instruction_thread
create or replace function public.get_instruction_thread(
  p_manager_token text,
  p_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant uuid;
  v_target_date date;
  v_result jsonb;
begin
  select ms.restaurant_id into v_restaurant
  from public.manager_sessions ms
  join public.manager_accounts ma on ma.id = ms.manager_id
  join public.restaurants r on r.id = ms.restaurant_id
  where ms.token_hash = encode(extensions.digest(p_manager_token, 'sha256'), 'hex')
    and ma.status = 'aktif'
    and ms.expires_at > now()
    and r.is_active;
  if v_restaurant is null then raise exception 'INVALID_SESSION'; end if;

  v_target_date := coalesce(p_date, (now() at time zone 'Asia/Jakarta')::date);

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'instruction_id', mi.id,
      'message', mi.message,
      'target_type', mi.target_type,
      'target_display_name', (
        select crs.display_name from public.crew_role_sessions crs
        where crs.id = mi.target_session_id
      ),
      'created_at', mi.created_at,
      'receipts', (
        select coalesce(jsonb_agg(
          jsonb_build_object(
            'role_session_id', ir.role_session_id,
            'display_name', crs2.display_name,
            'role', crs2.role,
            'ack_at', ir.ack_at,
            'reply_text', ir.reply_text,
            'replied_at', ir.replied_at
          ) order by ir.ack_at nulls last
        ), '[]'::jsonb)
        from public.instruction_receipts ir
        join public.crew_role_sessions crs2 on crs2.id = ir.role_session_id
        where ir.instruction_id = mi.id
      )
    ) order by mi.created_at desc
  ), '[]'::jsonb) into v_result
  from public.manager_instructions mi
  where mi.restaurant_id = v_restaurant
    and (mi.created_at at time zone 'Asia/Jakarta')::date = v_target_date;

  return v_result;
end;
$$;
revoke all on function public.get_instruction_thread(text, date)
  from public, anon, service_role;
grant execute on function public.get_instruction_thread(text, date)
  to authenticated;

-- 6. Broadcast triggers
create or replace function public.broadcast_instruction_created()
returns trigger
language plpgsql
security definer
set search_path = public, realtime
as $$
declare
  v_instruction record;
  v_manager_name text;
begin
  select mi.* into v_instruction
  from public.manager_instructions mi
  where mi.id = new.instruction_id;

  select ma.full_name into v_manager_name
  from public.manager_accounts ma
  where ma.id = v_instruction.manager_id;

  perform realtime.send(
    jsonb_build_object(
      'instruction_id', v_instruction.id,
      'message', v_instruction.message,
      'target_session_id', new.role_session_id,
      'manager_name', v_manager_name,
      'created_at', v_instruction.created_at
    ),
    'instruction',
    'table-occupancy:' || v_instruction.restaurant_id::text,
    true
  );
  return new;
end;
$$;
revoke all on function public.broadcast_instruction_created() from public, anon, authenticated;

create trigger instruction_receipts_broadcast_created
  after insert on public.instruction_receipts
  for each row execute function public.broadcast_instruction_created();

create or replace function public.broadcast_instruction_acked()
returns trigger
language plpgsql
security definer
set search_path = public, realtime
as $$
declare
  v_restaurant uuid;
  v_display_name text;
begin
  if old.ack_at is not null or new.ack_at is null then return new; end if;

  select mi.restaurant_id into v_restaurant
  from public.manager_instructions mi
  where mi.id = new.instruction_id;

  select crs.display_name into v_display_name
  from public.crew_role_sessions crs
  where crs.id = new.role_session_id;

  perform realtime.send(
    jsonb_build_object(
      'instruction_id', new.instruction_id,
      'role_session_id', new.role_session_id,
      'display_name', v_display_name,
      'ack_at', new.ack_at,
      'reply_text', new.reply_text
    ),
    'instruction_ack',
    'table-occupancy:' || v_restaurant::text,
    true
  );
  return new;
end;
$$;
revoke all on function public.broadcast_instruction_acked() from public, anon, authenticated;

create trigger instruction_receipts_broadcast_acked
  after update on public.instruction_receipts
  for each row execute function public.broadcast_instruction_acked();

-- 7. Cleanup cron: 02:00 WIB = 19:00 UTC daily
create or replace function public.cleanup_expired_instructions()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.manager_instructions where expires_at < now();
$$;
revoke all on function public.cleanup_expired_instructions() from public, anon, authenticated;
grant execute on function public.cleanup_expired_instructions() to service_role;

do $$
begin
  create extension if not exists pg_cron;
  if not exists (
    select 1 from cron.job where jobname = 'cleanup-expired-instructions-daily'
  ) then
    perform cron.schedule(
      'cleanup-expired-instructions-daily',
      '0 19 * * *',
      $cron$select public.cleanup_expired_instructions()$cron$
    );
  end if;
exception
  when insufficient_privilege or undefined_file or undefined_function or invalid_schema_name
       or feature_not_supported then null;
end;
$$;

-- 8. Add to Realtime publication
do $$
begin
  begin
    alter publication supabase_realtime add table public.instruction_receipts;
  exception
    when duplicate_object then null;
  end;
end;
$$;

-- 9. Update purge RPC to include new tables
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

  -- 3. Manager instructions (before crew_role_sessions cascade)
  delete from public.instruction_receipts
  where instruction_id in (
    select id from public.manager_instructions where restaurant_id = p_restaurant_id
  );
  delete from public.manager_instructions where restaurant_id = p_restaurant_id;

  delete from public.crew_role_sessions where restaurant_id = p_restaurant_id;

  -- 4. Soundboard legacy crew sessions & tokens
  delete from public.crew_session_tokens
  where crew_session_id in (
    select id from public.crew_sessions where restaurant_id = p_restaurant_id
  );
  delete from public.crew_sessions where restaurant_id = p_restaurant_id;

  -- 5. Activity, playback, errors, and messages
  delete from public.playback_events where restaurant_id = p_restaurant_id;
  delete from public.crew_messages where restaurant_id = p_restaurant_id;
  delete from public.remote_commands where restaurant_id = p_restaurant_id;
  delete from public.operational_errors where restaurant_id = p_restaurant_id;

  -- 6. Realtime revision bump
  select public.bump_table_occupancy_revision(p_restaurant_id) into v_rev;

  return jsonb_build_object('ok', true, 'revision', coalesce(v_rev, 0));
end;
$$;
