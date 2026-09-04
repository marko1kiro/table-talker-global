# Manager Monitoring Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-restaurant MANAGER role (self-registered ID+password) with an isolated monitoring dashboard: live table list + >2h reminder, active-crew-by-station, and a session-scoped activity log built from the live occupancy toasts.

**Architecture:** Manager mirrors the crew bearer-token pattern (anon Supabase auth + a manager token in `sessionStorage`), NOT the super-admin cookie. All manager reads are `security definer` RPCs that validate the token and scope to the session's restaurant. Realtime reuses the existing private channel via a manager bind RPC + an extended RLS reader. Reminder + log are pure client work over cached data (zero added server/DB cost). Super-admin gets a Managers panel (list + disable) via `requireSuperAdmin()` + service-role client.

**Tech Stack:** TanStack Start (`createServerFn`), TanStack Router (file routes), TanStack Query, React 19, Tailwind, Supabase (Postgres RPCs + Realtime Broadcast), Vitest, `node:crypto` scrypt (no new dependency).

**Spec:** `docs/superpowers/specs/2026-09-04-manager-monitoring-dashboard-design.md`

**Verify gate (repo AGENTS.md):** every commit is preceded by `npm run verify` exit 0. Run `npx prettier --write <files>` after any PowerShell edit (CRLF).

---

## File Structure

- `src/lib/manager-password.server.ts` — scrypt hash/verify (pure, Node).
- `src/lib/manager-session-identity.ts` — sessionStorage identity read/write/remove (mirror `crew-session-identity.ts`).
- `src/lib/manager-auth.server.ts` — `registerManager`, `loginManager` server fns + `*Core`.
- `src/lib/manager-dashboard.server.ts` — `getManagerSnapshot`, `getManagerActiveCrew` server fns + `*Core`.
- `src/lib/manager-reminder.ts` — pure >2h reminder lines + rotation index.
- `src/lib/manager-crew-groups.ts` — pure group-by-station + WIB time format.
- `src/hooks/use-table-occupancy-realtime.ts` — EDIT: generalize the bind RPC name.
- `src/components/ManagerLayout.tsx` — responsive sidebar + footer shell.
- `src/routes/manager/login.tsx`, `src/routes/manager/register.tsx`, `src/routes/manager/index.tsx` — new routes.
- `src/routes/index.tsx` — EDIT: separated MANAGER button at top of the login screen.
- `src/lib/admin-managers.server.ts` — super-admin `listManagers`, `disableManager`.
- `src/routes/super-admin/managers.tsx` + nav entry in `src/routes/super-admin/route.tsx`.
- Migrations under `supabase/migrations/`.

---

## Task 1: Manager password hashing (scrypt, no new dep)

**Files:**
- Create: `src/lib/manager-password.server.ts`
- Test: `tests/manager-password.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/manager-password.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { hashManagerPassword, verifyManagerPassword } from "../src/lib/manager-password.server";

describe("manager password hashing", () => {
  it("round-trips a correct password", async () => {
    const stored = await hashManagerPassword("rahasia123");
    expect(stored).toMatch(/^[a-f0-9]{32}:[a-f0-9]{128}$/);
    expect(await verifyManagerPassword("rahasia123", stored)).toBe(true);
  });
  it("rejects a wrong password", async () => {
    const stored = await hashManagerPassword("rahasia123");
    expect(await verifyManagerPassword("salah", stored)).toBe(false);
  });
  it("uses a fresh salt each time", async () => {
    const a = await hashManagerPassword("same");
    const b = await hashManagerPassword("same");
    expect(a).not.toBe(b);
    expect(await verifyManagerPassword("same", a)).toBe(true);
    expect(await verifyManagerPassword("same", b)).toBe(true);
  });
  it("returns false for a malformed stored hash", async () => {
    expect(await verifyManagerPassword("x", "not-a-hash")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/manager-password.test.ts`
Expected: FAIL — cannot find module `manager-password.server`.

- [ ] **Step 3: Write minimal implementation**

`src/lib/manager-password.server.ts`:
```ts
// Manager passwords are hashed with node:crypto scrypt (no new dependency).
// Stored format: "<saltHex(32)>:<hashHex(128)>" (16-byte salt, 64-byte key).
// Dynamic import of node:crypto keeps this module safe to import from a
// *.server.ts that a client route also pulls in (see role-session.server.ts).
const SALT_BYTES = 16;
const KEY_BYTES = 64;

function scrypt(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    import("node:crypto").then(({ scrypt }) => {
      scrypt(password, salt, KEY_BYTES, (err, derived) => {
        if (err) reject(err);
        else resolve(derived);
      });
    }, reject);
  });
}

export async function hashManagerPassword(password: string): Promise<string> {
  const { randomBytes } = await import("node:crypto");
  const salt = randomBytes(SALT_BYTES);
  const key = await scrypt(password, salt);
  return `${salt.toString("hex")}:${key.toString("hex")}`;
}

export async function verifyManagerPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const { timingSafeEqual } = await import("node:crypto");
  const [saltHex, keyHex] = stored.split(":");
  if (!saltHex || !keyHex) return false;
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltHex, "hex");
    expected = Buffer.from(keyHex, "hex");
  } catch {
    return false;
  }
  if (salt.length !== SALT_BYTES || expected.length !== KEY_BYTES) return false;
  const actual = await scrypt(password, salt);
  return timingSafeEqual(actual, expected);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/manager-password.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/manager-password.server.ts tests/manager-password.test.ts
git commit -m "feat(manager): add scrypt password hash/verify helper"
```

---

## Task 2: `manager_accounts` + `manager_sessions` migration

**Files:**
- Create: `supabase/migrations/20260904110000_manager_accounts.sql`
- Test: `tests/manager-accounts-migration.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/manager-accounts-migration.test.ts`:
```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = () =>
  readFileSync(
    new URL("../supabase/migrations/20260904110000_manager_accounts.sql", import.meta.url),
    "utf8",
  ).toLowerCase();

describe("manager_accounts migration", () => {
  it("creates both tables with rls and full revokes", () => {
    const sql = source();
    expect(sql).toContain("create table public.manager_accounts");
    expect(sql).toContain("create table public.manager_sessions");
    expect(sql).toContain("alter table public.manager_accounts enable row level security");
    expect(sql).toContain("alter table public.manager_sessions enable row level security");
    expect(sql).toContain("revoke all on public.manager_accounts from public, anon, authenticated");
    expect(sql).toContain("revoke all on public.manager_sessions from public, anon, authenticated");
  });
  it("enforces a unique global id_manager and an aktif/nonaktif status", () => {
    const sql = source();
    expect(sql).toContain("create unique index manager_accounts_id_manager_key");
    expect(sql).toContain("check (status in ('aktif','nonaktif'))");
    expect(sql).toContain("default 'aktif'");
  });
  it("scopes both tables to a restaurant and cascades on delete", () => {
    const sql = source();
    expect(sql).toContain("references public.restaurants(id) on delete cascade");
    expect(sql).toContain("references public.manager_accounts(id) on delete cascade");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/manager-accounts-migration.test.ts`
Expected: FAIL — file not found.

- [ ] **Step 3: Write minimal implementation**

`supabase/migrations/20260904110000_manager_accounts.sql`:
```sql
-- Manager accounts + sessions (see docs/superpowers/specs/
-- 2026-09-04-manager-monitoring-dashboard-design.md). manager_sessions is the
-- manager analogue of role_session_tokens: a bearer token row with a lazily
-- bound auth_user_id for private-channel realtime. Passwords are hashed in the
-- Node server fn (scrypt); the DB only ever stores "saltHex:hashHex".

create table public.manager_accounts (
  id uuid primary key default gen_random_uuid(),
  id_manager text not null,
  password_hash text not null,
  full_name text not null,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  status text not null default 'aktif' check (status in ('aktif','nonaktif')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index manager_accounts_id_manager_key on public.manager_accounts (id_manager);
create index manager_accounts_restaurant_idx on public.manager_accounts (restaurant_id);
alter table public.manager_accounts enable row level security;
revoke all on public.manager_accounts from public, anon, authenticated;

create table public.manager_sessions (
  id uuid primary key default gen_random_uuid(),
  manager_id uuid not null references public.manager_accounts(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  token_hash text not null unique,
  auth_user_id uuid default auth.uid() references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index manager_sessions_auth_restaurant_idx
  on public.manager_sessions (auth_user_id, restaurant_id)
  where auth_user_id is not null;
alter table public.manager_sessions enable row level security;
revoke all on public.manager_sessions from public, anon, authenticated;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/manager-accounts-migration.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260904110000_manager_accounts.sql tests/manager-accounts-migration.test.ts
git commit -m "feat(manager): add manager_accounts and manager_sessions tables"
```

---

## Task 3: Manager auth RPCs migration (register / credential / session)

**Files:**
- Create: `supabase/migrations/20260904111000_manager_auth.sql`
- Test: `tests/manager-auth-migration.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/manager-auth-migration.test.ts`:
```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = () =>
  readFileSync(
    new URL("../supabase/migrations/20260904111000_manager_auth.sql", import.meta.url),
    "utf8",
  ).toLowerCase();

describe("manager auth rpcs migration", () => {
  it("defines register / get_credential / create_session", () => {
    const sql = source();
    expect(sql).toContain("create or replace function public.register_manager(");
    expect(sql).toContain("create or replace function public.get_manager_credential(");
    expect(sql).toContain("create or replace function public.create_manager_session(");
  });
  it("register resolves an active restaurant by code and rejects a duplicate id", () => {
    const sql = source();
    expect(sql).toContain("from public.restaurants");
    expect(sql).toContain("is_active");
    expect(sql).toContain("manager_accounts_id_manager_key");
  });
  it("create_session stores a sha256 hash and returns the plaintext token once", () => {
    const sql = source();
    expect(sql).toContain("extensions.digest(v_token, 'sha256')");
    expect(sql).toContain("return v_token");
  });
  it("grants the three auth rpcs to service_role only", () => {
    const sql = source();
    expect(sql).toMatch(/grant execute on function public\.register_manager\(text, text, text, text\) to service_role/);
    expect(sql).toMatch(/grant execute on function public\.get_manager_credential\(text\) to service_role/);
    expect(sql).toMatch(/grant execute on function public\.create_manager_session\(uuid\) to service_role/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/manager-auth-migration.test.ts`
Expected: FAIL — file not found.

- [ ] **Step 3: Write minimal implementation**

