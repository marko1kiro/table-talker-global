-- Poin 2: Staff identity & access control (Super Admin individual, Area
-- Manager, Manager). Forward-only. See docs/superpowers/specs/ for the
-- product decisions:
--  * One global, case-insensitive, permanent staff-ID namespace across
--    super_admin / area_manager / manager (staff_id_registry). IDs are
--    immutable and never reusable, even after deactivation.
--  * No public registration for Super Admin / AM / Manager. Manager
--    self-registration RPC (register_manager) is dropped here.
--  * AM–restaurant is many-to-many (area_manager_assignments).
--  * Manager password reset requests carry only a scrypt verifier hash —
--    never plaintext or anything an approver can read back.
--  * Append-only administrative audit log.
--  * No data is modified: this migration only adds tables/functions and
--    drops the self-registration RPC. Master data, QR tokens/batches,
--    audio manifests and Storage are untouched.

-- ---------------------------------------------------------------------------
-- 1. Global staff-ID registry (permanent, immutable, case-insensitive).
-- ---------------------------------------------------------------------------
create table public.staff_id_registry (
  staff_id text primary key check (staff_id ~ '^[a-z0-9._-]{3,32}$'),
  account_kind text not null check (account_kind in ('super_admin','area_manager','manager')),
  account_id uuid not null,
  claimed_at timestamptz not null default now()
);
alter table public.staff_id_registry enable row level security;
revoke all on public.staff_id_registry from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Individual Super Admin accounts. Bootstrap (shared-password era) is only
--    allowed to mint the FIRST account; see system_settings below.
-- ---------------------------------------------------------------------------
create table public.super_admin_accounts (
  id uuid primary key default gen_random_uuid(),
  staff_id text not null unique check (staff_id ~ '^[a-z0-9._-]{3,32}$'),
  full_name text not null check (length(trim(full_name)) between 1 and 80),
  email text not null check (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  email_verified_at timestamptz,
  password_hash text,
  -- When the CURRENT password was established (activation/recovery/change).
  -- Drives the password lifecycle reminder symmetrically with AM/Manager.
  password_changed_at timestamptz,
  status text not null default 'pending_activation'
    check (status in ('pending_activation','aktif','nonaktif','cancelled')),
  invitation_token_hash text,
  invitation_expires_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index super_admin_accounts_email_key
  on public.super_admin_accounts (lower(email))
  where status in ('pending_activation','aktif');
alter table public.super_admin_accounts enable row level security;
revoke all on public.super_admin_accounts from public, anon, authenticated;

-- Bootstrap gate: flipped false permanently once the first individual Super
-- Admin is activated. No UI/RPC may reopen it (only this one-way update path
-- in accept_super_admin_invite ever writes it).
create table public.system_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
insert into public.system_settings (key, value)
values ('super_admin_bootstrap', '{"open": true}'::jsonb)
on conflict (key) do nothing;
revoke all on public.system_settings from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Area Manager accounts + many-to-many restaurant assignments.
-- ---------------------------------------------------------------------------
create table public.area_manager_accounts (
  id uuid primary key default gen_random_uuid(),
  staff_id text not null unique check (staff_id ~ '^[a-z0-9._-]{3,32}$'),
  full_name text not null check (length(trim(full_name)) between 1 and 80),
  password_hash text not null,
  password_changed_at timestamptz,
  status text not null default 'aktif' check (status in ('aktif','nonaktif')),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.area_manager_accounts enable row level security;
revoke all on public.area_manager_accounts from public, anon, authenticated;

create table public.area_manager_assignments (
  id uuid primary key default gen_random_uuid(),
  area_manager_id uuid not null references public.area_manager_accounts(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  assigned_by uuid,
  assigned_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid
);
create unique index area_manager_assignments_active_pair_idx
  on public.area_manager_assignments (area_manager_id, restaurant_id)
  where removed_at is null;
create index area_manager_assignments_active_restaurant_idx
  on public.area_manager_assignments (restaurant_id)
  where removed_at is null;
create index area_manager_assignments_active_am_idx
  on public.area_manager_assignments (area_manager_id)
  where removed_at is null;
alter table public.area_manager_assignments enable row level security;
revoke all on public.area_manager_assignments from public, anon, authenticated;

-- Track whether a manager ever changed their initial password (first-login
-- reminder only; never blocks the dashboard).
alter table public.manager_accounts add column if not exists password_changed_at timestamptz;

-- ---------------------------------------------------------------------------
-- 4. Bearer sessions for individual Super Admins and Area Managers.
--    (Managers keep the existing manager_sessions bearer model.)
-- ---------------------------------------------------------------------------
create table public.staff_sessions (
  id uuid primary key default gen_random_uuid(),
  session_kind text not null check (session_kind in ('super_admin','area_manager')),
  account_id uuid not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index staff_sessions_account_idx on public.staff_sessions (session_kind, account_id);
alter table public.staff_sessions enable row level security;
revoke all on public.staff_sessions from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Password reset requests. Candidate password is stored ONLY as a scrypt
--    verifier hash ("salt:hash"), the same format as stored login hashes, so
--    no approver can read it back. First decision wins (atomic status flip).
-- ---------------------------------------------------------------------------
create table public.manager_reset_requests (
  id uuid primary key default gen_random_uuid(),
  manager_id uuid not null references public.manager_accounts(id) on delete cascade,
  candidate_hash text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid,
  decided_by_kind text check (decided_by_kind in ('area_manager') or decided_by_kind is null)
);
create unique index manager_reset_requests_one_pending_idx
  on public.manager_reset_requests (manager_id) where status = 'pending';
alter table public.manager_reset_requests enable row level security;
revoke all on public.manager_reset_requests from public, anon, authenticated;

create table public.am_reset_requests (
  id uuid primary key default gen_random_uuid(),
  area_manager_id uuid not null references public.area_manager_accounts(id) on delete cascade,
  candidate_hash text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid
);
create unique index am_reset_requests_one_pending_idx
  on public.am_reset_requests (area_manager_id) where status = 'pending';
alter table public.am_reset_requests enable row level security;
revoke all on public.am_reset_requests from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Super Admin self-recovery tokens (single-use, short-lived, hashed).
-- ---------------------------------------------------------------------------
create table public.super_admin_recovery_tokens (
  id uuid primary key default gen_random_uuid(),
  super_admin_id uuid not null references public.super_admin_accounts(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.super_admin_recovery_tokens enable row level security;
revoke all on public.super_admin_recovery_tokens from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Append-only administrative audit log. UPDATE/DELETE are revoked from
--    every role, including service_role (append-only by privilege).
-- ---------------------------------------------------------------------------
create table public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_kind text not null
    check (actor_kind in ('super_admin','area_manager','system','legacy_bootstrap')),
  actor_id uuid,
  actor_label text,
  action text not null,
  target_kind text,
  target_id uuid,
  restaurant_id uuid,
  result text not null default 'ok' check (result in ('ok','denied','failed')),
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index admin_audit_log_restaurant_idx on public.admin_audit_log (restaurant_id, created_at);
create index admin_audit_log_action_idx on public.admin_audit_log (action, created_at);
alter table public.admin_audit_log enable row level security;
revoke all on public.admin_audit_log from public, anon, authenticated;
revoke update, delete on public.admin_audit_log from service_role;

-- ---------------------------------------------------------------------------
-- 8. Kill Manager self-registration. register_manager is the Kode-Resto
--    self-signup RPC; it is no longer reachable from any trusted server fn
--    after the route/server-fn removal in this change. Kode Resto itself and
--    loginToRestaurant (crew flow) are untouched.
-- ---------------------------------------------------------------------------
drop function if exists public.register_manager(text, text, text, text);
