-- M-01 remediation: reject a NULL token array before persisting an empty batch.
create or replace function public.commit_qr_export_batch(
  p_batch_id uuid,
  p_restaurant_id uuid,
  p_created_by text,
  p_domain_used text,
  p_scope text,
  p_table_numbers integer[],
  p_tokens text[],
  p_r2_key_xlsx text,
  p_r2_key_csv text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if p_scope not in ('all', 'selected')
     or p_created_by is null or char_length(p_created_by) not between 1 and 120
     or p_domain_used !~ '^https?://'
     or coalesce(cardinality(p_table_numbers), 0) not between 1 and 100
     or coalesce(cardinality(p_tokens), 0) <> cardinality(p_table_numbers)
     or p_r2_key_xlsx is null or p_r2_key_csv is null then
    raise exception 'INVALID_QR_BATCH';
  end if;

  select count(*) into v_count
  from (select distinct n from unnest(p_table_numbers) n where n between 1 and 100) valid;
  if v_count <> cardinality(p_table_numbers)
     or exists (select 1 from unnest(p_tokens) t where t !~ '^[A-Za-z0-9_-]{43}$') then
    raise exception 'INVALID_QR_BATCH';
  end if;

  if not exists (
    select 1 from public.restaurants r
    where r.id = p_restaurant_id and r.is_active
  ) then
    raise exception 'RESTAURANT_NOT_ACTIVE';
  end if;

  insert into public.qr_export_batches (
    id, restaurant_id, created_by, domain_used, scope, table_numbers,
    r2_key_xlsx, r2_key_csv
  ) values (
    p_batch_id, p_restaurant_id, p_created_by, p_domain_used, p_scope,
    p_table_numbers, p_r2_key_xlsx, p_r2_key_csv
  );

  update public.qr_table_tokens
  set revoked_at = now()
  where restaurant_id = p_restaurant_id
    and table_number = any(p_table_numbers)
    and revoked_at is null;

  insert into public.qr_table_tokens (
    restaurant_id, table_number, token, batch_id
  )
  select p_restaurant_id, selected.table_number, selected.token, p_batch_id
  from unnest(p_table_numbers, p_tokens) as selected(table_number, token);
end;
$$;