`supabase/migrations/20260904111000_manager_auth.sql`:
```sql
-- Manager registration + login bootstrap RPCs. All service_role: they are only
-- ever called from trusted server functions (register/login), never from a
-- browser. get_manager_credential returns the stored hash so the Node server fn
-- can verify scrypt; create_manager_session mints a bearer token.

create or replace function public.register_manager(
  p_id_manager text,
  p_full_name text,
  p_restaurant_code text,
  p_password_hash text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant public.restaurants%rowtype;
begin
  select * into v_restaurant
  from public.restaurants
  where code = upper(trim(p_restaurant_code)) and is_active;
  if v_restaurant.id is null then raise exception 'RESTAURANT_NOT_FOUND'; end if;

  if exists (select 1 from public.manager_accounts where id_manager = lower(trim(p_id_manager))) then
    raise exception 'ID_MANAGER_TAKEN';
  end if;

  begin
    insert into public.manager_accounts (id_manager, full_name, restaurant_id, password_hash)
    values (lower(trim(p_id_manager)), trim(p_full_name), v_restaurant.id, p_password_hash);
  exception when unique_violation then
    raise exception 'ID_MANAGER_TAKEN';
  end;
  return true;
end;
$$;
revoke all on function public.register_manager(text, text, text, text) from public, anon, authenticated;
grant execute on function public.register_manager(text, text, text, text) to service_role;

create or replace function public.get_manager_credential(p_id_manager text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', ma.id,
    'password_hash', ma.password_hash,
    'status', ma.status,
    'full_name', ma.full_name,
    'restaurant_id', ma.restaurant_id,
    'restaurant_display_name', r.display_name,
    'restaurant_code', r.code
  )
  from public.manager_accounts ma
  join public.restaurants r on r.id = ma.restaurant_id
  where ma.id_manager = lower(trim(p_id_manager));
$$;
revoke all on function public.get_manager_credential(text) from public, anon, authenticated;
grant execute on function public.get_manager_credential(text) to service_role;

create or replace function public.create_manager_session(p_manager_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account public.manager_accounts%rowtype;
  v_token text;
  v_expires timestamptz;
begin
  select * into v_account from public.manager_accounts
  where id = p_manager_id and status = 'aktif';
  if v_account.id is null then raise exception 'INVALID_MANAGER'; end if;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_expires := now() + interval '12 hours';
  insert into public.manager_sessions (manager_id, restaurant_id, token_hash, expires_at)
  values (v_account.id, v_account.restaurant_id, encode(extensions.digest(v_token, 'sha256'), 'hex'), v_expires);

  return jsonb_build_object('token', v_token, 'expires_at', v_expires);
end;
$$;
revoke all on function public.create_manager_session(uuid) from public, anon, authenticated;
grant execute on function public.create_manager_session(uuid) to service_role;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/manager-auth-migration.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260904111000_manager_auth.sql tests/manager-auth-migration.test.ts
git commit -m "feat(manager): add register/credential/session auth RPCs"
```

---

## Task 4: Manager realtime binding migration

**Files:**
- Create: `supabase/migrations/20260904112000_manager_realtime_binding.sql`
- Test: `tests/manager-realtime-migration.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/manager-realtime-migration.test.ts`:
```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = () =>
  readFileSync(
    new URL("../supabase/migrations/20260904112000_manager_realtime_binding.sql", import.meta.url),
    "utf8",
  ).toLowerCase();

describe("manager realtime binding migration", () => {
  it("adds a manager bind rpc granted to authenticated", () => {
    const sql = source();
    expect(sql).toContain("create or replace function public.bind_manager_session_realtime(");
    expect(sql).toContain("update public.manager_sessions");
    expect(sql).toMatch(
      /grant execute on function public\.bind_manager_session_realtime\(uuid, text\) to authenticated/,
    );
  });
  it("extends the broadcast reader with a manager OR-branch requiring aktif + unexpired", () => {
    const sql = source();
    expect(sql).toContain("create or replace function public.can_read_table_occupancy_broadcast(");
    expect(sql).toContain("from public.manager_sessions");
    expect(sql).toContain("ma.status = 'aktif'");
    expect(sql).toContain("ms.expires_at > now()");
    expect(sql).toContain("'table-occupancy:' || ms.restaurant_id::text");
  });
  it("keeps the existing crew branch intact", () => {
    const sql = source();
    expect(sql).toContain("from public.role_session_tokens rst");
    expect(sql).toContain("rst.role in ('kasir','satgas','clear_up')");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/manager-realtime-migration.test.ts`
Expected: FAIL — file not found.

- [ ] **Step 3: Write minimal implementation**

`supabase/migrations/20260904112000_manager_realtime_binding.sql`:
```sql
-- Let a manager subscribe to the existing private channel
-- table-occupancy:{restaurantId}. Mirrors bind_role_session_realtime; the RLS
-- SELECT policy on realtime.messages already calls can_read_table_occupancy_broadcast,
-- so only the function body is extended (crew branch preserved, manager OR-branch
-- added). No policy change needed.

create or replace function public.bind_manager_session_realtime(
  p_restaurant_id uuid,
  p_manager_token text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_auth uuid := auth.uid();
  v_bound boolean := false;
begin
  if v_auth is null then raise exception 'UNAUTHORIZED'; end if;
  update public.manager_sessions ms
  set auth_user_id = v_auth
  from public.manager_accounts ma, public.restaurants r
  where ms.token_hash = encode(extensions.digest(p_manager_token, 'sha256'), 'hex')
    and ms.manager_id = ma.id
    and ma.status = 'aktif'
    and ms.restaurant_id = p_restaurant_id
    and r.id = ms.restaurant_id
    and r.is_active
    and ms.expires_at > now()
    and (ms.auth_user_id is null or ms.auth_user_id = v_auth)
  returning true into v_bound;
  if not v_bound then raise exception 'INVALID_SESSION'; end if;
  return true;
end;
$$;
revoke all on function public.bind_manager_session_realtime(uuid, text) from public, anon, service_role;
grant execute on function public.bind_manager_session_realtime(uuid, text) to authenticated;

create or replace function public.can_read_table_occupancy_broadcast(p_topic text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.role_session_tokens rst
    join public.restaurants r on r.id = rst.restaurant_id
    where rst.auth_user_id = auth.uid()
      and rst.role in ('kasir','satgas','clear_up')
      and rst.expires_at > now()
      and r.is_active
      and rst.code_version = r.code_version
      and p_topic = 'table-occupancy:' || rst.restaurant_id::text
  ) or exists (
    select 1
    from public.manager_sessions ms
    join public.manager_accounts ma on ma.id = ms.manager_id
    join public.restaurants r on r.id = ms.restaurant_id
    where ms.auth_user_id = auth.uid()
      and ma.status = 'aktif'
      and ms.expires_at > now()
      and r.is_active
      and p_topic = 'table-occupancy:' || ms.restaurant_id::text
  );
$$;
revoke all on function public.can_read_table_occupancy_broadcast(text) from public, anon, service_role;
grant execute on function public.can_read_table_occupancy_broadcast(text) to authenticated;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/manager-realtime-migration.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260904112000_manager_realtime_binding.sql tests/manager-realtime-migration.test.ts
git commit -m "feat(manager): bind managers to the private occupancy realtime channel"
```

---

## Task 5: Manager read RPCs migration (snapshot + active crew)

**Files:**
- Create: `supabase/migrations/20260904113000_manager_reads.sql`
- Test: `tests/manager-reads-migration.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/manager-reads-migration.test.ts`:
```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = () =>
  readFileSync(
    new URL("../supabase/migrations/20260904113000_manager_reads.sql", import.meta.url),
    "utf8",
  ).toLowerCase();

describe("manager reads migration", () => {
  it("defines snapshot + active-crew rpcs validated by the manager token", () => {
    const sql = source();
    expect(sql).toContain("create or replace function public.get_manager_snapshot(");
    expect(sql).toContain("create or replace function public.get_manager_active_crew(");
    expect(sql).toContain("encode(extensions.digest(p_manager_token, 'sha256'), 'hex')");
    expect(sql).toContain("ma.status = 'aktif'");
    expect(sql).toContain("ms.expires_at > now()");
  });
  it("scopes every read to the session's own restaurant", () => {
    const sql = source();
    expect(sql).toContain("v_session.restaurant_id");
    expect(sql).not.toContain("p_restaurant_id");
  });
  it("active crew joins tokens to sessions and filters unexpired", () => {
    const sql = source();
    expect(sql).toContain("from public.role_session_tokens rst");
    expect(sql).toContain("join public.crew_role_sessions crs");
    expect(sql).toContain("rst.expires_at > now()");
  });
  it("grants both reads to authenticated", () => {
    const sql = source();
    expect(sql).toMatch(/grant execute on function public\.get_manager_snapshot\(text\) to authenticated/);
    expect(sql).toMatch(/grant execute on function public\.get_manager_active_crew\(text\) to authenticated/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/manager-reads-migration.test.ts`
Expected: FAIL — file not found.

- [ ] **Step 3: Write minimal implementation**

`supabase/migrations/20260904113000_manager_reads.sql`:
```sql
-- Manager-scoped reads. Both validate the bearer token and derive restaurant
-- scope from the session row (never a client-supplied id). Granted to
-- authenticated (called with the device's anon access token, like crew reads).

create or replace function public.get_manager_snapshot(p_manager_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session record;
  v_revision bigint;
  v_tables jsonb;
begin
  select ms.restaurant_id into v_session
  from public.manager_sessions ms
  join public.manager_accounts ma on ma.id = ms.manager_id
  join public.restaurants r on r.id = ms.restaurant_id
  where ms.token_hash = encode(extensions.digest(p_manager_token, 'sha256'), 'hex')
    and ma.status = 'aktif'
    and ms.expires_at > now()
    and r.is_active;
  if v_session is null then raise exception 'INVALID_SESSION'; end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'table_number', t.table_number,
        'status', t.status,
        'occupied_at', t.occupied_at,
        'occupied_source', t.occupied_source
      )
      order by t.table_number
    ),
    '[]'::jsonb
  ) into v_tables
  from public.table_occupancy_state t
  where t.restaurant_id = v_session.restaurant_id;

  select revision into v_revision
  from public.table_occupancy_revisions
  where restaurant_id = v_session.restaurant_id;

  return jsonb_build_object('revision', coalesce(v_revision, 0), 'tables', v_tables);
end;
$$;
revoke all on function public.get_manager_snapshot(text) from public, anon, service_role;
grant execute on function public.get_manager_snapshot(text) to authenticated;

create or replace function public.get_manager_active_crew(p_manager_token text)
returns table (role text, display_name text, checked_in_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant uuid;
begin
  select ms.restaurant_id into v_restaurant
  from public.manager_sessions ms
  join public.manager_accounts ma on ma.id = ms.manager_id
  join public.restaurants r on r.id = ms.restaurant_id
  where ms.token_hash = encode(extensions.digest(p_manager_token, 'sha256'), 'hex')
    and ma.status = 'aktif'
    and ms.expires_at > now()
    and r.is_active;
  if v_restaurant is null then raise exception 'INVALID_SESSION'; end if;

  return query
  select rst.role, crs.display_name, crs.checked_in_at
  from public.role_session_tokens rst
  join public.crew_role_sessions crs on crs.id = rst.role_session_id
  where rst.restaurant_id = v_restaurant
    and rst.expires_at > now()
  order by rst.role, crs.checked_in_at;
end;
$$;
revoke all on function public.get_manager_active_crew(text) from public, anon, service_role;
grant execute on function public.get_manager_active_crew(text) to authenticated;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/manager-reads-migration.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260904113000_manager_reads.sql tests/manager-reads-migration.test.ts
git commit -m "feat(manager): add token-scoped snapshot and active-crew read RPCs"
```

