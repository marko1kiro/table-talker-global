# Manager Monitoring Dashboard — Design Spec

Date: 2026-09-04
Status: Approved (pending user review of this written spec)

## Problem / goal

Each restaurant needs a **MANAGER** (pimpinan shift) who can monitor the live
state of the floor and the crew flow, scoped to **their own restaurant only**
(isolated per-resto). Today the system has only two auth paths:

- **Crew** (`ss` / `kasir` / `satgas` / `clear_up`): login with restaurant Code +
  PIN + role, bearer `role_session_tokens`, operational stations.
- **Super-admin**: password (`AUTH_SECRET`), sees **all** restaurants (console).

There is **no per-restaurant manager** and no manager credential anywhere. This
spec adds a MANAGER role with self-registration and a monitoring dashboard.

## Decisions (locked with user)

1. **Manager = separate credential, not a 5th crew role.** Login uses
   `ID Manager` + `Password` (NOT Code+PIN+role). The `MANAGER` button lives on
   the role-select page but is **separated at the top**, visually distinct from
   the Crew area.
2. **Self-registration, no activation gate (temporary).** A manager creates
   their own account. New accounts are `status = 'aktif'` immediately. The
   activation/approval flow (by an "Area Manager" above Store Manager) is
   **deferred** — but a `status` column exists now so it drops in later without
   a schema change.
3. **Register → redirect to Login, never straight to Dashboard.** After Submit
   the user lands on the Manager login page to enter credentials (professional
   flow).
4. **Super-admin panel (this iteration): list managers + Nonaktifkan only.** No
   Enable button yet (re-enable waits for the future activation system).
   Disabling a manager **revokes their live session** (forced logout).
5. **Dashboard = responsive sidebar** (all screen sizes) with 3 menus; footer =
   restaurant name + `lihatmeja.com (c)2026` + `XDIRGA LABS`. Header is the
   **same `CrewHeader`** as other crew (incl. the live occupancy toast ticker).
6. **LOG AKTIVITAS = Option X (toast history, no names, session-scoped).** No
   new audit table. The log is the accumulated live occupancy notices received
   while the dashboard is open. Chosen because the header already forces a
   manager realtime subscription, so the log rides on it for free.
7. **Reminder = only tables occupied > 2 hours.** Below 2h shows nothing. Text
   is a single line, no counter.

## Accepted risk (temporary, user-approved)

Open self-registration means **anyone who knows a restaurant Code can register a
manager account for that restaurant** and read its dashboard. Accepted for now;
the future Area-Manager activation gate is the mitigation. Passwords are hashed
(scrypt). Manager reads are hard-scoped to the account's `restaurant_id`.

## Architecture

Mirror the crew bearer-token pattern (no new cookie). Manager identity + token
live in `sessionStorage` (like `readRoleSessionIdentity`); every manager read is
a `security definer` RPC that validates the manager token and scopes to that
manager's restaurant. Realtime reuses the existing private channel by adding a
manager binding path + extending the RLS predicate.

```
role-select page
  [ MANAGER ]  (separated, top)
    -> /manager/login   (ID Manager + Password + "KLIK DISINI ... ID MANAGER BARU")
         loginManager(id, password) -> verify scrypt -> issue manager token
         -> store manager identity in sessionStorage -> open /manager
    -> /manager/register (Nama, ID Manager, Kode Resto -> auto nama resto,
                          Password, Ulang) -> submit -> status=aktif
         -> redirect /manager/login

/manager (requireManager client guard)
  CrewHeader (reuse) + live toast ticker (reuse useTableOccupancyRealtime)
  Sidebar: LIHAT STATUS MEJA LIVE | LIHAT CREW AKTIF | LOG AKTIVITAS CREW
  Footer: MIE GACOAN {code} / lihatmeja.com (c)2026 / XDIRGA LABS

  LIHAT STATUS MEJA LIVE
    get_manager_snapshot(token) -> TableOccupancyRow[]
    list, 2 columns, text color = status (HIJAU kosong / MERAH terisi)
    reminder slot (client): rows where now - occupied_at > 2h
      "MEJA {n} | >{formatDuration} | PERLU DI CEK"  (rotate 7s if >1)
      disappears automatically when the table turns green (realtime refetch)

  LIHAT CREW AKTIF
    get_manager_active_crew(token) -> grouped by role
      table: nama crew | Jam Masuk (HH:MM:SS WIB)

  LOG AKTIVITAS CREW
    accumulate onNotice broadcasts (Option X), newest first, no names, capped
```

