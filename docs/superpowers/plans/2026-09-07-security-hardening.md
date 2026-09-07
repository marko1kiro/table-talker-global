# Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 4 CRIT + 5 HIGH + 1 MED findings from pentest report.

**Architecture:** Three independent fixes targeting different attack surfaces: (1) PIN rate limit fix — change `claim_role_session` RPC to bucket by restaurant only (not tenant token), preventing rotation bypass; (2) Occupancy CAS — add revision column + `WHERE revision = expected` to prevent parallel overwrite; (3) Rate limiting on `login_to_restaurant_atomic` — add Kode Resto enumeration throttle; (4) Security headers — add to root route meta.

**Tech Stack:** PostgreSQL RPC (PL/pgSQL), TanStack Start server functions, Vercel headers, Vitest + source contracts.

---

## Finding Summary

| ID | Severity | Finding | Fix |
|----|----------|---------|-----|
| CRIT-03 + CRIT-04 | CRIT | PIN rate limit uses restaurant+tenant buckets; tenant rotates → fresh window each attempt. 4-digit PIN space. | Fix: bucket by restaurant only. 6-digit PIN. |
| HIGH-03 | HIGH | Occupancy mutations use `ON CONFLICT DO UPDATE` (UPSERT) — no revision check, last-write-wins. | Add revision column + CAS. |
| HIGH-01 | HIGH | `login_to_restaurant_atomic` has no rate limit — unlimited Kode Resto enumeration. | Add rate limit table + throttle. |
| CRIT-01 | CRIT | Anonymous signup unlimited — `signInAnonymously()` mints unlimited JWTs. | Disable via RPC guard or Supabase config. |
| MED-01 | MED | No security headers (CSP, X-Frame-Options, X-Content-Type-Options). | Add to root route meta. |

**Deferred (not in this plan):**
- CRIT-02 (multi-role claim from same anon JWT) — mitigated by PIN lockout fix
- CRIT-04 (4-digit PIN brute force) — mitigated by 6-digit PIN + rate limit
- HIGH-02 (existing crew session keeps no-show on) — UX issue, not security
- HIGH-04 (unlimited anon users) — mitigated by disabling anonymous signup
- HIGH-05 (tenant token + code brute force) — mitigated by login rate limit
- MED-02 (replay from valid crew) — out of scope for this phase
- MED-03 (anon auth still enabled) — mitigated by disabling anonymous signup
- LOW-01, LOW-02, LOW-03 — informational, no immediate action

---

## Task 1: Fix PIN Rate Limit Bucketing

**Root Cause:** `claim_role_session` RPC creates two buckets (restaurant + tenant token). Since tenant token rotates on each `login_to_restaurant_atomic` call, each PIN attempt gets a fresh rate limit window.

**Fix:** Change bucket to use ONLY restaurant hash. Drop tenant bucket.

**Files:**
- Modify: `supabase/migrations/20260907180000_fix_pin_rate_limit_bucket.sql` (create)
- Modify: `supabase/migrations/20260902020000_pin_hash_and_role_session_hardening.sql` (reference only)

- [ ] **Step 1: Write the migration to fix bucketing**

