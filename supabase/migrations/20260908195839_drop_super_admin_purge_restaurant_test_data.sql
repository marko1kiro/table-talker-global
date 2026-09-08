-- Remove the super-admin bulk purge capability entirely (product decision:
-- the feature is not needed; the RPC is destructive and was executable by
-- any authenticated role directly, bypassing the application-side Super
-- Admin check). Forward-only and idempotent: safe whether or not the
-- function still exists. No data is modified — only privileges are revoked
-- and the function is dropped. Master data (restaurants, manager accounts),
-- QR files/tokens, audio manifests/catalogs/files, and all other schema are
-- untouched.

do $$
begin
  if to_regprocedure('public.super_admin_purge_restaurant_test_data(uuid)') is not null then
    execute 'revoke all on function public.super_admin_purge_restaurant_test_data(uuid) from public, anon, authenticated, service_role';
  end if;
end;
$$;

drop function if exists public.super_admin_purge_restaurant_test_data(uuid);
