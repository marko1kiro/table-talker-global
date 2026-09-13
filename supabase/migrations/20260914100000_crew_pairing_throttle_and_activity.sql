-- Poin 5 (G4 + G2): throttle pairing-request per akun + riwayat aktivitas crew
-- untuk dashboard Manager. Pairing lifecycle inti sudah dibangun Poin 3
-- (20260913100000-130000); file ini hanya menutup dua gap sisa scope Poin 5:
--   G4: crew_request_pairing bisa dipakai spam (tiap panggilan = OTP baru di
--       dashboard Manager). Batas baru: maksimal 5 request per uid per rolling
--       60 menit; keputusan PAIRING_THROTTLED DI-RETURN (bukan raise) supaya
--       pola verdict persisted tetap, dan pending yang ada TIDAK di-expire
--       saat throttle (caller masih bisa menyelesaikan OTP yang sedang hidup).
--   G2: Manager tidak punya pandangan riwayat aksi crew (approve/reject/reset/
--       end-session). Auditya SUDAH ditulis ke admin_audit_log oleh RPC Poin 3;
--       get_crew_activity membacanya kembali, discoping ke resto manager
--       (pola token-auth + INVALID_SESSION yang sama persis dengan
--       get_crew_accounts). Kolom nama crew: join akun, fallback ke nama pada
--       request pairing terakhir, fallback ke potongan uid (baris audit tidak
--       membocorkan lintas resto karena filter restaurant_id).

-- ---------------------------------------------------------------------------
-- G4: crew_request_pairing dengan throttle 5/jam per uid.
-- Redefinisi utuh dari 20260913110000 Step 2; satu-satunya perubahan perilaku
-- adalah blok throttle setelah advisory lock per-uid diambil dan sebelum
-- expire+insert. Kontrak lama (raise UNAUTHORIZED/INVALID_NAME/INTERNAL/
-- INVALID_CODE/ALREADY_PAIRED, return {ok:true,request_id}) tidak berubah.
-- ---------------------------------------------------------------------------
create or replace function public.crew_request_pairing(
  p_restaurant_id uuid,
  p_full_name text,
  p_otp_hash text,
  p_otp_encrypted text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_id uuid;
begin
  if v_uid is null then raise exception 'UNAUTHORIZED'; end if;
  if p_full_name is null or p_full_name !~ '^[[:print:]]+$'
     or char_length(p_full_name) not between 1 and 40 then
    raise exception 'INVALID_NAME';
  end if;
  if p_otp_hash is null or p_otp_hash !~ '^[a-f0-9]{64}$'
     or p_otp_encrypted is null or p_otp_encrypted !~ '^4c494d4551523031[a-f0-9]+$' then
    raise exception 'INTERNAL';
  end if;
  if not exists (select 1 from public.restaurants where id = p_restaurant_id and is_active) then
    raise exception 'INVALID_CODE';
  end if;
  if exists (select 1 from public.crew_accounts where auth_uid = v_uid and status = 'aktif') then
    raise exception 'ALREADY_PAIRED';
  end if;
  select email into v_email from auth.users where id = v_uid;
  if v_email is null then raise exception 'UNAUTHORIZED'; end if;

  -- per-uid serialization: double-tapped requests cannot race the partial index
  perform pg_advisory_xact_lock(hashtext('crew_pairing'), hashtext(v_uid::text));

  -- throttle (G4): 5 request baru per uid per rolling jam. Dibaca DI BAWAH
  -- advisory lock yang sama sehingga spam paralel serialize dan semuanya
  -- melihat count yang benar. Pending yang hidup dibiarkan (tidak expire).
  if (
    select count(*) from public.crew_pairing_requests
    where auth_uid = v_uid and created_at > now() - interval '60 minutes'
  ) >= 5 then
    return jsonb_build_object('ok', false, 'error', 'PAIRING_THROTTLED');
  end if;

  update public.crew_pairing_requests
  set status = 'expired'
  where auth_uid = v_uid and status = 'pending';

  insert into public.crew_pairing_requests
    (auth_uid, restaurant_id, email, full_name, otp_hash, otp_encrypted, expires_at)
  values
    (v_uid, p_restaurant_id, v_email, p_full_name, p_otp_hash, p_otp_encrypted,
     now() + interval '15 minutes')
  returning id into v_id;
  return jsonb_build_object('ok', true, 'request_id', v_id);
end;
$$;
revoke all on function public.crew_request_pairing(uuid, text, text, text) from public, anon, service_role;
grant execute on function public.crew_request_pairing(uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- G2: get_crew_activity — 30 aksi crew terbaru resto milik manager bearer.
-- Auth/INVALID_SESSION identik get_crew_accounts. Hanya verdict 'ok' yang
-- ditampilkan (denial tidak pernah ditulis oleh RPC crew Poin 3, filter ini
-- penjaga bila suatu saat ditulis).
-- ---------------------------------------------------------------------------
create or replace function public.get_crew_activity(p_manager_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant uuid;
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

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'created_at', q.created_at,
      'action', q.action,
      'actor_label', q.actor_label,
      'crew_name', coalesce(ca.full_name, q.req_name, left(q.target_id::text, 8))
    ) order by q.created_at desc)
    from (
      select a.created_at, a.action, a.actor_label, a.target_id,
        (select pr.full_name from public.crew_pairing_requests pr
          where pr.auth_uid = a.target_id
          order by pr.created_at desc limit 1) as req_name
      from public.admin_audit_log a
      where a.restaurant_id = v_restaurant
        and a.action like 'crew.%'
        and a.result = 'ok'
      order by a.created_at desc
      limit 30
    ) q
    left join public.crew_accounts ca on ca.auth_uid = q.target_id
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.get_crew_activity(text) from public, anon, service_role;
grant execute on function public.get_crew_activity(text) to authenticated;
