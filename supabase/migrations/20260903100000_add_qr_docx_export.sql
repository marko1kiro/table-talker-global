-- Server-side DOCX QR artifact; replaces the dynamic CSV in the generate flow.
-- Additive: r2_key_csv is kept for pre-existing batches (never dropped).

alter table public.qr_export_batches add column if not exists r2_key_docx text;

create or replace function public.commit_qr_export_batch(
  p_batch_id uuid,
  p_restaurant_id uuid,
  p_created_by text,
  p_domain_used text,
  p_scope text,
  p_table_numbers integer[],
  p_tokens text[],
  p_r2_key_xlsx text,
  p_r2_key_docx text
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
     or p_r2_key_xlsx is null or p_r2_key_docx is null then
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
    r2_key_xlsx, r2_key_docx
  ) values (
    p_batch_id, p_restaurant_id, p_created_by, p_domain_used, p_scope,
    p_table_numbers, p_r2_key_xlsx, p_r2_key_docx
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

create or replace function public.get_qr_export_key(
  p_batch_id uuid,
  p_format text
)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select case p_format
    when 'xlsx' then b.r2_key_xlsx
    when 'csv' then b.r2_key_csv
    when 'docx' then b.r2_key_docx
  end
  from public.qr_export_batches b
  where b.id = p_batch_id and p_format in ('xlsx', 'csv', 'docx');
$$;

revoke all on function public.commit_qr_export_batch(uuid, uuid, text, text, text, integer[], text[], text, text) from public, anon, authenticated;
revoke all on function public.get_qr_export_key(uuid, text) from public, anon, authenticated;
grant execute on function public.commit_qr_export_batch(uuid, uuid, text, text, text, integer[], text[], text, text) to service_role;
grant execute on function public.get_qr_export_key(uuid, text) to service_role;