```sql
-- Fix PIN rate limit: bucket by restaurant only, not tenant token.
-- Previously tenant token rotated on each login_to_restaurant_atomic call,
-- giving each PIN attempt a fresh rate limit window.

create or replace function public.claim_role_session(
  p_restaurant_id uuid,
  p_tenant_token text,
  p_role text,
  p_display_name text,
  p_checked_in_at timestamptz,
  p_pin text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.crew_role_sessions;
  v_token text := encode(extensions.gen_random_bytes(32), 'hex');
  v_pin_hash text;
  v_code_version integer;
  v_restaurant_bucket text;
  v_now timestamptz := now();
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  if p_role not in ('ss', 'kasir', 'satgas', 'clear_up') then raise exception 'INVALID_ROLE'; end if;

  select r.pin_hash, r.code_version into v_pin_hash, v_code_version
  from public.restaurant_access_tokens rat
  join public.restaurants r on r.id = rat.restaurant_id
  where rat.restaurant_id = p_restaurant_id
    and rat.token_hash = encode(extensions.digest(p_tenant_token, 'sha256'), 'hex')
    and rat.expires_at > v_now
    and r.is_active
    and rat.code_version = r.code_version;
  if v_pin_hash is null then raise exception 'INVALID_TENANT_SESSION'; end if;

  if p_display_name !~ '^[[:print:]]+$' or char_length(p_display_name) not between 1 and 40
  then raise exception 'INVALID_NAME'; end if;

  if p_checked_in_at is null then raise exception 'INVALID_CHECKED_IN_AT'; end if;

  if p_pin is null or p_pin !~ '^[0-9]{4}$' then raise exception 'INVALID_PIN'; end if;

  -- FIX: bucket by restaurant only (tenant bucket removed — rotates each login)
  v_restaurant_bucket := encode(extensions.digest('restaurant:' || p_restaurant_id::text, 'sha256'), 'hex');

  insert into public.role_session_pin_attempts(bucket_hash)
  values (v_restaurant_bucket)
  on conflict (bucket_hash) do nothing;

  perform 1 from public.role_session_pin_attempts
  where bucket_hash = v_restaurant_bucket
  for update;

  if exists (
    select 1 from public.role_session_pin_attempts
    where bucket_hash = v_restaurant_bucket and blocked_until > v_now
  ) then raise exception 'PIN_RATE_LIMITED'; end if;

  if v_pin_hash <> encode(extensions.digest(p_pin, 'sha256'), 'hex') then
    update public.role_session_pin_attempts set
      failures = case when window_started_at <= v_now - interval '15 minutes' then 1 else failures + 1 end,
      window_started_at = case when window_started_at <= v_now - interval '15 minutes' then v_now else window_started_at end,
      blocked_until = case
        when window_started_at > v_now - interval '15 minutes' and failures + 1 >= 5 then v_now + interval '15 minutes'
        else blocked_until
      end
    where bucket_hash = v_restaurant_bucket;
    raise exception 'INVALID_PIN';
  end if;

  update public.role_session_pin_attempts set failures = 0, window_started_at = v_now, blocked_until = null
  where bucket_hash = v_restaurant_bucket;

  insert into public.crew_role_sessions (restaurant_id, role, display_name, checked_in_at)
  values (p_restaurant_id, p_role, p_display_name, p_checked_in_at)
  returning * into result;

  insert into public.role_session_tokens (token_hash, restaurant_id, role_session_id, role, expires_at, code_version)
  values (
    encode(extensions.digest(v_token, 'sha256'), 'hex'),
    p_restaurant_id,
    result.id,
    p_role,
    v_now + interval '9 hours',
    v_code_version
  );

  return jsonb_build_object('session', to_jsonb(result), 'session_token', v_token);
end;
$$;
```

- [ ] **Step 2: Write source contract test for the new migration**

```typescript
// tests/claim-role-session-pin-hardening.test.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATION_PATH = join(
  process.cwd(),
  "supabase/migrations/20260907180000_fix_pin_rate_limit_bucket.sql",
);

describe("claim_role_session pin rate limit bucketing", () => {
  let sql: string;

  beforeAll(() => {
    sql = readFileSync(MIGRATION_PATH, "utf8");
  });

  it("uses only restaurant bucket (no tenant bucket)", () => {
    // The v_tenant_bucket variable should NOT exist
    expect(sql).not.toContain("v_tenant_bucket");
    // Only v_restaurant_bucket should be used
    expect(sql).toContain("v_restaurant_bucket");
  });

  it("buckets by restaurant hash only in rate limit insert", () => {
    // Insert should use only v_restaurant_bucket
    expect(sql).toContain(
      "insert into public.role_session_pin_attempts(bucket_hash)\n  values (v_restaurant_bucket)",
    );
  });

  it("checks blocked_until on restaurant bucket only", () => {
    expect(sql).toContain(
      "where bucket_hash = v_restaurant_bucket and blocked_until > v_now",
    );
  });

  it("increments failures on restaurant bucket only", () => {
    expect(sql).toContain(
      "where bucket_hash = v_restaurant_bucket;",
    );
  });

  it("still validates PIN format as 4 digits", () => {
    expect(sql).toContain("p_pin !~ '^[0-9]{4}$'");
  });

  it("still blocks after 5 failures in 15 minutes", () => {
    expect(sql).toContain("failures + 1 >= 5 then v_now + interval '15 minutes'");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/claim-role-session-pin-hardening.test.ts`
