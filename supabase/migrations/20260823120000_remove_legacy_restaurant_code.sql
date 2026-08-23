do $$
begin
  if exists (
    select 1 from public.restaurants
    where code_hash is null or code_encrypted is null or credential_rotated_at is null
  ) then
    raise exception 'UNPROVISIONED_RESTAURANT_CREDENTIALS';
  end if;
end;
$$;

delete from public.restaurant_access_tokens;
delete from public.crew_session_tokens;

drop index if exists public.restaurants_code_key;
alter table public.restaurants drop column if exists pin_hash;
alter table public.restaurants drop column code;
alter table public.restaurants alter column code_hash set not null;
alter table public.restaurants alter column code_encrypted set not null;
alter table public.restaurants alter column credential_rotated_at set not null;
