-- Fix QR scan RPC conflict-target ambiguity (SQLSTATE 42702).
--
-- resolve_and_enqueue_qr_scan declares RETURNS TABLE(restaurant_id,
-- table_number, esb_app_id, enqueued), so those OUT names are also PL/pgSQL
-- variables inside the function body. The original ON CONFLICT used bare
-- column names (restaurant_id, table_number, ip_hash); Postgres could not
-- tell the OUT variable from the table column and raised
-- "column reference restaurant_id is ambiguous". This only surfaced once the
-- scanner-IP header fix let the RPC actually run.
--
-- Redefine the function with an unambiguous conflict target: the primary key
-- constraint name (ON CONSTRAINT qr_scan_debounce_pkey) is not a column
-- reference, so it is immune to PL/pgSQL variable substitution. All debounce,
-- rate-limit, and durable-outbox behavior is preserved byte-for-byte. The
-- original migration file is intentionally left untouched.

create or replace function public.resolve_and_enqueue_qr_scan(
  p_scan_id uuid,
  p_token text,
  p_ip_hash text
)
returns table (
  restaurant_id uuid,
  table_number integer,
  esb_app_id text,
  enqueued boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant_id uuid;
  v_table_number integer;
  v_esb_app_id text;
  v_enqueued boolean := false;
begin
  if p_token !~ '^[A-Za-z0-9_-]{43}$' or p_ip_hash !~ '^[0-9a-f]{64}$' then
    return;
  end if;

  select t.restaurant_id, t.table_number, r.esb_app_id
  into v_restaurant_id, v_table_number, v_esb_app_id
  from public.qr_table_tokens t
  join public.restaurants r on r.id = t.restaurant_id
  where t.token = p_token
    and t.revoked_at is null
    and r.is_active
    and nullif(btrim(r.esb_app_id), '') is not null;

  if not found then return; end if;

  insert into public.qr_scan_debounce as debounce (
    restaurant_id, table_number, ip_hash, last_scan_at, window_started_at, accepted_scan_count
  ) values (
    v_restaurant_id, v_table_number, p_ip_hash, now(), now(), 1
  )
  on conflict on constraint qr_scan_debounce_pkey do update
    set last_scan_at = now(),
        window_started_at = case
          when debounce.window_started_at <= now() - interval '10 minutes' then now()
          else debounce.window_started_at
        end,
        accepted_scan_count = case
          when debounce.window_started_at <= now() - interval '10 minutes' then 1
          else debounce.accepted_scan_count + 1
        end
    where debounce.last_scan_at <= now() - interval '30 seconds'
      and (
        debounce.window_started_at <= now() - interval '10 minutes'
        or debounce.accepted_scan_count < 10
      )
  returning true into v_enqueued;

  if coalesce(v_enqueued, false) then
    insert into public.pending_qr_scans (scan_id, restaurant_id, table_number)
    values (p_scan_id, v_restaurant_id, v_table_number)
    on conflict (scan_id) do nothing;
  end if;

  return query select v_restaurant_id, v_table_number, v_esb_app_id, coalesce(v_enqueued, false);
end;
$$;

revoke all on function public.resolve_and_enqueue_qr_scan(uuid, text, text) from public, anon, authenticated;
grant execute on function public.resolve_and_enqueue_qr_scan(uuid, text, text) to service_role;
