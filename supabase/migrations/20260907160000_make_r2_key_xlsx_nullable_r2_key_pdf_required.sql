alter table public.qr_export_batches
  alter column r2_key_xlsx drop not null;

update public.qr_export_batches set r2_key_pdf = '' where r2_key_pdf is null;
alter table public.qr_export_batches
  alter column r2_key_pdf set not null;

create or replace function public.commit_qr_export_batch(
  p_batch_id uuid,
  p_restaurant_id uuid,
  p_created_by text,
  p_domain_used text,
  p_scope text,
  p_table_numbers integer[],
  p_tokens text[],
  p_r2_key_pdf text,
  p_r2_key_docx text default null,
  p_r2_key_xlsx text default null
) returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if p_batch_id is null or p_restaurant_id is null
     or p_created_by is null or p_domain_used is null
     or p_scope is null or p_table_numbers is null
     or p_tokens is null or p_r2_key_pdf is null then
    raise exception 'All required parameters must be non-null';
  end if;
  if array_length(p_table_numbers, 1) is null
     or array_length(p_tokens, 1) is null
     or array_length(p_table_numbers, 1) <> array_length(p_tokens, 1) then
    raise exception 'table_numbers and tokens must be equal-length non-empty arrays';
  end if;

  insert into public.qr_export_batches (
    id, restaurant_id, created_by, domain_used, scope,
    table_numbers, r2_key_pdf, r2_key_docx, r2_key_xlsx
  ) values (
    p_batch_id, p_restaurant_id, p_created_by, p_domain_used, p_scope,
    p_table_numbers, p_r2_key_pdf, p_r2_key_docx, p_r2_key_xlsx
  );

  insert into public.qr_table_tokens (batch_id, restaurant_id, table_number, token)
  select p_batch_id, p_restaurant_id, p_table_numbers[i], p_tokens[i]
  from generate_series(1, array_length(p_tokens, 1)) as i;
end;
$$;