---

## Task 6: Manager session identity (sessionStorage)

**Files:**
- Create: `src/lib/manager-session-identity.ts`
- Test: `tests/manager-session-identity.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/manager-session-identity.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import {
  MANAGER_SESSION_IDENTITY_KEY,
  readManagerIdentity,
  writeManagerIdentity,
  removeManagerIdentity,
  type ManagerIdentity,
} from "../src/lib/manager-session-identity";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

const identity: ManagerIdentity = {
  idManager: "budi",
  fullName: "Budi",
  restaurantId: "11111111-1111-1111-1111-111111111111",
  restaurantDisplayName: "Mie Gacoan Kampung Bulu",
  restaurantCode: "CKRBUL",
  managerToken: "tok",
  accessToken: "anon",
};

describe("manager session identity", () => {
  it("round-trips through storage", () => {
    const s = memoryStorage();
    writeManagerIdentity(s, identity);
    expect(s.getItem(MANAGER_SESSION_IDENTITY_KEY)).toBeTruthy();
    expect(readManagerIdentity(s)).toEqual(identity);
  });
  it("returns null and clears a malformed entry", () => {
    const s = memoryStorage();
    s.setItem(MANAGER_SESSION_IDENTITY_KEY, JSON.stringify({ idManager: "x" }));
    expect(readManagerIdentity(s)).toBeNull();
    expect(s.getItem(MANAGER_SESSION_IDENTITY_KEY)).toBeNull();
  });
  it("removeManagerIdentity clears the key", () => {
    const s = memoryStorage();
    writeManagerIdentity(s, identity);
    removeManagerIdentity(s);
    expect(readManagerIdentity(s)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/manager-session-identity.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`src/lib/manager-session-identity.ts`:
```ts
// Manager analogue of crew-session-identity.ts. Persists the manager bearer
// token + the device's anon Supabase access token (needed for realtime) in
// sessionStorage. Token expiry limits XSS exposure (same rationale as crew).
type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const MANAGER_SESSION_IDENTITY_KEY = "table-talker.manager-identity";

export type ManagerIdentity = {
  idManager: string;
  fullName: string;
  restaurantId: string;
  restaurantDisplayName: string;
  restaurantCode: string;
  managerToken: string;
  accessToken: string;
};

export function readManagerIdentity(storage: StorageLike | null): ManagerIdentity | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(MANAGER_SESSION_IDENTITY_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Record<string, unknown>;
    const keys = [
      "idManager",
      "fullName",
      "restaurantId",
      "restaurantDisplayName",
      "restaurantCode",
      "managerToken",
      "accessToken",
    ] as const;
    for (const k of keys) {
      if (typeof v[k] !== "string" || !v[k]) {
        storage.removeItem(MANAGER_SESSION_IDENTITY_KEY);
        return null;
      }
    }
    return v as unknown as ManagerIdentity;
  } catch {
    try {
      storage.removeItem(MANAGER_SESSION_IDENTITY_KEY);
    } catch {
      return null;
    }
    return null;
  }
}

export function writeManagerIdentity(
  storage: StorageLike | null,
  identity: ManagerIdentity,
): ManagerIdentity | null {
  if (!storage) return null;
  try {
    storage.setItem(MANAGER_SESSION_IDENTITY_KEY, JSON.stringify(identity));
    return identity;
  } catch {
    return null;
  }
}

export function removeManagerIdentity(storage: StorageLike | null) {
  try {
    storage?.removeItem(MANAGER_SESSION_IDENTITY_KEY);
  } catch {
    return;
  }
}

export function browserManagerStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/manager-session-identity.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/manager-session-identity.ts tests/manager-session-identity.test.ts
git commit -m "feat(manager): add sessionStorage identity helpers"
```

---

## Task 7: Manager auth server functions (register + login)

**Files:**
- Create: `src/lib/manager-auth.server.ts`
- Test: `tests/manager-auth-server.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/manager-auth-server.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import {
  registerManagerCore,
  loginManagerCore,
  type ManagerAuthDeps,
} from "../src/lib/manager-auth.server";

function fakeHash(pw: string) {
  return `hash(${pw})`;
}
function fakeVerify(pw: string, stored: string) {
  return Promise.resolve(stored === `hash(${pw})`);
}

describe("registerManagerCore", () => {
  it("rejects a short password", async () => {
    const deps: ManagerAuthDeps = {
      rpc: async () => ({ data: true, error: null }),
      hash: async (p) => fakeHash(p),
    };
    const r = await registerManagerCore(
      { idManager: "budi", fullName: "Budi", restaurantCode: "CKRBUL", password: "123" },
      deps,
    );
    expect(r).toEqual({ ok: false, code: "WEAK_PASSWORD" });
  });
  it("maps RESTAURANT_NOT_FOUND from the rpc", async () => {
    const deps: ManagerAuthDeps = {
      rpc: async () => ({ data: null, error: { message: "RESTAURANT_NOT_FOUND" } }),
      hash: async (p) => fakeHash(p),
    };
    const r = await registerManagerCore(
      { idManager: "budi", fullName: "Budi", restaurantCode: "X", password: "rahasia123" },
      deps,
    );
    expect(r).toEqual({ ok: false, code: "RESTAURANT_NOT_FOUND" });
  });
  it("maps ID_MANAGER_TAKEN from the rpc", async () => {
    const deps: ManagerAuthDeps = {
      rpc: async () => ({ data: null, error: { message: "ID_MANAGER_TAKEN" } }),
      hash: async (p) => fakeHash(p),
    };
    const r = await registerManagerCore(
      { idManager: "budi", fullName: "Budi", restaurantCode: "CKRBUL", password: "rahasia123" },
      deps,
    );
    expect(r).toEqual({ ok: false, code: "ID_MANAGER_TAKEN" });
  });
  it("succeeds and passes the computed hash to the rpc", async () => {
    let seen: unknown;
    const deps: ManagerAuthDeps = {
      rpc: async (_fn, params) => {
        seen = params;
        return { data: true, error: null };
      },
      hash: async (p) => fakeHash(p),
    };
    const r = await registerManagerCore(
      { idManager: "budi", fullName: "Budi", restaurantCode: "CKRBUL", password: "rahasia123" },
      deps,
    );
    expect(r).toEqual({ ok: true });
    expect(seen).toMatchObject({ p_id_manager: "budi", p_password_hash: "hash(rahasia123)" });
  });
});

