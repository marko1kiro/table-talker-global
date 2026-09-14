-- Poin 6 S1 (owner decision 2026-09-14): the Manager->Crew instruction feature
-- is removed entirely -- the real-world instruction channel is each restaurant's
-- WhatsApp group (YAGNI; cost was not the driver). Tombstone pattern (Poin 1):
-- supabase/migrations/20260907150000_manager_instructions.sql stays on disk
-- untouched as history. This migration drops ONLY objects that file owned:
-- manager_instructions, instruction_receipts, their broadcast trigger fns,
-- send/ack/get/thread/cleanup RPCs, the get_manager_active_crew revival
-- (its sole consumer was getActiveCrewForMessaging), the daily cleanup cron,
-- and the realtime publication membership. Protected assets (restaurants,
-- crew/manager/area accounts, sessions/tokens, pairings, audit log, occupancy,
-- QR tokens, audio) are NOT touched.

do $$
begin
  create extension if not exists pg_cron;
  perform cron.unschedule('cleanup-expired-instructions-daily');
exception
  when insufficient_privilege or undefined_object or undefined_function
       or invalid_text_representation or feature_not_supported then null;
end;
$$;

drop trigger if exists instruction_receipts_broadcast_created
  on public.instruction_receipts;
drop trigger if exists instruction_receipts_broadcast_acked
  on public.instruction_receipts;

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure::text as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'broadcast_instruction_created',
        'broadcast_instruction_acked',
        'send_manager_instruction',
        'get_pending_instructions',
        'ack_instruction',
        'get_instruction_thread',
        'cleanup_expired_instructions',
        'get_manager_active_crew'
      )
  loop
    execute format('drop function %s', r.signature);
  end loop;
end;
$$;

do $$
begin
  alter publication supabase_realtime drop table public.instruction_receipts;
exception
  when undefined_object or undefined_table then null;
end;
$$;

drop table if exists public.instruction_receipts;
drop table if exists public.manager_instructions;
