-- TOMBSTONE (no-op): the restaurant test-data purge feature was cancelled by
-- product decision before this migration ever reached the production target
-- (project ref kjzxtmxdbcanvkgqqdow). The originally planned purge RPC body
-- (destructive, SECURITY DEFINER) must never run: executing it after the
-- final drop migration would resurrect the purge RPC. All DDL/DML from the
-- original file has been removed; the filename/version is kept only to
-- preserve migration history order. The final cleanup (defensive privilege
-- revocation + DROP FUNCTION) is performed by the next migration:
-- 20260909000000_drop_super_admin_purge_restaurant_test_data.sql.

do $$
begin
  null;
end;
$$;