describe("loginManagerCore", () => {
  const cred = {
    id: "m-1",
    password_hash: "hash(rahasia123)",
    status: "aktif",
    full_name: "Budi",
    restaurant_id: "r-1",
    restaurant_display_name: "Mie Gacoan KB",
    restaurant_code: "CKRBUL",
  };
  it("generic-fails on unknown id (no enumeration)", async () => {
    const deps: ManagerAuthDeps = {
      rpc: async (fn) => (fn === "get_manager_credential" ? { data: null, error: null } : { data: null, error: null }),
      verify: fakeVerify,
      createSession: async () => ({ token: "t", expiresAt: "e" }),
    };
    const r = await loginManagerCore({ idManager: "ghost", password: "rahasia123" }, deps);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("INVALID_CREDENTIALS");
  });
  it("generic-fails on wrong password", async () => {
    const deps: ManagerAuthDeps = {
      rpc: async () => ({ data: cred, error: null }),
      verify: fakeVerify,
      createSession: async () => ({ token: "t", expiresAt: "e" }),
    };
    const r = await loginManagerCore({ idManager: "budi", password: "nope" }, deps);
    expect(!r.ok && r.code).toBe("INVALID_CREDENTIALS");
  });
  it("fails for a nonaktif account", async () => {
    const deps: ManagerAuthDeps = {
      rpc: async () => ({ data: { ...cred, status: "nonaktif" }, error: null }),
      verify: fakeVerify,
      createSession: async () => ({ token: "t", expiresAt: "e" }),
    };
    const r = await loginManagerCore({ idManager: "budi", password: "rahasia123" }, deps);
    expect(!r.ok && r.code).toBe("DISABLED");
  });
  it("returns the identity + token on success", async () => {
    const deps: ManagerAuthDeps = {
      rpc: async () => ({ data: cred, error: null }),
      verify: fakeVerify,
      createSession: async () => ({ token: "tok123", expiresAt: "2026-09-04T20:00:00Z" }),
    };
    const r = await loginManagerCore({ idManager: "budi", password: "rahasia123" }, deps);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.managerToken).toBe("tok123");
      expect(r.restaurantId).toBe("r-1");
      expect(r.restaurantCode).toBe("CKRBUL");
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/manager-auth-server.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`src/lib/manager-auth.server.ts`:
```ts
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getServiceClient } from "./remote-audio.server";
import { hashManagerPassword, verifyManagerPassword } from "./manager-password.server";
import type { RpcCaller } from "./role-session.server";

const GENERIC = "Terjadi kesalahan. Coba lagi.";

export type ManagerAuthDeps = {
  rpc: RpcCaller;
  hash?: (password: string) => Promise<string>;
  verify?: (password: string, stored: string) => Promise<boolean>;
  createSession?: (managerId: string) => Promise<{ token: string; expiresAt: string } | null>;
};

// --- register -------------------------------------------------------------

export const registerManagerInputSchema = z.object({
  idManager: z.string().trim().min(3).max(32).regex(/^[a-z0-9._-]+$/, "ID Manager tidak valid."),
  fullName: z.string().trim().min(1).max(80),
  restaurantCode: z.string().trim().min(1).max(40),
  password: z.string().min(8).max(200),
});

export type RegisterManagerInput = z.infer<typeof registerManagerInputSchema>;
export type RegisterManagerResult =
  | { ok: true }
  | { ok: false; code: "WEAK_PASSWORD" | "RESTAURANT_NOT_FOUND" | "ID_MANAGER_TAKEN" | "UNAVAILABLE"; message?: string };

export async function registerManagerCore(
  data: RegisterManagerInput,
  deps: ManagerAuthDeps,
): Promise<RegisterManagerResult> {
  if (data.password.length < 8) return { ok: false, code: "WEAK_PASSWORD" };
  const hash = deps.hash ?? hashManagerPassword;
  const passwordHash = await hash(data.password);
  const { error } = await deps.rpc("register_manager", {
    p_id_manager: data.idManager,
    p_full_name: data.fullName,
    p_restaurant_code: data.restaurantCode,
    p_password_hash: passwordHash,
  });
  if (error) {
    if (error.message === "RESTAURANT_NOT_FOUND") return { ok: false, code: "RESTAURANT_NOT_FOUND" };
    if (error.message === "ID_MANAGER_TAKEN") return { ok: false, code: "ID_MANAGER_TAKEN" };
    return { ok: false, code: "UNAVAILABLE", message: GENERIC };
  }
  return { ok: true };
}

export const registerManager = createServerFn({ method: "POST" })
  .validator(registerManagerInputSchema)
  .handler(async ({ data }): Promise<RegisterManagerResult> => {
    const client = getServiceClient();
    if (!client) return { ok: false, code: "UNAVAILABLE", message: GENERIC };
    return registerManagerCore(data, { rpc: async (fn, params) => client.rpc(fn, params) });
  });

// --- login ----------------------------------------------------------------

type ManagerCredential = {
  id: string;
  password_hash: string;
  status: string;
  full_name: string;
  restaurant_id: string;
  restaurant_display_name: string;
  restaurant_code: string;
};

export const loginManagerInputSchema = z.object({
  idManager: z.string().min(1),
  password: z.string().min(1),
});

export type LoginManagerResult =
  | {
      ok: true;
      managerToken: string;
      idManager: string;
      fullName: string;
      restaurantId: string;
      restaurantDisplayName: string;
      restaurantCode: string;
    }
  | { ok: false; code: "INVALID_CREDENTIALS" | "DISABLED" | "UNAVAILABLE"; message: string };

async function defaultCreateSession(
  rpc: RpcCaller,
  managerId: string,
): Promise<{ token: string; expiresAt: string } | null> {
  const { data, error } = await rpc("create_manager_session", { p_manager_id: managerId });
  if (error || !data || typeof data !== "object") return null;
  const d = data as { token?: unknown; expires_at?: unknown };
  if (typeof d.token !== "string" || typeof d.expires_at !== "string") return null;
  return { token: d.token, expiresAt: d.expires_at };
}

export async function loginManagerCore(
  data: { idManager: string; password: string },
  deps: ManagerAuthDeps,
): Promise<LoginManagerResult> {
  const verify = deps.verify ?? verifyManagerPassword;
  const { data: cred, error } = await deps.rpc("get_manager_credential", {
    p_id_manager: data.idManager,
  });
  if (error || !cred || typeof cred !== "object") {
    return { ok: false, code: "INVALID_CREDENTIALS", message: "ID Manager atau password salah." };
  }
  const c = cred as ManagerCredential;
  if (!(await verify(data.password, c.password_hash))) {
    return { ok: false, code: "INVALID_CREDENTIALS", message: "ID Manager atau password salah." };
  }
  if (c.status !== "aktif") {
    return { ok: false, code: "DISABLED", message: "Akun manager ini sudah dinonaktifkan." };
  }
  const session = deps.createSession
    ? await deps.createSession(c.id)
    : await defaultCreateSession(deps.rpc, c.id);
  if (!session) return { ok: false, code: "UNAVAILABLE", message: GENERIC };
  return {
    ok: true,
    managerToken: session.token,
    idManager: data.idManager,
    fullName: c.full_name,
    restaurantId: c.restaurant_id,
    restaurantDisplayName: c.restaurant_display_name,
    restaurantCode: c.restaurant_code,
  };
}

export const loginManager = createServerFn({ method: "POST" })
  .validator(loginManagerInputSchema)
  .handler(async ({ data }): Promise<LoginManagerResult> => {
    const client = getServiceClient();
    if (!client) return { ok: false, code: "UNAVAILABLE", message: GENERIC };
    return loginManagerCore(data, { rpc: async (fn, params) => client.rpc(fn, params) });
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/manager-auth-server.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/manager-auth.server.ts tests/manager-auth-server.test.ts
git commit -m "feat(manager): add register/login server functions"
```

---

## Task 8: Manager dashboard read server functions

**Files:**
- Create: `src/lib/manager-dashboard.server.ts`
- Test: `tests/manager-dashboard-server.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/manager-dashboard-server.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import {
  getManagerSnapshotCore,
  getManagerActiveCrewCore,
} from "../src/lib/manager-dashboard.server";

describe("getManagerSnapshotCore", () => {
  it("normalizes the versioned snapshot payload", async () => {
    const rpc = async () => ({
      data: {
        revision: 7,
        tables: [
          { table_number: 1, status: "terisi", occupied_at: "2026-09-04T10:00:00Z", occupied_source: "kasir" },
          { table_number: 2, status: "kosong", occupied_at: null, occupied_source: null },
        ],
      },
      error: null,
    });
    const r = await getManagerSnapshotCore({ managerToken: "t" }, rpc);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.revision).toBe(7);
      expect(r.tables[0]).toMatchObject({ tableNumber: 1, status: "terisi", occupiedAt: "2026-09-04T10:00:00Z" });
      expect(r.tables[1]).toMatchObject({ tableNumber: 2, status: "kosong", occupiedAt: null });
    }
  });
  it("maps INVALID_SESSION", async () => {
    const rpc = async () => ({ data: null, error: { message: "INVALID_SESSION" } });
    const r = await getManagerSnapshotCore({ managerToken: "t" }, rpc);
    expect(r).toMatchObject({ ok: false, code: "INVALID_SESSION" });
  });
});

describe("getManagerActiveCrewCore", () => {
  it("maps rows to camelCase", async () => {
    const rpc = async () => ({
      data: [{ role: "kasir", display_name: "Rina", checked_in_at: "2026-09-04T10:00:00Z" }],
      error: null,
    });
    const r = await getManagerActiveCrewCore({ managerToken: "t" }, rpc);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.crew[0]).toEqual({ role: "kasir", displayName: "Rina", checkedInAt: "2026-09-04T10:00:00Z" });
  });
  it("maps INVALID_SESSION", async () => {
    const rpc = async () => ({ data: null, error: { message: "INVALID_SESSION" } });
    const r = await getManagerActiveCrewCore({ managerToken: "t" }, rpc);
    expect(r).toMatchObject({ ok: false, code: "INVALID_SESSION" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/manager-dashboard-server.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`src/lib/manager-dashboard.server.ts`:
```ts
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getAnonAuthedSupabaseClient, type RpcCaller } from "./role-session.server";
import type { TableOccupancyRow } from "./table-occupancy.server";

const GENERIC = "Gagal memuat data manager.";

export const managerSnapshotInputSchema = z.object({
  managerToken: z.string().min(1),
  accessToken: z.string().min(1),
});

export type ManagerSnapshotResult =
  | { ok: true; revision: number; tables: TableOccupancyRow[] }
  | { ok: false; code: "INVALID_SESSION" | "UNAVAILABLE"; message: string };

function normalizeManagerRows(rows: unknown[]): TableOccupancyRow[] {
  return rows.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      tableNumber: Number(r.table_number),
      status: r.status === "terisi" ? "terisi" : "kosong",
      occupiedAt: typeof r.occupied_at === "string" ? r.occupied_at : null,
      occupiedSource: typeof r.occupied_source === "string" ? r.occupied_source : null,
      escortIntentId: null,
      escortIntentExpiresAt: null,
      escortIntentMine: false,
    };
  });
}

export async function getManagerSnapshotCore(
  data: { managerToken: string },
  rpc: RpcCaller,
): Promise<ManagerSnapshotResult> {
  try {
    const { data: snapshot, error } = await rpc("get_manager_snapshot", {
      p_manager_token: data.managerToken,
    });
    if (error) {
      return {
        ok: false,
        code: error.message === "INVALID_SESSION" ? "INVALID_SESSION" : "UNAVAILABLE",
        message: GENERIC,
      };
    }
    const raw = snapshot as { revision?: unknown; tables?: unknown } | null;
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.tables)) {
      return { ok: false, code: "UNAVAILABLE", message: GENERIC };
    }
    const revision = typeof raw.revision === "number" ? raw.revision : 0;
    return { ok: true, revision, tables: normalizeManagerRows(raw.tables) };
  } catch {
    return { ok: false, code: "UNAVAILABLE", message: GENERIC };
  }
}

export const getManagerSnapshot = createServerFn({ method: "GET" })
  .validator(managerSnapshotInputSchema)
  .handler(async ({ data }): Promise<ManagerSnapshotResult> => {
    const client = getAnonAuthedSupabaseClient(data.accessToken);
    if (!client) return { ok: false, code: "UNAVAILABLE", message: GENERIC };
    return getManagerSnapshotCore({ managerToken: data.managerToken }, async (fn, params) =>
      client.rpc(fn, params),
    );
  });

export const managerActiveCrewInputSchema = z.object({
  managerToken: z.string().min(1),
  accessToken: z.string().min(1),
});

export type ActiveCrewRow = { role: string; displayName: string; checkedInAt: string };
export type ManagerActiveCrewResult =
  | { ok: true; crew: ActiveCrewRow[] }
  | { ok: false; code: "INVALID_SESSION" | "UNAVAILABLE"; message: string };

export async function getManagerActiveCrewCore(
  data: { managerToken: string },
  rpc: RpcCaller,
): Promise<ManagerActiveCrewResult> {
  try {
    const { data: rows, error } = await rpc("get_manager_active_crew", {
      p_manager_token: data.managerToken,
    });
    if (error) {
      return {
        ok: false,
        code: error.message === "INVALID_SESSION" ? "INVALID_SESSION" : "UNAVAILABLE",
        message: GENERIC,
      };
    }
    if (!Array.isArray(rows)) return { ok: false, code: "UNAVAILABLE", message: GENERIC };
    const crew = rows.map((row) => {
      const r = row as Record<string, unknown>;
      return {
        role: String(r.role),
        displayName: String(r.display_name),
        checkedInAt: String(r.checked_in_at),
      };
    });
    return { ok: true, crew };
  } catch {
    return { ok: false, code: "UNAVAILABLE", message: GENERIC };
  }
}