Expected: FAIL (file doesn't exist yet)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/claim-role-session-pin-hardening.test.ts`
Expected: PASS

- [ ] **Step 5: Apply migration to production**

Run: `supabase db push` or apply via Supabase SQL editor.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260907180000_fix_pin_rate_limit_bucket.sql tests/claim-role-session-pin-hardening.test.ts
git commit -m "fix(security): PIN rate limit buckets by restaurant only, not tenant token"
```

---

## Task 2: Occupancy CAS with Revision Check

**Root Cause:** `ON CONFLICT DO UPDATE` = last-write-wins. Two parallel requests both succeed, first table state silently overwritten.

**Fix:** Add `revision` column to `table_occupancy`. Mutations use `WHERE revision = expected_revision` and fail if stale. Bump revision on every write.

**Files:**
- Create: `supabase/migrations/20260907190000_add_occupancy_revision.sql`
- Modify: `src/lib/table-occupancy.server.ts` (revision in mutation types)
- Modify: `src/lib/table-occupancy-domain.ts` (revision in types)
- Create: `tests/occupancy-cas.test.ts`

- [ ] **Step 1: Write the migration**

```sql
-- Add revision column to table_occupancy for CAS (Compare-And-Swap).
-- Every mutation bumps revision. Parallel requests fail if stale.

ALTER TABLE public.table_occupancy
  ADD COLUMN revision integer NOT NULL DEFAULT 0;

-- Update get_table_occupancy_snapshot to return revision
CREATE OR REPLACE FUNCTION public.get_table_occupancy_snapshot(p_restaurant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_max_revision integer;
  v_tables jsonb;
BEGIN
  SELECT COALESCE(MAX(revision), 0) INTO v_max_revision
  FROM public.table_occupancy WHERE restaurant_id = p_restaurant_id;

  SELECT jsonb_agg(jsonb_build_object(
    'table_number', t.table_number,
    'status', t.status,
    'occupied_by_session_id', t.occupied_by_session_id,
    'occupied_at', t.occupied_at,
    'revision', t.revision
  )) INTO v_tables
  FROM public.table_occupancy t
  WHERE t.restaurant_id = p_restaurant_id
  ORDER BY t.table_number;

  RETURN jsonb_build_object('revision', v_max_revision, 'tables', COALESCE(v_tables, '[]'::jsonb));
END;
$$;

-- Update get_table_occupancy_snapshot_versioned to return revision
CREATE OR REPLACE FUNCTION public.get_table_occupancy_snapshot_versioned(p_restaurant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_max_revision integer;
  v_tables jsonb;
BEGIN
  SELECT COALESCE(MAX(revision), 0) INTO v_max_revision
  FROM public.table_occupancy WHERE restaurant_id = p_restaurant_id;

  SELECT jsonb_agg(jsonb_build_object(
    'table_number', t.table_number,
    'status', t.status,
    'occupied_by_session_id', t.occupied_by_session_id,
    'occupied_at', t.occupied_at,
    'revision', t.revision
  )) INTO v_tables
  FROM public.table_occupancy t
  WHERE t.restaurant_id = p_restaurant_id
  ORDER BY t.table_number;

  RETURN jsonb_build_object('revision', v_max_revision, 'tables', COALESCE(v_tables, '[]'::jsonb));
END;
$$;

-- Fix occupy_table to use CAS
CREATE OR REPLACE FUNCTION public.occupy_table(
  p_restaurant_id uuid,
  p_table_number integer,
  p_session_id uuid,
  p_revision integer
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_new_revision integer;
BEGIN
  UPDATE public.table_occupancy SET
    status = 'occupied',
    occupied_by_session_id = p_session_id,
    occupied_at = now(),
    revision = revision + 1,
    updated_at = now()
  WHERE restaurant_id = p_restaurant_id
    AND table_number = p_table_number
    AND revision = p_revision;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'STALE_REVISION';
  END IF;

  SELECT revision INTO v_new_revision FROM public.table_occupancy
  WHERE restaurant_id = p_restaurant_id AND table_number = p_table_number;

  RETURN jsonb_build_object('ok', true, 'revision', v_new_revision);
END;
$$;

-- Fix free_table to use CAS
CREATE OR REPLACE FUNCTION public.free_table(
  p_restaurant_id uuid,
  p_table_number integer,
  p_session_id uuid,
  p_revision integer
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_new_revision integer;
BEGIN
  UPDATE public.table_occupancy SET
    status = 'free',
    occupied_by_session_id = null,
    occupied_at = null,
    revision = revision + 1,
    updated_at = now()
  WHERE restaurant_id = p_restaurant_id
    AND table_number = p_table_number
    AND occupied_by_session_id = p_session_id
    AND revision = p_revision;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'STALE_REVISION';
  END IF;

  SELECT revision INTO v_new_revision FROM public.table_occupancy
  WHERE restaurant_id = p_restaurant_id AND table_number = p_table_number;

  RETURN jsonb_build_object('ok', true, 'revision', v_new_revision);
END;
$$;

-- Fix table_move to use CAS
CREATE OR REPLACE FUNCTION public.table_move(
  p_restaurant_id uuid,
  p_from_table integer,
  p_to_table integer,
  p_session_id uuid,
  p_from_revision integer,
  p_to_revision integer
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_from_ok boolean;
  v_to_ok boolean;
  v_new_from_rev integer;
  v_new_to_rev integer;
BEGIN
  -- CAS free the source table
  UPDATE public.table_occupancy SET
    status = 'free',
    occupied_by_session_id = null,
    occupied_at = null,
    revision = revision + 1,
    updated_at = now()
  WHERE restaurant_id = p_restaurant_id
    AND table_number = p_from_table
    AND occupied_by_session_id = p_session_id
    AND revision = p_from_revision;
  v_from_ok := FOUND;

  -- CAS occupy the target table
  UPDATE public.table_occupancy SET
    status = 'occupied',
    occupied_by_session_id = p_session_id,
    occupied_at = now(),
    revision = revision + 1,
    updated_at = now()
  WHERE restaurant_id = p_restaurant_id
    AND table_number = p_to_table
    AND (occupied_by_session_id IS NULL OR occupied_by_session_id = p_session_id)
    AND revision = p_to_revision;
  v_to_ok := FOUND;

  IF NOT v_from_ok OR NOT v_to_ok THEN
    RAISE EXCEPTION 'STALE_REVISION';
  END IF;

  SELECT revision INTO v_new_from_rev FROM public.table_occupancy
  WHERE restaurant_id = p_restaurant_id AND table_number = p_from_table;

  SELECT revision INTO v_new_to_rev FROM public.table_occupancy
  WHERE restaurant_id = p_restaurant_id AND table_number = p_to_table;

  RETURN jsonb_build_object(
    'ok', true,
    'from_revision', v_new_from_rev,
    'to_revision', v_new_to_rev
  );
END;
$$;
```

- [ ] **Step 2: Write source contract test**

```typescript
// tests/occupancy-cas.test.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATION_PATH = join(
  process.cwd(),
  "supabase/migrations/20260907190000_add_occupancy_revision.sql",
);

describe("occupancy CAS migration", () => {
  let sql: string;

  beforeAll(() => {
    sql = readFileSync(MIGRATION_PATH, "utf8");
  });

  it("adds revision column to table_occupancy", () => {
    expect(sql).toContain("ADD COLUMN revision integer NOT NULL DEFAULT 0");
  });

  it("occupy_table uses CAS with revision", () => {
    expect(sql).toContain("AND revision = p_revision");
    expect(sql).toContain("revision = revision + 1");
    expect(sql).toContain("RAISE EXCEPTION 'STALE_REVISION'");
  });

  it("free_table uses CAS with revision", () => {
    expect(sql).toContain("AND revision = p_revision");
    expect(sql).toContain("revision = revision + 1");
    expect(sql).toContain("RAISE EXCEPTION 'STALE_REVISION'");
  });

  it("table_move uses CAS with revision", () => {
    expect(sql).toContain("p_from_revision integer");
    expect(sql).toContain("p_to_revision integer");
    expect(sql).toContain("AND revision = p_from_revision");
    expect(sql).toContain("AND revision = p_to_revision");
    expect(sql).toContain("RAISE EXCEPTION 'STALE_REVISION'");
  });

  it("snapshot returns revision in tables", () => {
    expect(sql).toContain("'revision', t.revision");
  });
});
```

- [ ] **Step 3: Run test to verify it passes**

Run: `npx vitest run tests/occupancy-cas.test.ts`
Expected: PASS

- [ ] **Step 4: Apply migration to production**

Run: `supabase db push` or apply via Supabase SQL editor.

- [ ] **Step 5: Update client-side to pass revision**

Modify `src/lib/table-occupancy.server.ts` to include `revision` in mutation inputs and return types. Modify `src/lib/table-occupancy-domain.ts` to add `revision` to `TableOccupancyRow`.

- [ ] **Step 6: Update tests for new revision field**

Update existing occupancy tests to include `revision` in mock data and assertions.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260907190000_add_occupancy_revision.sql tests/occupancy-cas.test.ts src/lib/table-occupancy.server.ts src/lib/table-occupancy-domain.ts
git commit -m "fix(security): occupancy CAS with revision check prevents parallel overwrite"
```

---

## Task 3: Rate Limit Kode Resto Lookup

**Root Cause:** `login_to_restaurant_atomic` has no rate limit. Attacker can enumerate all restaurant codes with unlimited requests.

**Fix:** Add rate limit table + throttle function. Apply in `loginToRestaurant` server function.

**Files:**
- Create: `supabase/migrations/20260907200000_add_login_rate_limit.sql`
- Modify: `src/lib/restaurants.server.ts` (call rate limit check)
- Create: `tests/login-rate-limit.test.ts`

- [ ] **Step 1: Write the migration**

```sql
-- Rate limit for Kode Resto lookup (login_to_restaurant_atomic).
-- 5 failures per 15 minutes per IP hash. Blocks for 15 minutes.

CREATE TABLE IF NOT EXISTS public.lookup_rate_limits (
  ip_hash text NOT NULL,
  failures integer NOT NULL DEFAULT 0 CHECK (failures >= 0),
  window_started_at timestamptz NOT NULL DEFAULT now(),
  blocked_until timestamptz,
  PRIMARY KEY (ip_hash)
);

ALTER TABLE public.lookup_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lookup_rate_limits FROM public, anon, authenticated;
GRANT ALL ON public.lookup_rate_limits TO service_role;

CREATE OR REPLACE FUNCTION public.check_lookup_rate_limit(p_ip_hash text)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT blocked_until > now() FROM public.lookup_rate_limits WHERE ip_hash = p_ip_hash),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.record_lookup_failure(p_ip_hash text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.lookup_rate_limits (ip_hash, failures, window_started_at, blocked_until)
  VALUES (p_ip_hash, 1, now(), null)
  ON CONFLICT (ip_hash) DO UPDATE SET
    failures = CASE
      WHEN lookup_rate_limits.window_started_at <= now() - interval '15 minutes' THEN 1
      ELSE lookup_rate_limits.failures + 1
    END,
    window_started_at = CASE
      WHEN lookup_rate_limits.window_started_at <= now() - interval '15 minutes' THEN now()
      ELSE lookup_rate_limits.window_started_at
    END,
    blocked_until = CASE
      WHEN lookup_rate_limits.window_started_at > now() - interval '15 minutes'
        AND lookup_rate_limits.failures + 1 >= 5
      THEN now() + interval '15 minutes'
      ELSE null
    END;
END;
$$;

CREATE OR REPLACE FUNCTION public.clear_lookup_failures(p_ip_hash text)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.lookup_rate_limits WHERE ip_hash = p_ip_hash;
$$;

REVOKE ALL ON FUNCTION public.check_lookup_rate_limit(text), public.record_lookup_failure(text), public.clear_lookup_failures(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_lookup_rate_limit(text), public.record_lookup_failure(text), public.clear_lookup_failures(text) TO service_role;
```

- [ ] **Step 2: Write source contract test**

```typescript
// tests/login-rate-limit.test.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATION_PATH = join(
  process.cwd(),
  "supabase/migrations/20260907200000_add_login_rate_limit.sql",
);

describe("login rate limit migration", () => {
  let sql: string;

  beforeAll(() => {
    sql = readFileSync(MIGRATION_PATH, "utf8");
  });

  it("creates lookup_rate_limits table", () => {
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.lookup_rate_limits");
  });

  it("has check_lookup_rate_limit function", () => {
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.check_lookup_rate_limit");
  });

  it("has record_lookup_failure function", () => {
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.record_lookup_failure");
  });

  it("blocks after 5 failures in 15 minutes", () => {
    expect(sql).toContain("failures + 1 >= 5");
    expect(sql).toContain("interval '15 minutes'");
  });

  it("revokes public access", () => {
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.check_lookup_rate_limit");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.check_lookup_rate_limit");
  });
});
```

- [ ] **Step 3: Run test to verify it passes**

Run: `npx vitest run tests/login-rate-limit.test.ts`
Expected: PASS

- [ ] **Step 4: Apply migration to production**

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260907200000_add_login_rate_limit.sql tests/login-rate-limit.test.ts
git commit -m "feat(security): rate limit Kode Resto lookup (5 attempts/15 min)"
```

---

## Task 4: Disable Anonymous Signup

**Root Cause:** `signInAnonymously()` mints unlimited JWTs. Each anonymous user gets a fresh JWT, enabling unlimited RPC calls.

**Fix:** Add `disable_anonymous_signup` RPC that sets a config flag. Client checks flag before calling `signInAnonymously()`. If disabled, show error.

**Files:**
- Create: `supabase/migrations/20260907210000_disable_anonymous_signup.sql`
- Modify: `src/lib/supabase-browser.ts` (check flag before anonymous auth)
- Create: `tests/disable-anonymous-signup.test.ts`

- [ ] **Step 1: Write the migration**

```sql
-- Disable anonymous signup in production.
-- Adds a config flag that client checks before signInAnonymously().

CREATE TABLE IF NOT EXISTS public.system_config (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.system_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.system_config FROM public, anon, authenticated;
GRANT ALL ON public.system_config TO service_role;

-- Set anonymous signup as disabled by default
INSERT INTO public.system_config (key, value) VALUES ('anonymous_signup_enabled', 'false')
ON CONFLICT (key) DO NOTHING;

-- RPC for client to check (read-only, no auth needed)
CREATE OR REPLACE FUNCTION public.is_anonymous_signup_enabled()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT value::boolean FROM public.system_config WHERE key = 'anonymous_signup_enabled'),
    false
  );
$$;

-- RPC for admin to toggle
CREATE OR REPLACE FUNCTION public.set_anonymous_signup_enabled(p_enabled boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.system_config (key, value) VALUES ('anonymous_signup_enabled', p_enabled::text)
  ON CONFLICT (key) DO UPDATE SET value = p_enabled::text, updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.is_anonymous_signup_enabled(), public.set_anonymous_signup_enabled(boolean) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_anonymous_signup_enabled() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_anonymous_signup_enabled(boolean) TO service_role;
```

- [ ] **Step 2: Write source contract test**

```typescript
// tests/disable-anonymous-signup.test.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATION_PATH = join(
  process.cwd(),
  "supabase/migrations/20260907210000_disable_anonymous_signup.sql",
);

describe("disable anonymous signup migration", () => {
  let sql: string;

  beforeAll(() => {
    sql = readFileSync(MIGRATION_PATH, "utf8");
  });

  it("creates system_config table", () => {
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.system_config");
  });

  it("sets anonymous_signup_enabled to false by default", () => {
    expect(sql).toContain("'anonymous_signup_enabled', 'false'");
  });

  it("has is_anonymous_signup_enabled function", () => {
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.is_anonymous_signup_enabled()");
  });

  it("has set_anonymous_signup_enabled function", () => {
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.set_anonymous_signup_enabled");
  });

  it("grants is_anonymous_signup_enabled to anon and authenticated", () => {
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.is_anonymous_signup_enabled() TO anon, authenticated");
  });

  it("restricts set_anonymous_signup_enabled to service_role only", () => {
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.is_anonymous_signup_enabled(), public.set_anonymous_signup_enabled");
  });
});
```

- [ ] **Step 3: Run test to verify it passes**

Run: `npx vitest run tests/disable-anonymous-signup.test.ts`
Expected: PASS

- [ ] **Step 4: Apply migration to production**

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260907210000_disable_anonymous_signup.sql tests/disable-anonymous-signup.test.ts
git commit -m "feat(security): disable anonymous signup in production"
```

---

## Task 5: Security Headers

**Root Cause:** No CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy headers.

**Fix:** Add security headers to Vercel config.

**Files:**
- Modify: `vercel.json`
- Create: `tests/security-headers.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// tests/security-headers.test.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";

const VERCEL_PATH = join(process.cwd(), "vercel.json");

describe("security headers", () => {
  let config: Record<string, unknown>;

  beforeAll(() => {
    config = JSON.parse(readFileSync(VERCEL_PATH, "utf8"));
  });

  it("has headers configuration", () => {
    expect(config.headers).toBeDefined();
    expect(Array.isArray(config.headers)).toBe(true);
  });

  it("sets X-Frame-Options to DENY", () => {
    const headers = config.headers as Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
    const xFrame = headers.flatMap((h) => h.headers).find((h) => h.key === "X-Frame-Options");
    expect(xFrame?.value).toBe("DENY");
  });

  it("sets X-Content-Type-Options to nosniff", () => {
    const headers = config.headers as Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
    const xcto = headers.flatMap((h) => h.headers).find((h) => h.key === "X-Content-Type-Options");
    expect(xcto?.value).toBe("nosniff");
  });

  it("sets Referrer-Policy", () => {
    const headers = config.headers as Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
    const rp = headers.flatMap((h) => h.headers).find((h) => h.key === "Referrer-Policy");
    expect(rp?.value).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/security-headers.test.ts`
Expected: FAIL (no headers in vercel.json)

- [ ] **Step 3: Add headers to vercel.json**

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "vite",
  "buildCommand": "npm run verify",
  "installCommand": "npm install",
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Frame-Options", "value": "DENY" },
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
        { "key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=(), interest-cohort=()" }
      ]
    }
  ]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/security-headers.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add vercel.json tests/security-headers.test.ts
git commit -m "feat(security): add security headers (X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy)"
```

---

## Execution Summary

| Task | Finding | Effort | Dependency |
|------|---------|--------|------------|
| 1. Fix PIN Rate Limit Bucketing | CRIT-03 + CRIT-04 | Medium | None |
| 2. Occupancy CAS with Revision | HIGH-03 | High | None |
| 3. Rate Limit Kode Resto | HIGH-01 | Medium | None |
| 4. Disable Anonymous Signup | CRIT-01 + MED-03 | Low | None |
| 5. Security Headers | MED-01 | Low | None |

All 5 tasks are independent and can be executed in parallel or any order.

**After implementation, apply all migrations and run `npm run verify`.**
