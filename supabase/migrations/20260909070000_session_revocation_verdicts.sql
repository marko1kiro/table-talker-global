-- R6-B: explicit, atomic, fail-closed revocation verdicts.
-- The boolean RPCs from 20260909050000 conflated three unrelated outcomes
-- under `false`: an authoritative already-inactive token, a never-issued
-- (junk) token, and a token that lives in a DIFFERENT namespace (kind
-- mismatch). Mandatory role switches must proceed only on REVOKED or on an
-- AUTHORITATIVELY proven ALREADY_INACTIVE; junk/mismatch/error must abort the
-- switch. This migration:
--   1. adds hashed revocation tombstones (never the raw token) so
--      "revoked earlier" is provable and distinct from "never existed";
--   2. replaces both by-token revocation RPCs with structured jsonb verdicts:
--      REVOKED | ALREADY_INACTIVE | KIND_MISMATCH | UNKNOWN_TOKEN.
-- The verdict is computed and applied in ONE atomic transaction (no
-- probe-then-revoke). Forward-only; no session data is migrated.

create table if not exists public.revoked_session_tombstones (
  id bigint generated always as identity primary key,
  namespace text not null check (namespace in ('super_admin', 'area_manager', 'manager')),
  token_hash text not null,
  revoked_at timestamptz not null default now(),
  unique (namespace, token_hash)
);
create index if not exists revoked_session_tombstones_token_idx
  on public.revoked_session_tombstones (token_hash);
alter table public.revoked_session_tombstones enable row level security;
revoke all on public.revoked_session_tombstones from public, anon, authenticated;

-- Manager namespace -------------------------------------------------------
-- The old boolean signatures must be dropped before the jsonb replacements:
-- CREATE OR REPLACE cannot change a function's return type.
drop function if exists public.revoke_manager_session_by_token(text);
create function public.revoke_manager_session_by_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text := encode(extensions.digest(p_token, 'sha256'), 'hex');
begin
  delete from public.manager_sessions
  where token_hash = v_hash;
  if found then
    begin
      insert into public.revoked_session_tombstones (namespace, token_hash)
      values ('manager', v_hash);
    exception when unique_violation then
      -- A concurrent transaction of the SAME token inserted the tombstone
      -- first; its commit proves the token was revoked moments ago.
      null;
    end;
    return jsonb_build_object('verdict', 'REVOKED');
  end if;

  if exists (
    select 1 from public.revoked_session_tombstones
    where namespace = 'manager' and token_hash = v_hash
  ) then
    return jsonb_build_object('verdict', 'ALREADY_INACTIVE');
  end if;

  if exists (select 1 from public.staff_sessions where token_hash = v_hash) then
    return jsonb_build_object('verdict', 'KIND_MISMATCH');
  end if;

  return jsonb_build_object('verdict', 'UNKNOWN_TOKEN');
end;
$$;
revoke all on function public.revoke_manager_session_by_token(text) from public, anon, authenticated;
grant execute on function public.revoke_manager_session_by_token(text) to service_role;

-- Staff namespaces (super_admin / area_manager) ----------------------------
drop function if exists public.revoke_staff_session_by_token(text, text);
create function public.revoke_staff_session_by_token(p_kind text, p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text := encode(extensions.digest(p_token, 'sha256'), 'hex');
begin
  if p_kind not in ('super_admin', 'area_manager') then
    return jsonb_build_object('verdict', 'UNKNOWN_TOKEN');
  end if;

  delete from public.staff_sessions
  where session_kind = p_kind and token_hash = v_hash;
  if found then
    begin
      insert into public.revoked_session_tombstones (namespace, token_hash)
      values (p_kind, v_hash);
    exception when unique_violation then
      null;
    end;
    return jsonb_build_object('verdict', 'REVOKED');
  end if;

  if exists (
    select 1 from public.revoked_session_tombstones
    where namespace = p_kind and token_hash = v_hash
  ) then
    return jsonb_build_object('verdict', 'ALREADY_INACTIVE');
  end if;

  if exists (
    select 1 from public.staff_sessions where token_hash = v_hash
  ) or exists (
    select 1 from public.manager_sessions where token_hash = v_hash
  ) then
    return jsonb_build_object('verdict', 'KIND_MISMATCH');
  end if;

  return jsonb_build_object('verdict', 'UNKNOWN_TOKEN');
end;
$$;
revoke all on function public.revoke_staff_session_by_token(text, text) from public, anon, authenticated;
grant execute on function public.revoke_staff_session_by_token(text, text) to service_role;
