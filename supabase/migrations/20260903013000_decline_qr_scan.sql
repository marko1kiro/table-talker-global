-- Opsi D: pelanggan menekan "Saya pindah meja" pada halaman konfirmasi QR.
-- Mengosongkan meja yang baru ditandai scan-nya, dengan guard ketat:
-- hanya scan 'processed' dalam 10 menit, masih scan terbaru di meja itu,
-- dan occupancy-nya bersumber 'qr_scan' (bukan kasir manual).

create or replace function public.decline_qr_scan(p_scan_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_scan public.pending_qr_scans%rowtype;
  v_revision bigint;
begin
  if p_scan_id is null then return false; end if;

  select * into v_scan
  from public.pending_qr_scans
  where scan_id = p_scan_id
    and status = 'processed'
    and created_at >= now() - interval '10 minutes'
  for update;
  if not found then return false; end if;

  if exists (
    select 1 from public.qr_scan_events
    where restaurant_id = v_scan.restaurant_id
      and table_number = v_scan.table_number
      and scanned_at > v_scan.processed_at
  ) then
    return false;
  end if;

  update public.table_occupancy_state
  set status = 'kosong',
      occupied_at = null,
      occupied_source = null,
      updated_at = now()
  where restaurant_id = v_scan.restaurant_id
    and table_number = v_scan.table_number
    and status = 'terisi'
    and occupied_source = 'qr_scan';
  if not found then return false; end if;

  update public.table_escort_intents
  set resolved = true
  where restaurant_id = v_scan.restaurant_id
    and table_number = v_scan.table_number
    and resolved = false;

  v_revision := public.bump_table_occupancy_revision(v_scan.restaurant_id);
  perform realtime.send(
    jsonb_build_object('table_number', v_scan.table_number, 'revision', v_revision),
    'invalidate',
    'table-occupancy:' || v_scan.restaurant_id::text,
    true
  );

  update public.pending_qr_scans
  set status = 'terminal',
      terminal_at = now(),
      terminal_reason = 'CUSTOMER_DECLINED'
  where scan_id = p_scan_id;

  return true;
end;
$$;
revoke all on function public.decline_qr_scan(uuid) from public, anon, authenticated;
grant execute on function public.decline_qr_scan(uuid) to service_role;
