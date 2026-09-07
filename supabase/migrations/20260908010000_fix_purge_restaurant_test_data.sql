-- Fix super_admin_purge_restaurant_test_data:
-- 1. Fix role_session_pin_attempts: use bucket_hash (sha256) instead of non-existent restaurant_id
-- 2. Add missing tables: audio_manifests, qr_export_batches, qr_table_tokens,
--    manager_sessions, table_occupancy_revisions, restaurant_credential_audit

CREATE OR REPLACE FUNCTION public.super_admin_purge_restaurant_test_data(p_restaurant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exists boolean;
  v_rev bigint;
  v_bucket text;
BEGIN
  SELECT exists(SELECT 1 FROM public.restaurants WHERE id = p_restaurant_id) INTO v_exists;
  IF NOT v_exists THEN
    RETURN jsonb_build_object('ok', false, 'error', 'RESTAURANT_NOT_FOUND');
  END IF;

  -- Compute bucket hash for role_session_pin_attempts (no restaurant_id column)
  v_bucket := encode(extensions.digest('restaurant:' || p_restaurant_id::text, 'sha256'), 'hex');

  -- Occupancy
  DELETE FROM public.table_occupancy_state WHERE restaurant_id = p_restaurant_id;
  DELETE FROM public.occupancy_transitions WHERE restaurant_id = p_restaurant_id;
  DELETE FROM public.table_escort_intents WHERE restaurant_id = p_restaurant_id;
  DELETE FROM public.table_occupancy_revisions WHERE restaurant_id = p_restaurant_id;

  -- QR
  DELETE FROM public.qr_scan_events WHERE restaurant_id = p_restaurant_id;
  DELETE FROM public.pending_qr_scans WHERE restaurant_id = p_restaurant_id;
  DELETE FROM public.qr_scan_debounce WHERE restaurant_id = p_restaurant_id;
  DELETE FROM public.qr_table_tokens WHERE restaurant_id = p_restaurant_id;
  DELETE FROM public.qr_export_batches WHERE restaurant_id = p_restaurant_id;

  -- Role sessions
  DELETE FROM public.role_session_tokens
  WHERE role_session_id IN (
    SELECT id FROM public.crew_role_sessions WHERE restaurant_id = p_restaurant_id
  );
  DELETE FROM public.role_session_pin_attempts WHERE bucket_hash = v_bucket;

  -- Instructions
  DELETE FROM public.instruction_receipts
  WHERE instruction_id IN (
    SELECT id FROM public.manager_instructions WHERE restaurant_id = p_restaurant_id
  );
  DELETE FROM public.manager_instructions WHERE restaurant_id = p_restaurant_id;

  -- Crew sessions
  DELETE FROM public.crew_role_sessions WHERE restaurant_id = p_restaurant_id;
  DELETE FROM public.crew_session_tokens
  WHERE crew_session_id IN (
    SELECT id FROM public.crew_sessions WHERE restaurant_id = p_restaurant_id
  );
  DELETE FROM public.crew_sessions WHERE restaurant_id = p_restaurant_id;

  -- Manager sessions
  DELETE FROM public.manager_sessions WHERE restaurant_id = p_restaurant_id;

  -- Audio & events
  DELETE FROM public.playback_events WHERE restaurant_id = p_restaurant_id;
  DELETE FROM public.audio_manifests WHERE restaurant_id = p_restaurant_id;

  -- Operational
  DELETE FROM public.operational_errors WHERE restaurant_id = p_restaurant_id;
  DELETE FROM public.restaurant_credential_audit WHERE restaurant_id = p_restaurant_id;

  SELECT public.bump_table_occupancy_revision(p_restaurant_id) INTO v_rev;

  RETURN jsonb_build_object('ok', true, 'revision', coalesce(v_rev, 0));
END;
$$;
