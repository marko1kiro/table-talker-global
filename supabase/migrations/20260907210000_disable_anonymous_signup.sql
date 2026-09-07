-- Disable anonymous signup in production.
-- Adds a config flag that client checks before signInAnonymously().

CREATE TABLE IF NOT EXISTS public.system_config (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.system_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.system_config FROM public, anon, authenticated;
GRANT ALL ON public.system_config TO service_role;

-- Set anonymous signup as disabled by default
INSERT INTO public.system_config (key, value) VALUES ('anonymous_signup_enabled', 'false')
ON CONFLICT (key) DO NOTHING;

-- RPC for client to check (read-only, no auth needed)
CREATE OR REPLACE FUNCTION public.is_anonymous_signup_enabled()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT value::boolean FROM public.system_config WHERE key = 'anonymous_signup_enabled'),
    false
  );
$$;

-- RPC for admin to toggle
CREATE OR REPLACE FUNCTION public.set_anonymous_signup_enabled(p_enabled boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.system_config (key, value) VALUES ('anonymous_signup_enabled', p_enabled::text)
  ON CONFLICT (key) DO UPDATE SET value = p_enabled::text, updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.is_anonymous_signup_enabled(), public.set_anonymous_signup_enabled(boolean) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_anonymous_signup_enabled() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_anonymous_signup_enabled(boolean) TO service_role;