## Data model

### NEW migration `supabase/migrations/20260904110000_manager_accounts.sql`

```sql
create table public.manager_accounts (
  id uuid primary key default gen_random_uuid(),
  id_manager text not null,
  password_hash text not null,          -- "saltHex:hashHex" (node:crypto scrypt)
  full_name text not null,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  status text not null default 'aktif'
    check (status in ('aktif','nonaktif')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index manager_accounts_id_manager_key on public.manager_accounts (id_manager);
create index manager_accounts_restaurant_idx on public.manager_accounts (restaurant_id);
alter table public.manager_accounts enable row level security;
revoke all on public.manager_accounts from public, anon, authenticated;
-- no direct client access; all reads/writes go through security-definer RPCs.

create table public.manager_sessions (
  id uuid primary key default gen_random_uuid(),
  manager_id uuid not null references public.manager_accounts(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  token_hash text not null unique,       -- sha256 hex of the bearer token
  auth_user_id uuid default auth.uid()
    references auth.users(id) on delete cascade,   -- lazy realtime binding
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index manager_sessions_token_idx on public.manager_sessions (token_hash);
create index manager_sessions_auth_restaurant_idx
  on public.manager_sessions (auth_user_id, restaurant_id)
  where auth_user_id is not null;
alter table public.manager_sessions enable row level security;
revoke all on public.manager_sessions from public, anon, authenticated;
```

Notes: `manager_sessions` is the manager analogue of `role_session_tokens`
(bearer token + lazy `auth_user_id` realtime binding). Password hashing is done
in the Node server function with `node:crypto` **scrypt** (no new dependency);
the DB only ever stores the resulting hash. Session TTL mirrors crew.

### NEW migration `supabase/migrations/20260904111000_manager_realtime_binding.sql`

Extend the existing broadcast reader to admit managers, and add a manager bind
RPC. Reuses the same private channel `table-occupancy:{restaurantId}`.

```sql
-- Manager binds its anon auth identity to its session before subscribing.
create or replace function public.bind_manager_session_realtime(
  p_restaurant_id uuid,
  p_manager_token text
)
returns boolean
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_auth uuid := auth.uid(); v_bound boolean := false;
begin
  if v_auth is null then raise exception 'UNAUTHORIZED'; end if;
  update public.manager_sessions ms
  set auth_user_id = v_auth
  from public.manager_accounts ma, public.restaurants r
  where ms.token_hash = encode(extensions.digest(p_manager_token,'sha256'),'hex')
    and ms.manager_id = ma.id and ma.status = 'aktif'
    and ms.restaurant_id = p_restaurant_id and r.id = ms.restaurant_id and r.is_active
    and ms.expires_at > now()
    and (ms.auth_user_id is null or ms.auth_user_id = v_auth)
  returning true into v_bound;
  if not v_bound then raise exception 'INVALID_SESSION'; end if;
  return true;
end; $$;
revoke all on function public.bind_manager_session_realtime(uuid,text) from public, anon, service_role;
grant execute on function public.bind_manager_session_realtime(uuid,text) to authenticated;

-- OR-branch: a manager with an active, unexpired session may read its topic.
create or replace function public.can_read_table_occupancy_broadcast(p_topic text)
returns boolean language sql stable security definer set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.role_session_tokens rst
    join public.restaurants r on r.id = rst.restaurant_id
    where rst.auth_user_id = auth.uid()
      and rst.role in ('kasir','satgas','clear_up')
      and rst.expires_at > now() and r.is_active and rst.code_version = r.code_version
      and p_topic = 'table-occupancy:' || rst.restaurant_id::text
  ) or exists (
    select 1 from public.manager_sessions ms
    join public.manager_accounts ma on ma.id = ms.manager_id
    join public.restaurants r on r.id = ms.restaurant_id
    where ms.auth_user_id = auth.uid()
      and ma.status = 'aktif' and ms.expires_at > now() and r.is_active
      and p_topic = 'table-occupancy:' || ms.restaurant_id::text
  );
$$;
-- ACL unchanged (authenticated only).
```

