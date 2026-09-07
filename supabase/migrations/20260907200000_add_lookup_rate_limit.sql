-- Rate limit for Kode Resto lookup (login_to_restaurant_atomic).
-- 5 failures per 15 minutes per IP hash. Blocks for 15 minutes.

CREATE TABLE IF NOT EXISTS public.lookup_rate_limits (
  ip_hash text NOT NULL,
  failures integer NOT NULL DEFAULT 0 CHECK (failures >= 0),
  window_started_at timestamptz NOT NULL DEFAULT now(),
  blocked_until timestamptz,
  PRIMARY KEY (ip_hash)
);

ALTER TABLE public.lookup_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lookup_rate_limits FROM public, anon, authenticated;
GRANT ALL ON public.lookup_rate_limits TO service_role;

CREATE OR REPLACE FUNCTION public.check_lookup_rate_limit(p_ip_hash text)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT blocked_until > now() FROM public.lookup_rate_limits WHERE ip_hash = p_ip_hash),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.record_lookup_failure(p_ip_hash text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.lookup_rate_limits (ip_hash, failures, window_started_at, blocked_until)
  VALUES (p_ip_hash, 1, now(), null)
  ON CONFLICT (ip_hash) DO UPDATE SET
    failures = CASE
      WHEN lookup_rate_limits.window_started_at <= now() - interval '15 minutes' THEN 1
      ELSE lookup_rate_limits.failures + 1
    END,
    window_started_at = CASE
      WHEN lookup_rate_limits.window_started_at <= now() - interval '15 minutes' THEN now()
      ELSE lookup_rate_limits.window_started_at
    END,
    blocked_until = CASE
      WHEN lookup_rate_limits.window_started_at > now() - interval '15 minutes'
        AND lookup_rate_limits.failures + 1 >= 5
      THEN now() + interval '15 minutes'
      ELSE null
    END;
END;
$$;

CREATE OR REPLACE FUNCTION public.clear_lookup_failures(p_ip_hash text)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.lookup_rate_limits WHERE ip_hash = p_ip_hash;
$$;

REVOKE ALL ON FUNCTION public.check_lookup_rate_limit(text), public.record_lookup_failure(text), public.clear_lookup_failures(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_lookup_rate_limit(text), public.record_lookup_failure(text), public.clear_lookup_failures(text) TO service_role;
