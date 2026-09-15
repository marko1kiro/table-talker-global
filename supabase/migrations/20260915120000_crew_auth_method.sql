-- Poin 6.1: login password crew. ADDITIVE ONLY — nol drop/alter objek apa pun.
-- 1) crew_auth_method: verdict 'password' vs 'otp' (dieksekusi lewat service-role
--    server fn saja; nilai 'otp' juga menutup kasus "email belum ada" supaya
--    enumeration tetap kabur).
-- 2) crew_auth_method_limits + reserve_crew_auth_method: kuota burst 50 lookup /
--    window 15 menit per IP-hash, blokir 15 menit. (lookup_rate_limits existing
--    TIDAK dipakai: semantiknya 'kegagalan' milik fitur lain dan ambang 5/15mnt
--    akan mengunci satu resto lewat NAT saat pergantian shift.)

CREATE TABLE IF NOT EXISTS public.crew_auth_method_limits (
  ip_hash text PRIMARY KEY,
  calls integer NOT NULL DEFAULT 0 CHECK (calls >= 0),
  window_started_at timestamptz NOT NULL DEFAULT now(),
  blocked_until timestamptz
);

ALTER TABLE public.crew_auth_method_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crew_auth_method_limits FROM public, anon, authenticated;
GRANT ALL ON public.crew_auth_method_limits TO service_role;

CREATE OR REPLACE FUNCTION public.reserve_crew_auth_method(p_ip_hash text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_blocked timestamptz;
BEGIN
  INSERT INTO public.crew_auth_method_limits AS l
    (ip_hash, calls, window_started_at, blocked_until)
  VALUES (p_ip_hash, 1, now(), NULL)
  ON CONFLICT (ip_hash) DO UPDATE SET
    calls = CASE
      WHEN l.window_started_at <= now() - interval '15 minutes' THEN 1
      ELSE l.calls + 1
    END,
    window_started_at = CASE
      WHEN l.window_started_at <= now() - interval '15 minutes' THEN now()
      ELSE l.window_started_at
    END,
    blocked_until = CASE
      WHEN l.blocked_until > now() THEN l.blocked_until
      WHEN l.window_started_at > now() - interval '15 minutes' AND l.calls + 1 > 50
        THEN now() + interval '15 minutes'
      ELSE NULL
    END
  RETURNING l.blocked_until INTO v_blocked;
  RETURN v_blocked IS NULL OR v_blocked <= now();
END;
$$;

CREATE OR REPLACE FUNCTION public.crew_auth_method(p_email text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM auth.users u
    WHERE lower(btrim(u.email)) = lower(btrim(p_email))
      AND coalesce(u.encrypted_password, '') <> ''
  ) THEN 'password' ELSE 'otp' END;
$$;

REVOKE ALL ON FUNCTION public.reserve_crew_auth_method(text), public.crew_auth_method(text)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_crew_auth_method(text), public.crew_auth_method(text) TO service_role;