The existing RLS SELECT policy on `realtime.messages` already calls this
function, so no policy change is needed — only the function body is extended.

## Manager-scoped read RPCs

### NEW migration `supabase/migrations/20260904112000_manager_reads.sql`

All validate the manager token, resolve `restaurant_id` **from the session**
(never from a client-supplied restaurant), and require `status='aktif'`.

- `get_manager_snapshot(p_manager_token text)` → returns the same rows as
  `get_table_occupancy_snapshot_versioned` (reuse its body) for the manager's
  restaurant. Client renders the live table list + computes the >2h reminder.
- `get_manager_active_crew(p_manager_token text)` → returns
  `(role, display_name, checked_in_at)` for crew whose `role_session_tokens`
  are unexpired at that restaurant. "Aktif" = has a valid (non-expired) token;
  `crew_role_sessions` has no logout column, so validity is the definition.

### Auth / register / disable RPCs

- `register_manager(p_id_manager, p_full_name, p_restaurant_code, p_password_hash)`
  → validates code resolves to an active restaurant + `id_manager` unused →
  insert `manager_accounts(status='aktif')`. Password hashing happens in the
  server fn; the RPC stores the passed hash. Returns boolean.
- `login_manager(p_id_manager, p_password_hash_check)` — **preferred**: the
  server fn reads the stored hash via a `get_manager_credential(p_id_manager)`
  RPC (returns `password_hash`, `restaurant_id`, `status`), verifies scrypt in
  Node, then `create_manager_session(p_manager_id)` returns a fresh token +
  expiry. Only `aktif` accounts may log in.
- `disable_manager(p_manager_id)` — **super-admin only** (validated via the
  existing super-admin path, `auth.jwt()` role claim / `requireSuperAdmin`
  server context): set `status='nonaktif'` and `delete from manager_sessions
  where manager_id = ...` (revokes live sessions + realtime).
- `list_managers()` — **super-admin only**: returns manager accounts joined with
  restaurant display name + code + status + created_at, for the audit panel.

## Components & file changes

### 1. Role-select page (crew login entry)
- Add a **`MANAGER` button separated at the top** of the page, above the Crew
  role area, routing to `/manager/login`. Crew area unchanged.

### 2. NEW `src/routes/manager/login.tsx`
- Fields: `ID Manager`, `Password`, `[Login]`, and a link
  **"KLIK DISINI untuk membuat ID MANAGER BARU"** → `/manager/register`.
- On success: store manager identity (`{ idManager, restaurantId, restaurantName,
  token }`) in `sessionStorage` (new `readManagerIdentity`/`writeManagerIdentity`
  helpers in `src/lib/manager-session-identity.ts`, mirroring
  `crew-session-identity.ts`), navigate to `/manager`.

### 3. NEW `src/routes/manager/register.tsx`
- Fields: `Nama Lengkap`, `ID Manager`, `Kode Resto` (on valid code, auto-show
  `Nama Resto` below via the existing code→identity resolve used by crew login),
  `Password`, `Ketik Ulang Password`, `[Submit]`.
- Client validation: all required; `id_manager` 3–32 chars `[a-z0-9._-]`
  (lowercased/trimmed); password ≥ 8 and matches confirm; resto resolves.
- On submit: hash password (scrypt) in the server fn, call `register_manager`,
  then **redirect to `/manager/login`** (never to the dashboard).

### 4. NEW `src/lib/manager-auth.server.ts` (server fns)
- `registerManager`, `loginManager`, `getManagerCredential`, `createManagerSession`
  wrappers. Password hashing/verify with `node:crypto` `scrypt` +
  `timingSafeEqual`; format `saltHex:hashHex`. No new npm dependency.

### 5. NEW `src/routes/manager/index.tsx` (dashboard shell)
- `requireManager()` client guard: no valid manager identity in sessionStorage →
  redirect `/manager/login`.