export const getManagerActiveCrew = createServerFn({ method: "GET" })
  .validator(managerActiveCrewInputSchema)
  .handler(async ({ data }): Promise<ManagerActiveCrewResult> => {
    const client = getAnonAuthedSupabaseClient(data.accessToken);
    if (!client) return { ok: false, code: "UNAVAILABLE", message: GENERIC };
    return getManagerActiveCrewCore({ managerToken: data.managerToken }, async (fn, params) =>
      client.rpc(fn, params),
    );
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/manager-dashboard-server.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/manager-dashboard.server.ts tests/manager-dashboard-server.test.ts
git commit -m "feat(manager): add snapshot and active-crew server functions"
```

---

## Task 9: Manager reminder logic (pure, >2h only)

**Files:**
- Create: `src/lib/manager-reminder.ts`
- Test: `tests/manager-reminder.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/manager-reminder.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { buildStaleReminders, rotateIndex, TWO_HOURS_MS } from "../src/lib/manager-reminder";
import type { TableOccupancyRow } from "../src/lib/table-occupancy.server";

const HOUR = 3_600_000;
function row(n: number, occupiedAtMs: number | null): TableOccupancyRow {
  return {
    tableNumber: n,
    status: occupiedAtMs === null ? "kosong" : "terisi",
    occupiedAt: occupiedAtMs === null ? null : new Date(occupiedAtMs).toISOString(),
    occupiedSource: null,
    escortIntentId: null,
    escortIntentExpiresAt: null,
    escortIntentMine: false,
  };
}

describe("buildStaleReminders", () => {
  const now = 1_000_000_000_000;
  it("includes only tables occupied > 2h, longest first", () => {
    const lines = buildStaleReminders(
      [row(49, now - (2 * HOUR + 37 * 60_000)), row(5, now - HOUR), row(12, now - 3 * HOUR)],
      now,
    );
    expect(lines).toEqual([
      "MEJA 12 | >3 JAM | PERLU DI CEK",
      "MEJA 49 | >2 JAM 37 MENIT | PERLU DI CEK",
    ]);
  });
  it("returns empty when nothing exceeds 2h", () => {
    expect(buildStaleReminders([row(1, now - TWO_HOURS_MS)], now)).toEqual([]);
  });
  it("ignores empty tables", () => {
    expect(buildStaleReminders([row(1, null)], now)).toEqual([]);
  });
});

describe("rotateIndex", () => {
  it("cycles within bounds and is 0 for an empty list", () => {
    expect(rotateIndex(0, 5)).toBe(0);
    expect(rotateIndex(3, 0)).toBe(0);
    expect(rotateIndex(3, 1)).toBe(1);
    expect(rotateIndex(3, 3)).toBe(0);
    expect(rotateIndex(3, 4)).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/manager-reminder.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`src/lib/manager-reminder.ts`:
```ts
// Pure reminder logic for the manager dashboard. Reuses the proven client-side
// occupied-duration helpers from clear-up-queue.ts (zero server/DB cost). Only
// tables occupied MORE THAN 2 hours are surfaced; the caller rotates the list
// every 7s when there is more than one line.
import { formatOccupiedDuration, sortedOccupiedTables } from "./clear-up-queue";
import type { TableOccupancyRow } from "./table-occupancy.server";

export const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

export function buildStaleReminders(
  tables: readonly TableOccupancyRow[],
  nowMs: number,
): string[] {
  return sortedOccupiedTables(tables, nowMs)
    .filter((entry) => entry.durationMs > TWO_HOURS_MS)
    .map((entry) => `MEJA ${entry.tableNumber} | >${formatOccupiedDuration(entry.durationMs).toUpperCase()} | PERLU DI CEK`);
}

export function rotateIndex(length: number, tick: number): number {
  if (length <= 0) return 0;
  return ((tick % length) + length) % length;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/manager-reminder.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/manager-reminder.ts tests/manager-reminder.test.ts
git commit -m "feat(manager): add pure >2h reminder lines and rotation index"
```

---

## Task 10: Crew-active grouping + WIB time (pure)

**Files:**
- Create: `src/lib/manager-crew-groups.ts`
- Test: `tests/manager-crew-groups.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/manager-crew-groups.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { groupActiveCrewByStation, formatWibClock } from "../src/lib/manager-crew-groups";
import type { ActiveCrewRow } from "../src/lib/manager-dashboard.server";

describe("formatWibClock", () => {
  it("renders HH:MM:SS WIB from an ISO instant (UTC+7)", () => {
    expect(formatWibClock("2026-09-04T10:00:12Z")).toBe("17:00:12 WIB");
  });
});

describe("groupActiveCrewByStation", () => {
  it("groups by station in fixed order, dropping empty stations", () => {
    const rows: ActiveCrewRow[] = [
      { role: "clear_up", displayName: "Dadan", checkedInAt: "2026-09-04T10:00:00Z" },
      { role: "kasir", displayName: "Rina", checkedInAt: "2026-09-04T09:00:00Z" },
      { role: "kasir", displayName: "Sari", checkedInAt: "2026-09-04T09:30:00Z" },
    ];
    const groups = groupActiveCrewByStation(rows);
    expect(groups.map((g) => g.label)).toEqual(["SELF SERVICE", "KASIR", "SATGAS", "CLEAR UP"]);
    expect(groups[1].members.map((m) => m.displayName)).toEqual(["Rina", "Sari"]);
    expect(groups[0].members).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/manager-crew-groups.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`src/lib/manager-crew-groups.ts`:
```ts
// Pure grouping for the manager "CREW AKTIF" view: bucket active crew by
// station in a fixed display order, and format the check-in instant as a
// WIB wall-clock string. No server/DB work; operates on getManagerActiveCrew rows.
import type { ActiveCrewRow } from "./manager-dashboard.server";

const STATIONS: { role: string; label: string }[] = [
  { role: "ss", label: "SELF SERVICE" },
  { role: "kasir", label: "KASIR" },
  { role: "satgas", label: "SATGAS" },
  { role: "clear_up", label: "CLEAR UP" },
];

export type CrewStationGroup = { label: string; members: ActiveCrewRow[] };

export function groupActiveCrewByStation(rows: readonly ActiveCrewRow[]): CrewStationGroup[] {
  return STATIONS.map(({ role, label }) => ({
    label,
    members: rows.filter((r) => r.role === role),
  }));
}

export function formatWibClock(iso: string): string {
  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "--:--:-- WIB";
  const wib = new Date(ms + 7 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(wib.getUTCHours())}:${p(wib.getUTCMinutes())}:${p(wib.getUTCSeconds())} WIB`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/manager-crew-groups.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/manager-crew-groups.ts tests/manager-crew-groups.test.ts
git commit -m "feat(manager): add crew station grouping and WIB clock helpers"
```

---

## Task 11: Generalize the realtime hook bind RPC

**Files:**
- Modify: `src/hooks/use-table-occupancy-realtime.ts`
- Test: `tests/manager-realtime-hook.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/manager-realtime-hook.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { createTableOccupancyRealtimeController } from "../src/hooks/use-table-occupancy-realtime";

describe("realtime controller bind rpc", () => {
  it("defaults to the crew bind rpc", async () => {
    let called = "";
    const client = {
      rpc: async (fn: string) => {
        called = fn;
        return { data: true, error: null };
      },
      channel: () => ({ on: () => ({ subscribe: () => undefined }) }),
      removeChannel: () => undefined,
    };
    createTableOccupancyRealtimeController({
      client: client as never,
      restaurantId: "r-1",
      sessionToken: "tok",
      refetch: () => undefined,
    });
    expect(called).toBe("bind_role_session_realtime");
  });
  it("uses the manager bind rpc when provided", async () => {
    let called = "";
    const client = {
      rpc: async (fn: string) => {
        called = fn;
        return { data: true, error: null };
      },
      channel: () => ({ on: () => ({ subscribe: () => undefined }) }),
      removeChannel: () => undefined,
    };
    createTableOccupancyRealtimeController({
      client: client as never,
      restaurantId: "r-1",
      sessionToken: "tok",
      refetch: () => undefined,
      bindRpc: "bind_manager_session_realtime",
    });
    expect(called).toBe("bind_manager_session_realtime");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/manager-realtime-hook.test.ts`
Expected: FAIL — `bindRpc` not accepted / wrong rpc name.

- [ ] **Step 3: Write minimal implementation**

In `src/hooks/use-table-occupancy-realtime.ts`:
- Add `bindRpc = "bind_role_session_realtime"` to the controller params object (after `onNotice`), typed `bindRpc?: string`.
- Replace the hardcoded RPC name in the bind call:
```ts
    void client
      .rpc(bindRpc, {
        p_restaurant_id: restaurantId,
        p_session_token: sessionToken,
      })
```
- In `useTableOccupancyRealtime`, add an optional trailing param `bindRpc?: string` and pass it through to the controller. Keep all existing positional params unchanged so crew callers are unaffected.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/manager-realtime-hook.test.ts tests/table-occupancy-realtime.test.ts`
Expected: PASS (new tests + existing realtime tests still green).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/use-table-occupancy-realtime.ts tests/manager-realtime-hook.test.ts
git commit -m "feat(realtime): allow a custom bind rpc for manager subscriptions"
```

---

## Task 12: Manager layout shell (sidebar + footer)

**Files:**
- Create: `src/components/ManagerLayout.tsx`
- Test: `tests/manager-layout.test.ts`

- [ ] **Step 1: Write the failing test (source contract)**

`tests/manager-layout.test.ts`:
```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = () =>
  readFileSync(new URL("../src/components/ManagerLayout.tsx", import.meta.url), "utf8");

describe("ManagerLayout", () => {
  it("renders the three sidebar menus", () => {
    const text = source();
    expect(text).toContain("LIHAT STATUS MEJA LIVE");
    expect(text).toContain("LIHAT CREW AKTIF");
    expect(text).toContain("LOG AKTIVITAS CREW");
  });
  it("renders the footer branding", () => {
    const text = source();
    expect(text).toContain("lihatmeja.com (c)2026");
    expect(text).toContain("XDIRGA LABS");
  });
  it("is responsive (mobile drawer + desktop rail)", () => {
    const text = source();
    expect(text).toContain("md:hidden");
    expect(text).toContain("hidden md:");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/manager-layout.test.ts`
Expected: FAIL — file not found.

- [ ] **Step 3: Write minimal implementation**

`src/components/ManagerLayout.tsx`:
```tsx
import { useState, type ReactNode } from "react";
import { Menu, Table2, Users, ScrollText, X } from "lucide-react";

export type ManagerMenu = "tables" | "crew" | "log";

const MENU: { id: ManagerMenu; label: string; icon: typeof Table2 }[] = [
  { id: "tables", label: "LIHAT STATUS MEJA LIVE", icon: Table2 },
  { id: "crew", label: "LIHAT CREW AKTIF", icon: Users },
  { id: "log", label: "LOG AKTIVITAS CREW", icon: ScrollText },
];

function NavList({
  active,
  onSelect,
}: {
  active: ManagerMenu;
  onSelect: (m: ManagerMenu) => void;
}) {
  return (
    <nav className="flex flex-col gap-1">
      {MENU.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          aria-current={active === id ? "page" : undefined}
          onClick={() => onSelect(id)}
          className={`flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-bold transition ${
            active === id
              ? "bg-slate-900 text-white"
              : "text-slate-600 hover:bg-slate-100"
          }`}
        >
          <Icon className="size-[18px] shrink-0" />
          <span className="truncate">{label}</span>
        </button>
      ))}
    </nav>
  );
}

export function ManagerLayout({
  restaurantCode,
  restaurantName,
  active,
  onSelect,
  header,
  children,
}: {
  restaurantCode: string;
  restaurantName: string;
  active: ManagerMenu;
  onSelect: (m: ManagerMenu) => void;
  header: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pick = (m: ManagerMenu) => {
    onSelect(m);
    setOpen(false);
  };
  return (
    <div className="min-h-[100svh] bg-slate-50 text-slate-950">
      <div className="md:flex">
        <button
          type="button"
          aria-label="Buka menu"
          onClick={() => setOpen(true)}
          className="fixed bottom-4 left-4 z-40 flex size-12 items-center justify-center rounded-full bg-slate-900 text-white shadow-lg md:hidden"
        >
          <Menu className="size-6" />
        </button>

        {open && (
          <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true">
            <button
              type="button"
              aria-label="Tutup menu"
              className="absolute inset-0 bg-slate-900/40"
              onClick={() => setOpen(false)}
            />
            <div className="absolute inset-y-0 left-0 flex w-72 flex-col bg-white p-4 shadow-xl">
              <div className="mb-4 flex items-center justify-between">
                <span className="text-sm font-black uppercase">Manager</span>
                <button type="button" aria-label="Tutup" onClick={() => setOpen(false)}>
                  <X className="size-5" />
                </button>
              </div>
              <NavList active={active} onSelect={pick} />
            </div>
          </div>
        )}

        <aside className="hidden w-72 shrink-0 flex-col border-r border-slate-200 bg-white p-4 md:flex">
          <p className="mb-4 px-3 text-sm font-black uppercase tracking-wide text-slate-900">
            Dashboard Manager
          </p>
          <NavList active={active} onSelect={pick} />
          <div className="mt-auto border-t border-slate-100 pt-4 text-center">
            <p className="text-sm font-extrabold uppercase text-slate-900">
              MIE GACOAN {restaurantCode}
            </p>
            <p className="mt-1 text-[11px] font-semibold text-slate-500">{restaurantName}</p>
            <p className="mt-2 text-[11px] text-slate-400">lihatmeja.com (c)2026</p>
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
              XDIRGA LABS
            </p>
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          {header}
          <div className="mx-auto max-w-4xl px-4 py-5 sm:px-6">{children}</div>
          <footer className="px-4 pb-8 pt-2 text-center text-[11px] text-slate-400 md:hidden">
            <p className="font-extrabold uppercase text-slate-600">MIE GACOAN {restaurantCode}</p>
            <p>lihatmeja.com (c)2026 · XDIRGA LABS</p>
          </footer>
        </main>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/manager-layout.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/ManagerLayout.tsx tests/manager-layout.test.ts
git commit -m "feat(manager): add responsive sidebar layout shell with footer branding"
```

---

## Task 13: Manager login + register routes

**Files:**
- Create: `src/routes/manager/login.tsx`
- Create: `src/routes/manager/register.tsx`
- Test: `tests/manager-auth-routes.test.ts`

- [ ] **Step 1: Write the failing test (source contract)**

`tests/manager-auth-routes.test.ts`:
```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("manager login route", () => {
  const text = () => read("../src/routes/manager/login.tsx");
  it("collects ID Manager + Password and links to register", () => {
    expect(text()).toContain("ID Manager");
    expect(text()).toContain("Password");
    expect(text()).toContain("membuat ID MANAGER BARU");
    expect(text()).toContain("loginManager");
  });
  it("redirects to the dashboard only after a successful login", () => {
    expect(text()).toContain('navigate({ to: "/manager" })');
    expect(text()).toContain("writeManagerIdentity");
  });
});

describe("manager register route", () => {
  const text = () => read("../src/routes/manager/register.tsx");
  it("collects the required fields and auto-shows the resto name", () => {
    expect(text()).toContain("Nama Lengkap");
    expect(text()).toContain("ID Manager");
    expect(text()).toContain("Kode Resto");
    expect(text()).toContain("Ketik Ulang");
    expect(text()).toContain("loginToRestaurant");
  });
  it("redirects to login after submit, never to the dashboard", () => {
    expect(text()).toContain('navigate({ to: "/manager/login" })');
    expect(text()).not.toContain('navigate({ to: "/manager" })');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/manager-auth-routes.test.ts`
Expected: FAIL — files not found.

- [ ] **Step 3: Write minimal implementation**

`src/routes/manager/login.tsx`:
```tsx
import { useState, type FormEvent } from "react";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { loginManager } from "@/lib/manager-auth.server";
import { ensureAnonAccessToken, getSupabaseBrowserClient } from "@/lib/supabase-browser";
import {
  browserManagerStorage,
  writeManagerIdentity,
} from "@/lib/manager-session-identity";

export const Route = createFileRoute("/manager/login")({
  head: () => ({ meta: [{ title: "Login Manager - LIME" }, { name: "robots", content: "noindex" }] }),
  component: ManagerLoginPage,
});

function ManagerLoginPage() {
  const navigate = useNavigate();
  const [idManager, setIdManager] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const accessToken = await ensureAnonAccessToken(getSupabaseBrowserClient());
      if (!accessToken) {
        setError("Gagal memulai sesi. Coba lagi.");
        return;
      }
      const result = await loginManager({ data: { idManager, password } });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      writeManagerIdentity(browserManagerStorage(), {
        idManager: result.idManager,
        fullName: result.fullName,
        restaurantId: result.restaurantId,
        restaurantDisplayName: result.restaurantDisplayName,
        restaurantCode: result.restaurantCode,
        managerToken: result.managerToken,
        accessToken,
      });
      void navigate({ to: "/manager" });
    } catch {
      setError("Login gagal.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-[100svh] items-center justify-center bg-white px-4 py-10">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-xl">
        <img src="/lime-logo.webp" alt="LIME" className="mx-auto h-14 w-auto" />
        <h1 className="mt-4 text-center text-2xl font-black text-slate-900">Login Manager</h1>
        <form className="mt-6 space-y-4" onSubmit={submit}>
          <label className="block text-sm font-bold text-slate-700" htmlFor="mgr-id">ID Manager</label>
          <Input id="mgr-id" value={idManager} onChange={(e) => setIdManager(e.target.value)} required autoFocus className="h-12 rounded-xl" />
          <label className="block text-sm font-bold text-slate-700" htmlFor="mgr-pw">Password</label>
          <Input id="mgr-pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required className="h-12 rounded-xl" />
          {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600">{error}</p>}
          <button type="submit" disabled={busy} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-slate-900 text-sm font-extrabold uppercase text-white disabled:opacity-60">
            {busy && <Loader2 className="size-4 animate-spin" />}
            {busy ? "Memeriksa..." : "Login"}
          </button>
        </form>
        <p className="mt-6 text-center text-sm">
          <Link to="/manager/register" className="font-bold text-cyan-700 underline">
            KLIK DISINI untuk membuat ID MANAGER BARU
          </Link>
        </p>
      </div>
    </main>
  );
}
```

`src/routes/manager/register.tsx`:
```tsx
import { useState, type FormEvent } from "react";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { registerManager } from "@/lib/manager-auth.server";
import { loginToRestaurant } from "@/lib/restaurants.server";

export const Route = createFileRoute("/manager/register")({
  head: () => ({ meta: [{ title: "Daftar Manager - LIME" }, { name: "robots", content: "noindex" }] }),
  component: ManagerRegisterPage,
});

function ManagerRegisterPage() {
  const navigate = useNavigate();
  const [fullName, setFullName] = useState("");
  const [idManager, setIdManager] = useState("");
  const [code, setCode] = useState("");
  const [restoName, setRestoName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function lookupResto() {
    if (!code.trim()) { setRestoName(""); return; }
    try {
      const result = await loginToRestaurant({ data: { code } });
      setRestoName("error" in result ? "" : result.displayName);
    } catch {
      setRestoName("");
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (password.length < 8) { setError("Password minimal 8 karakter."); return; }
    if (password !== confirm) { setError("Ketik ulang password tidak cocok."); return; }
    setBusy(true);
    try {
      const result = await registerManager({
        data: { idManager: idManager.trim().toLowerCase(), fullName: fullName.trim(), restaurantCode: code.trim(), password },
      });
      if (!result.ok) {
        setError(
          result.code === "ID_MANAGER_TAKEN"
            ? "ID Manager sudah dipakai."
            : result.code === "RESTAURANT_NOT_FOUND"
              ? "Kode Resto tidak ditemukan."
              : "Pendaftaran gagal. Coba lagi.",
        );
        return;
      }
      void navigate({ to: "/manager/login" });
    } catch {
      setError("Pendaftaran gagal. Coba lagi.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-[100svh] items-center justify-center bg-white px-4 py-10">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-xl">
        <h1 className="text-center text-2xl font-black text-slate-900">Buat ID MANAGER BARU</h1>
        <form className="mt-6 space-y-4" onSubmit={submit}>
          <label className="block text-sm font-bold text-slate-700" htmlFor="r-name">Nama Lengkap</label>
          <Input id="r-name" value={fullName} onChange={(e) => setFullName(e.target.value)} required className="h-12 rounded-xl" />
          <label className="block text-sm font-bold text-slate-700" htmlFor="r-id">ID Manager</label>
          <Input id="r-id" value={idManager} onChange={(e) => setIdManager(e.target.value)} required className="h-12 rounded-xl" />
          <label className="block text-sm font-bold text-slate-700" htmlFor="r-code">Kode Resto</label>
          <Input id="r-code" value={code} onChange={(e) => setCode(e.target.value)} onBlur={lookupResto} required className="h-12 rounded-xl" />
          {restoName && <p className="text-sm font-semibold text-cyan-700">{restoName}</p>}
          <label className="block text-sm font-bold text-slate-700" htmlFor="r-pw">Password</label>
          <Input id="r-pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required className="h-12 rounded-xl" />
          <label className="block text-sm font-bold text-slate-700" htmlFor="r-confirm">Ketik Ulang Password</label>
          <Input id="r-confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required className="h-12 rounded-xl" />
          {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600">{error}</p>}
          <button type="submit" disabled={busy} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-slate-900 text-sm font-extrabold uppercase text-white disabled:opacity-60">
            {busy && <Loader2 className="size-4 animate-spin" />}
            {busy ? "Menyimpan..." : "Submit"}
          </button>
        </form>
        <p className="mt-6 text-center text-sm">
          <Link to="/manager/login" className="font-bold text-cyan-700 underline">Kembali ke Login Manager</Link>
        </p>
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/manager-auth-routes.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/routes/manager/login.tsx src/routes/manager/register.tsx tests/manager-auth-routes.test.ts
git commit -m "feat(manager): add login and register routes"
```

---

## Task 14: Manager dashboard route (3 menus + reminder + log)

**Files:**
- Create: `src/routes/manager/index.tsx`
- Test: `tests/manager-dashboard-route.test.ts`

- [ ] **Step 1: Write the failing test (source contract)**

`tests/manager-dashboard-route.test.ts`:
```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const text = () => readFileSync(new URL("../src/routes/manager/index.tsx", import.meta.url), "utf8");

describe("manager dashboard route", () => {
  it("guards with the manager identity and redirects to login", () => {
    expect(text()).toContain("readManagerIdentity");
    expect(text()).toContain('navigate({ to: "/manager/login" })');
  });
  it("reuses CrewHeader + realtime notices", () => {
    expect(text()).toContain("CrewHeader");
    expect(text()).toContain("useTableOccupancyRealtime");
    expect(text()).toContain("bind_manager_session_realtime");
  });
  it("renders the reminder + log + crew views", () => {
    expect(text()).toContain("buildStaleReminders");
    expect(text()).toContain("groupActiveCrewByStation");
    expect(text()).toContain("PERLU DI CEK");
  });
  it("accumulates a name-less activity log from notices", () => {
    expect(text()).toContain("formatOccupancyNotice");
    expect(text()).toContain("roleLabel");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/manager-dashboard-route.test.ts`
Expected: FAIL — file not found.

- [ ] **Step 3: Write minimal implementation**

`src/routes/manager/index.tsx`:
```tsx
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { CrewHeader } from "@/components/CrewHeader";
import { ManagerLayout, type ManagerMenu } from "@/components/ManagerLayout";
import { OwnerEmpty, OwnerNotice, OwnerRetry } from "@/components/OwnerUi";
import {
  browserManagerStorage,
  readManagerIdentity,
  removeManagerIdentity,
  type ManagerIdentity,
} from "@/lib/manager-session-identity";
import { getManagerSnapshot, getManagerActiveCrew } from "@/lib/manager-dashboard.server";
import { useTableOccupancyRealtime } from "@/hooks/use-table-occupancy-realtime";
import { useNoticeQueue } from "@/hooks/use-notice-queue";
import { formatOccupancyNotice, type OccupancyNotice } from "@/lib/occupancy-notice";
import { buildStaleReminders, rotateIndex } from "@/lib/manager-reminder";
import { groupActiveCrewByStation, formatWibClock } from "@/lib/manager-crew-groups";
import { getLiveAccessToken, getSupabaseBrowserClient } from "@/lib/supabase-browser";

export const Route = createFileRoute("/manager/")({
  head: () => ({ meta: [{ title: "Dashboard Manager - LIME" }, { name: "robots", content: "noindex" }] }),
  component: ManagerDashboard,
});

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

function snapshotKey(id: string) {
  return ["manager-snapshot", id] as const;
}

function ManagerDashboard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [identity, setIdentity] = useState<ManagerIdentity | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [menu, setMenu] = useState<ManagerMenu>("tables");
  const [now, setNow] = useState(() => Date.now());
  const [tick, setTick] = useState(0);
  const [log, setLog] = useState<OccupancyNotice[]>([]);
  const notices = useNoticeQueue();

  useEffect(() => {
    const stored = readManagerIdentity(browserManagerStorage());
    if (!stored) {
      void navigate({ to: "/manager/login" });
      return;
    }
    setIdentity(stored);
    setHydrated(true);
  }, [navigate]);

  // 1s tick recomputes reminder ages locally; 7s tick rotates the reminder line.
  useEffect(() => {
    const a = setInterval(() => setNow(Date.now()), 1_000);
    const b = setInterval(() => setTick((t) => t + 1), 7_000);
    return () => {
      clearInterval(a);
      clearInterval(b);
    };
  }, []);

  const restaurantId = identity?.restaurantId ?? "";
  const snapshot = useQuery({
    queryKey: snapshotKey(restaurantId),
    queryFn: async () =>
      getManagerSnapshot({
        data: {
          managerToken: identity!.managerToken,
          accessToken: await getLiveAccessToken(getSupabaseBrowserClient(), identity!.accessToken),
        },
      }),
    enabled: Boolean(identity),
    refetchOnWindowFocus: true,
  });
  const crew = useQuery({
    queryKey: ["manager-crew", restaurantId],
    queryFn: async () =>
      getManagerActiveCrew({
        data: {
          managerToken: identity!.managerToken,
          accessToken: await getLiveAccessToken(getSupabaseBrowserClient(), identity!.accessToken),
        },
      }),
    enabled: Boolean(identity) && menu === "crew",
  });

  const realtimeStatus = useTableOccupancyRealtime(
    restaurantId,
    identity?.managerToken ?? "",
    snapshot.data?.ok ? snapshot.data.revision : null,
    () => {
      void queryClient.invalidateQueries({ queryKey: snapshotKey(restaurantId) });
    },
    null,
    (broadcast) => {
      const notice = formatOccupancyNotice(broadcast);
      if (notice) {
        notices.push(notice);
        setLog((prev) => [notice, ...prev].slice(0, 100));
      }
    },
    "bind_manager_session_realtime",
  );

  const reminders = useMemo(() => {
    const tables = snapshot.data && snapshot.data.ok ? snapshot.data.tables : [];
    return buildStaleReminders(tables, now);
  }, [snapshot.data, now]);
  const reminder = reminders.length ? reminders[rotateIndex(reminders.length, tick)] : "";

  const logout = () => {
    removeManagerIdentity(browserManagerStorage());
    void navigate({ to: "/manager/login" });
  };

  if (!hydrated || !identity) return null;

  const tables = snapshot.data && snapshot.data.ok ? snapshot.data.tables : [];

  return (
    <ManagerLayout
      restaurantCode={identity.restaurantCode}
      restaurantName={identity.restaurantDisplayName}
      active={menu}
      onSelect={setMenu}
      header={
        <CrewHeader
          role="Manager"
          restaurantName={identity.restaurantDisplayName}
          restaurantCode={identity.restaurantCode}
          userName={identity.fullName}
          onLogout={logout}
          notice={notices.current}
        />
      }
    >
      {realtimeStatus !== "SUBSCRIBED" && (
        <OwnerNotice role="status" tone="warning">
          Menunggu koneksi realtime -- data tetap diperbarui otomatis.
        </OwnerNotice>
      )}

      {reminder && (
        <div className="mb-4 overflow-hidden rounded-xl bg-red-600 px-3 py-2 text-white">
          <p className="truncate text-sm font-extrabold uppercase tracking-wide">{reminder}</p>
        </div>
      )}

      {menu === "tables" && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-center gap-4 text-[11px] font-bold uppercase">
            <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-emerald-500" />Kosong</span>
            <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-red-500" />Terisi</span>
          </div>
          {snapshot.isLoading ? (
            <p className="text-sm text-slate-500">Memuat status meja...</p>
          ) : snapshot.isError || !snapshot.data || !snapshot.data.ok ? (
            <>
              <OwnerNotice role="alert" tone="danger">Status meja tidak dapat dimuat.</OwnerNotice>
              <div className="mt-3"><OwnerRetry onClick={() => snapshot.refetch()} /></div>
            </>
          ) : (
            <ul className="grid grid-cols-2 gap-2">
              {tables.map((t) => (
                <li key={t.tableNumber} className="rounded-xl border border-slate-100 px-4 py-3">
                  <span className={`text-sm font-extrabold uppercase ${t.status === "terisi" ? "text-red-600" : "text-emerald-600"}`}>
                    MEJA {t.tableNumber}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {menu === "crew" && (
        <section className="space-y-5">
          {crew.isLoading && <p className="text-sm text-slate-500">Memuat crew...</p>}
          {crew.data && crew.data.ok && (
            groupActiveCrewByStation(crew.data.crew).map((g) => (
              <div key={g.label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="mb-2 text-sm font-black uppercase text-slate-900">{g.label}</h3>
                {g.members.length === 0 ? (
                  <p className="text-xs text-slate-400">Tidak ada crew aktif.</p>
                ) : (
                  <table className="w-full text-left text-sm">
                    <thead><tr className="text-[11px] uppercase text-slate-400"><th className="py-1">Nama Crew</th><th className="py-1">Jam Masuk</th></tr></thead>
                    <tbody>
                      {g.members.map((m, i) => (
                        <tr key={`${m.displayName}-${i}`} className="border-t border-slate-100">
                          <td className="py-2 font-bold text-slate-800">{m.displayName}</td>
                          <td className="py-2 text-slate-600">{formatWibClock(m.checkedInAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            ))
          )}
        </section>
      )}

      {menu === "log" && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="mb-3 text-sm font-black uppercase text-slate-900">Log Aktivitas Crew</h3>
          {log.length === 0 ? (
            <OwnerEmpty title="Belum ada aktivitas" description="Aktivitas perubahan status meja akan muncul di sini selama halaman terbuka." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {log.map((n, i) => (
                <li key={`${n.line1}-${i}`} className="flex items-center justify-between py-2 text-sm">
                  <span className="font-bold uppercase text-slate-800">{n.line1}</span>
                  <span className="rounded-full bg-cyan-600 px-2 py-0.5 text-[10px] font-bold uppercase text-white">{n.roleLabel}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </ManagerLayout>
  );
}
```

Note: `TWO_HOURS_MS` is imported indirectly via `buildStaleReminders`; the local const above is unused — remove it if lint flags it (keep the one in `manager-reminder.ts`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/manager-dashboard-route.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/routes/manager/index.tsx tests/manager-dashboard-route.test.ts
git commit -m "feat(manager): add dashboard route with live tables, crew, and activity log"
```

---

## Task 15: Separated MANAGER button on the role-select screen

**Files:**
- Modify: `src/components/RoleLoginFlow.tsx`
- Test: `tests/manager-entry-button.test.ts`

- [ ] **Step 1: Write the failing test (source contract)**

`tests/manager-entry-button.test.ts`:
```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const text = () =>
  readFileSync(new URL("../src/components/RoleLoginFlow.tsx", import.meta.url), "utf8");

describe("manager entry button", () => {
  it("offers a separated MANAGER login above the crew area", () => {
    expect(text()).toContain("MANAGER");
    expect(text()).toContain('to="/manager/login"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/manager-entry-button.test.ts`
Expected: FAIL — no MANAGER entry.

- [ ] **Step 3: Write minimal implementation**

In `src/components/RoleLoginFlow.tsx`:
- Add `import { Link } from "@tanstack/react-router";` and `import { UserCog } from "lucide-react";`.
- Inside the `step === "code"` block, ABOVE the `<form>` (right after the "Masuk ke Resto" heading paragraph), insert a separated manager call-to-action:
```tsx
<div className="mb-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
  <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Khusus Pimpinan Shift</p>
  <Link
    to="/manager/login"
    className="mt-2 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-slate-900 text-sm font-extrabold uppercase tracking-wide text-white shadow-sm transition hover:bg-slate-700"
  >
    <UserCog className="size-4" /> Login MANAGER
  </Link>
</div>
```
- Leave the crew "Kode Resto" flow untouched below it.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/manager-entry-button.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/components/RoleLoginFlow.tsx tests/manager-entry-button.test.ts
git commit -m "feat(manager): add separated MANAGER login entry on role-select screen"
```

---

## Task 16: Super-admin Managers panel (list + disable)

**Files:**
- Create: `src/lib/admin-managers.server.ts`
- Create: `src/routes/super-admin/managers.tsx`
- Modify: `src/routes/super-admin/route.tsx` (nav entry)
- Test: `tests/admin-managers.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/admin-managers.test.ts`:
```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("admin-managers server fn", () => {
  const text = () =>
    readFileSync(new URL("../src/lib/admin-managers.server.ts", import.meta.url), "utf8");
  it("guards both actions behind requireSuperAdmin", () => {
    expect(text()).toContain("requireSuperAdmin");
    expect(text()).toContain("listManagers");
    expect(text()).toContain("disableManager");
  });
  it("disable sets status nonaktif and deletes live sessions", () => {
    expect(text()).toContain("status: \"nonaktif\"");
    expect(text()).toContain('from("manager_sessions")');
    expect(text()).toContain(".delete()");
  });
});

describe("super-admin managers route", () => {
  const text = () =>
    readFileSync(new URL("../src/routes/super-admin/managers.tsx", import.meta.url), "utf8");
  it("lists managers and offers a Nonaktifkan action", () => {
    expect(text()).toContain("listManagers");
    expect(text()).toContain("Nonaktifkan");
    expect(text()).toContain("disableManager");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/admin-managers.test.ts`
Expected: FAIL — files not found.

- [ ] **Step 3: Write minimal implementation**

`src/lib/admin-managers.server.ts`:
```ts
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSuperAdmin } from "./auth.server";
import { getServiceClient } from "./remote-audio.server";

export type AdminManagerRow = {
  id: string;
  idManager: string;
  fullName: string;
  restaurantId: string;
  restaurantName: string;
  restaurantCode: string;
  status: string;
  createdAt: string;
};

export const listManagers = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ ok: true; managers: AdminManagerRow[] } | { ok: false; error: string }> => {
    await requireSuperAdmin();
    const client = getServiceClient();
    if (!client) return { ok: false, error: "Tidak dapat memuat data manager." };
    const { data, error } = await client
      .from("manager_accounts")
      .select("id, id_manager, full_name, restaurant_id, status, created_at, restaurants(display_name, code)")
      .order("created_at", { ascending: false });
    if (error) return { ok: false, error: "Tidak dapat memuat data manager." };
    const managers = (data ?? []).map((row) => {
      const r = row as unknown as Record<string, unknown>;
      const resto = (r.restaurants ?? {}) as Record<string, unknown>;
      return {
        id: String(r.id),
        idManager: String(r.id_manager),
        fullName: String(r.full_name),
        restaurantId: String(r.restaurant_id),
        restaurantName: String(resto.display_name ?? ""),
        restaurantCode: String(resto.code ?? ""),
        status: String(r.status),
        createdAt: String(r.created_at),
      };
    });
    return { ok: true, managers };
  },
);

export const disableManager = createServerFn({ method: "POST" })
  .validator(z.object({ managerId: z.string().uuid() }))
  .handler(async ({ data }): Promise<{ ok: boolean; error?: string }> => {
    await requireSuperAdmin();
    const client = getServiceClient();
    if (!client) return { ok: false, error: "Tidak dapat mengubah data manager." };
    const { error: sessionError } = await client
      .from("manager_sessions")
      .delete()
      .eq("manager_id", data.managerId);
    if (sessionError) return { ok: false, error: "Tidak dapat mengubah data manager." };
    const { error } = await client
      .from("manager_accounts")
      .update({ status: "nonaktif", updated_at: new Date().toISOString() })
      .eq("id", data.managerId);
    if (error) return { ok: false, error: "Tidak dapat mengubah data manager." };
    return { ok: true };
  });
```

`src/routes/super-admin/managers.tsx`:
```tsx
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { disableManager, listManagers } from "@/lib/admin-managers.server";

export const Route = createFileRoute("/super-admin/managers")({
  head: () => ({ meta: [{ title: "Manager - Owner Console" }] }),
  component: ManagersPage,
});

function ManagersPage() {
  const queryClient = useQueryClient();
  const managers = useQuery({ queryKey: ["owner", "managers"], queryFn: () => listManagers() });
  const disable = useMutation({
    mutationFn: (id: string) => disableManager({ data: { managerId: id } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["owner", "managers"] }),
  });

  return (
    <div>
      <h1 className="text-xl font-black">Manager</h1>
      <p className="mt-1 text-sm text-slate-500">Audit akun manager per restoran.</p>
      {managers.isLoading && <p className="mt-4 text-sm">Memuat...</p>}
      {managers.data && managers.data.ok && managers.data.managers.length === 0 && (
        <p className="mt-4 text-sm text-slate-400">Belum ada manager terdaftar.</p>
      )}
      {managers.data && managers.data.ok && (
        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase text-slate-500">
              <tr><th className="px-3 py-2">Nama</th><th className="px-3 py-2">ID Manager</th><th className="px-3 py-2">Resto</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Aksi</th></tr>
            </thead>
            <tbody>
              {managers.data.managers.map((m) => (
                <tr key={m.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-bold">{m.fullName}</td>
                  <td className="px-3 py-2">{m.idManager}</td>
                  <td className="px-3 py-2">{m.restaurantCode}</td>
                  <td className="px-3 py-2">
                    <span className={m.status === "aktif" ? "text-emerald-600 font-bold" : "text-slate-400 font-bold"}>{m.status}</span>
                  </td>
                  <td className="px-3 py-2">
                    {m.status === "aktif" && (
                      <button
                        type="button"
                        onClick={() => disable.mutate(m.id)}
                        className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-bold text-red-600 hover:bg-red-100"
                      >
                        Nonaktifkan
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

In `src/routes/super-admin/route.tsx`:
- Add `Users` to the `lucide-react` import.
- Add a nav entry to the `nav` array (after "Restoran"):
```ts
  { label: "Manager", to: "/super-admin/managers", icon: Users, exact: false },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/admin-managers.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/admin-managers.server.ts src/routes/super-admin/managers.tsx src/routes/super-admin/route.tsx tests/admin-managers.test.ts
git commit -m "feat(manager): add super-admin managers panel with disable action"
```

---

## Task 17: Full quality gate + route tree regeneration

**Files:** none new (validation).

- [ ] **Step 1: Regenerate the route tree**

Run: `npx tsr generate` (or the repo's route-gen step; if the router plugin regenerates on build, skip). Confirm `src/routeTree.gen.ts` (or equivalent) now includes `/manager`, `/manager/login`, `/manager/register`, `/super-admin/managers`.

- [ ] **Step 2: Run the full verify gate**

Run: `npm run verify`
Expected: exit 0 (test + typecheck + lint + build). Fix any lint/type/build issues (prettier CRLF, unused `TWO_HOURS_MS` in Task 14, etc.) before proceeding.

- [ ] **Step 3: Commit any gate fixes**

```bash
git add -A
git commit -m "chore(manager): satisfy verify gate (route tree, lint, types)"
```

---

## Task 18: Apply migrations to staging + smoke (manual, with go-ahead)

**Files:** none (operational).

- [ ] **Step 1: Confirm go-ahead from the user** before touching the staging DB (kjzxtmxdbcanvkgqqdow). Migrations are additive (new tables/RPCs + one `create or replace` of `can_read_table_occupancy_broadcast`); CI `db-reset` replays them from the repo filenames.

- [ ] **Step 2: Apply the four new migrations** via the Supabase MCP in filename order:
`20260904110000_manager_accounts.sql`, `20260904111000_manager_auth.sql`, `20260904112000_manager_realtime_binding.sql`, `20260904113000_manager_reads.sql`.

- [ ] **Step 3: Smoke test (BEGIN/ROLLBACK, no residue)**
- `register_manager('smokemgr','Smoke','<a real active code>','deadbeef:...')` → true.
- `get_manager_credential('smokemgr')` → returns the row.
- `create_manager_session(<id>)` → returns a token.
- `get_manager_snapshot(<token>)` → `{revision, tables:[...]}`.
- `get_manager_active_crew(<token>)` → rows.
- `bind_manager_session_realtime(<restaurant>, <token>)` → true.
- Rollback.

- [ ] **Step 4: Deploy** — push to `main`; verify Vercel `lihat-meja` READY (`vercel ls lihat-meja --json`) and CI `db-reset` green.

---

## Self-Review Notes

- **Spec coverage:** auth (T1–T3, T7), register→login redirect (T13), status column + disable revokes sessions (T2, T16), realtime manager join (T4, T11), 3 menus + reminder + log (T9, T10, T14), separated MANAGER button (T15), super-admin panel (T16), footer branding (T12). All spec sections map to a task.
- **Deferred (correctly out of scope):** activation/approval, Enable button, persisted history (Option Y), multi-resto managers.
- **Type consistency:** `ManagerIdentity` (T6) fields match what `loginManagerCore` returns (T7) and what the dashboard reads (T14). `TableOccupancyRow` (T8) matches `buildStaleReminders` input (T9). `ActiveCrewRow` (T8) matches `groupActiveCrewByStation` (T10). `bindRpc` param (T11) is the 7th positional arg used by the dashboard (T14).
- **Watch-outs:** remove the unused local `TWO_HOURS_MS` in T14 if lint complains; run prettier after PowerShell edits; the route tree must regenerate before `build` passes.
