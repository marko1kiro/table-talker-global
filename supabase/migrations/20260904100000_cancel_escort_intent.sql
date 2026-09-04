-- Let any Satgas cancel an unresolved escort intent at their restaurant, so an
-- orphaned intent (creating session gone) no longer locks a table yellow.
-- Marks resolved (audit preserved); occupancy status is untouched. Broadcasts a
-- kind-less invalidate so every crew grid drops the yellow on refetch, with no
-- toast (a cancel is not a table status change).

create or replace function public.cancel_escort_intent(
  p_intent_id uuid,
  p_session_token text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session record;
  v_intent record;
  v_revision bigint;
begin
  select rst.* into v_session
  from public.role_session_tokens rst
  join public.restaurants r on r.id = rst.restaurant_id
  where rst.token_hash = encode(extensions.digest(p_session_token, 'sha256'), 'hex')
    and rst.role = 'satgas'
    and rst.expires_at > now()
    and r.is_active
    and rst.code_version = r.code_version;
  if v_session is null then raise exception 'INVALID_SESSION'; end if;

  select * into v_intent
  from public.table_escort_intents
  where id = p_intent_id
    and restaurant_id = v_session.restaurant_id
    and resolved = false;
  if v_intent is null then return false; end if;

  update public.table_escort_intents
  set resolved = true
  where id = v_intent.id;

  v_revision := public.bump_table_occupancy_revision(v_intent.restaurant_id);
  perform realtime.send(
    jsonb_build_object('table_number', v_intent.table_number, 'revision', v_revision),
    'invalidate',
    'table-occupancy:' || v_intent.restaurant_id::text,
    true
  );
  return true;
end;
$$;

revoke all on function public.cancel_escort_intent(uuid, text) from public, anon, service_role;
grant execute on function public.cancel_escort_intent(uuid, text) to authenticated;