- Layout: responsive **Sidebar** (3 menus) + content area + **Footer**
  (`MIE GACOAN {code}`, `lihatmeja.com (c)2026`, `XDIRGA LABS`).
- Header = reuse `CrewHeader` (role pill = MANAGER) + live toast ticker.
- Sub-views (single route, tab state, or nested routes — pinned in plan):
  - **LIHAT STATUS MEJA LIVE**: `get_manager_snapshot` → 2-column list, text
    color = status; legend "INFO WARNA" like crew; reminder slot (see below).
    Reuse `buildOccupiedQueue`/`formatDuration` from `src/lib/clear-up-queue.ts`
    filtered to `durationMs > 2h`; a local 1s tick recomputes ages, a 7s tick
    rotates when >1 line. **No network on the ticks.**
  - **LIHAT CREW AKTIF**: `get_manager_active_crew` → grouped by station
    (SELF SERVICE / SATGAS / KASIR / CLEAR UP), simple table `nama | HH:MM:SS WIB`.
  - **LOG AKTIVITAS CREW**: accumulate `onNotice` broadcasts (reuse
    `createNoticeQueue`/`useNoticeQueue`), render newest-first, **name-less**
    format, capped (e.g. last 100). Session-scoped (Option X).

### 6. EDIT `src/hooks/use-table-occupancy-realtime.ts`
- Generalize the bind step: accept a `bindRpc` name + the bearer token so crew
  keeps `bind_role_session_realtime` and manager uses
  `bind_manager_session_realtime`. Everything else (revision-gated refetch,
  `onNotice`, self-filter) is reused unchanged. Manager passes
  `selfRoleSessionId = null` (sees all notices incl. its own restaurant's crew).

### 7. EDIT super-admin console
- New **Managers** panel: `list_managers()` table (nama, ID, resto, status,
  dibuat) + **Nonaktifkan** button per aktif row → `disable_manager`. No Enable.

### 8. Tests (TDD, MERAH→HIJAU)
- `manager-migration.test.ts`: tables + unique `id_manager` + RLS + revoke;
  `bind_manager_session_realtime` + extended `can_read_table_occupancy_broadcast`
  (manager OR-branch, requires `status='aktif'` + unexpired); read RPCs scope by
  session restaurant; `disable_manager` deletes sessions; super-admin-only guards.
- `manager-auth.test.ts`: scrypt hash/verify round-trip; register validation
  (dup ID, bad code, short password, mismatch); login rejects non-aktif.
- `manager-reminder.test.ts`: pure filter `>2h` from `occupied_at`; text
  `MEJA {n} | >{durasi} | PERLU DI CEK`; rotation over the >2h set.
- `manager-route.test.ts` (source contract): MANAGER button separated/top;
  register redirects to login (not dashboard); `requireManager` guard; sidebar
  3 menus + footer branding; crew-active grouped by role; log is name-less
  toast history; realtime hook generalized to manager bind.
- Full `npm run verify` exit 0 before commit+push (repo AGENTS.md gate).

## Error handling
- Login with unknown ID / wrong password / `nonaktif` → generic "Login gagal"
  (no user enumeration). Rate-limit reuses the existing login rate-limit pattern.
- Register with taken ID or unknown code → field error; resto not active → error.
- Expired/disabled manager token on any read RPC → `INVALID_SESSION` → client
  clears identity → redirect `/manager/login` (forced logout on disable).
- Realtime bind rejected → `CHANNEL_ERROR` → visible-only polling safety net
  (unchanged behavior from crew).

## Out of scope (later)
- Area-Manager activation/approval + Enable button (schema-ready via `status`).
- Persisted/back-in-time activity history (Option Y) — would add an audit table.
- Multi-restaurant managers (one person across branches).
- Additional sidebar menus beyond the three.

## Risks / notes
- Self-registration exposure is the main risk; mitigated later by activation.
- Manager realtime is the only non-trivial effort; it mirrors the proven crew
  binding, so risk is low. Reminder + log are pure client work over cached data
  (zero added server/DB cost), reusing `clear-up-queue.ts`.
- Supabase assigns its own ledger timestamp on apply; the repo migration filename
  is the CI replay source of truth.
