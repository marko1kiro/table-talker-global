-- Test-only Supabase environment shim for vanilla Postgres (embedded or CI
-- service container). Provides the minimal supabase-specific objects the
-- migration chain references: roles, pgcrypto in `extensions`, the `auth`
-- schema (users + uid()), the `realtime` schema (messages + topic()), and the
-- supabase_realtime publication. NO production data, NO secrets.

-- Roles are CLUSTER-global while each parallel test worker only owns its own
-- DATABASE, so a check-then-create here is a race: on a shared cluster (the CI
-- postgres service) two workers can both pass the `not exists` probe and then
-- both issue `create role`. The loser fails the whole shim — and therefore
-- `createTestDb` — with either duplicate_object (42710) or, when it lost the
-- index insert to a transaction that committed while it waited, a raw
-- unique_violation (23505) on pg_authid_rolname_index. Both codes must be
-- absorbed; catching only duplicate_object still breaks under the real race.
--
-- Each role gets its OWN block on purpose: a caught exception rolls its block
-- back, so grouping all three would let a collision on `anon` silently skip
-- `authenticated` and `service_role`.
do $$
begin
  create role anon nologin;
exception when duplicate_object or unique_violation then
  null;
end $$;

do $$
begin
  create role authenticated nologin;
exception when duplicate_object or unique_violation then
  null;
end $$;

do $$
begin
  create role service_role nologin;
exception when duplicate_object or unique_violation then
  null;
end $$;

-- The handlers above may only ever absorb a CONCURRENT creation, never a real
-- failure to create. Anything else must still fail loudly and early, before the
-- migration chain starts issuing grants against roles that do not exist.
do $$
declare
  v_missing text;
begin
  select string_agg(r, ', ' order by r) into v_missing
  from unnest(array['anon', 'authenticated', 'service_role']) as r
  where not exists (select 1 from pg_roles where rolname = r);
  if v_missing is not null then
    raise exception 'supabase shim: role(s) missing after create: %', v_missing;
  end if;
end $$;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  encrypted_password text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create or replace function auth.uid() returns uuid language sql stable as $$
  -- PostgREST sets the full claims JSON (request.jwt.claims); Supabase Auth
  -- also sets the per-claim GUC (request.jwt.claim.sub). Read both, like the
  -- real Supabase auth.uid().
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid
$$;

create schema if not exists realtime;
create table if not exists realtime.messages (
  id uuid primary key default gen_random_uuid(),
  topic text not null,
  extension text not null default 'broadcast',
  payload jsonb,
  inserted_at timestamptz not null default now()
);
alter table realtime.messages enable row level security;
grant usage on schema realtime to anon, authenticated;
grant usage on schema auth to anon, authenticated;
grant usage on schema extensions to anon, authenticated, service_role;
create or replace function realtime.topic() returns text language sql stable as $$
  select coalesce(nullif(current_setting('realtime.topic', true), ''), '')
$$;
grant select on realtime.messages to authenticated;

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;
