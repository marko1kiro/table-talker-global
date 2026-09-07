# Manager → Crew Messaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Manager sends instructions to individual or all active crew; crew must ACK (blocking banner), optionally reply; manager sees per-crew ACK status + replies in thread view.

**Architecture:** Two new DB tables (`manager_instructions`, `instruction_receipts`) + 4 RPCs + 2 DB broadcast triggers. Reuse existing private Realtime channel `table-occupancy:{restaurantId}` with new event types `instruction` and `instruction_ack`. Server fns wrap RPCs via `getAnonAuthedSupabaseClient`. Manager Dashboard gets new "PESAN" tab; all 4 crew role routes get a shared blocking `InstructionBanner` component.

**Tech Stack:** Supabase Postgres (RPC, triggers, `realtime.send`), TanStack Start (`createServerFn`), TanStack Query, React, Zod, Vitest, Tailwind CSS.

---

## File Map

| Action | Path | Responsibility |
|--------|------|---------------|
| Create | `supabase/migrations/20260907150000_manager_instructions.sql` | Tables, RPCs, triggers, grants, cron |
| Create | `src/lib/instruction-domain.ts` | Pure types + `computeWibMidnight` helper |
| Create | `src/lib/manager-instructions.server.ts` | Server fns wrapping RPCs (send, thread) |
| Create | `src/lib/crew-instructions.server.ts` | Server fns wrapping RPCs (pending, ack) |
| Create | `src/components/InstructionBanner.tsx` | Blocking banner overlay for crew |
| Create | `src/hooks/use-pending-instructions.ts` | Hook: fetch + realtime subscribe for crew |
| Modify | `src/components/ManagerLayout.tsx` | Add "PESAN" menu item |
| Modify | `src/routes/manager/index.tsx` | Add "messages" tab content (compose + thread) |
| Modify | `src/routes/kasir/index.tsx` | Mount InstructionBanner |
| Modify | `src/routes/satgas/index.tsx` | Mount InstructionBanner |
| Modify | `src/routes/clear-up/index.tsx` | Mount InstructionBanner |
| Modify | `src/routes/index.tsx` | Mount InstructionBanner (SS role) |
| Create | `tests/instruction-domain.test.ts` | Unit tests for domain logic |
| Create | `tests/instruction-migration.test.ts` | Source-assertion tests for migration SQL |
| Create | `tests/manager-instructions-server.test.ts` | Unit tests for server fn wrappers |
| Create | `tests/crew-instructions-server.test.ts` | Unit tests for crew server fn wrappers |
| Create | `tests/instruction-banner.test.ts` | UI source-assertion tests |
| Create | `tests/manager-messages-tab.test.ts` | Manager "PESAN" tab source-assertion tests |

---

### Task 1: Domain Logic — `instruction-domain.ts`

**Files:**
- Create: `src/lib/instruction-domain.ts`
- Test: `tests/instruction-domain.test.ts`

- [ ] **Step 1: Write failing test for `computeWibMidnight`**

```ts
// tests/instruction-domain.test.ts
import { describe, expect, it } from "vitest";
import {
  computeWibMidnight,
  type InstructionTargetType,
  INSTRUCTION_MAX_LENGTH,
  REPLY_MAX_LENGTH,
} from "../src/lib/instruction-domain";

describe("computeWibMidnight", () => {
  it("returns next WIB midnight as ISO string for a daytime WIB instant", () => {
    // 2026-09-07 14:00 WIB = 2026-09-07 07:00 UTC
    // next WIB midnight = 2026-09-08 00:00 WIB = 2026-09-07 17:00 UTC
    const result = computeWibMidnight(new Date("2026-09-07T07:00:00Z"));
    expect(result).toBe("2026-09-07T17:00:00.000Z");
  });
  it("returns same-day 17:00 UTC for an early-UTC instant (still previous WIB day)", () => {
    // 2026-09-07 01:00 UTC = 2026-09-07 08:00 WIB
    // next WIB midnight = 2026-09-08 00:00 WIB = 2026-09-07 17:00 UTC
    const result = computeWibMidnight(new Date("2026-09-07T01:00:00Z"));
    expect(result).toBe("2026-09-07T17:00:00.000Z");
  });
  it("handles late WIB night (23:59 WIB = 16:59 UTC)", () => {
    // 2026-09-07 16:59 UTC = 2026-09-07 23:59 WIB
    // next WIB midnight = 2026-09-08 00:00 WIB = 2026-09-07 17:00 UTC
    const result = computeWibMidnight(new Date("2026-09-07T16:59:00Z"));
    expect(result).toBe("2026-09-07T17:00:00.000Z");
  });
  it("handles exactly WIB midnight (00:00 WIB = 17:00 UTC prev day)", () => {
    // 2026-09-07 17:00 UTC = 2026-09-08 00:00 WIB — this IS midnight
    // next WIB midnight = 2026-09-09 00:00 WIB = 2026-09-08 17:00 UTC
    const result = computeWibMidnight(new Date("2026-09-07T17:00:00Z"));
    expect(result).toBe("2026-09-08T17:00:00.000Z");
  });
});

describe("constants", () => {
  it("exports correct limits", () => {
    expect(INSTRUCTION_MAX_LENGTH).toBe(200);
    expect(REPLY_MAX_LENGTH).toBe(100);
  });
  it("InstructionTargetType includes expected values", () => {
    const valid: InstructionTargetType[] = ["all", "individual"];
    expect(valid).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/instruction-domain.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/instruction-domain.ts
export const INSTRUCTION_MAX_LENGTH = 200;
export const REPLY_MAX_LENGTH = 100;

export type InstructionTargetType = "all" | "individual";

export type PendingInstruction = {
  instructionId: string;
  message: string;
  managerName: string;
  createdAt: string;
  expiresAt: string;
};

export type InstructionReceipt = {
  roleSessionId: string;
  displayName: string;
  role: string;
  ackAt: string | null;
  replyText: string | null;
  repliedAt: string | null;
};

export type InstructionThread = {
  instructionId: string;
  message: string;
  targetType: InstructionTargetType;
  targetDisplayName: string | null;
  createdAt: string;
  receipts: InstructionReceipt[];
};

export function computeWibMidnight(now: Date): string {
  const utcMs = now.getTime();
  const wibMs = utcMs + 7 * 60 * 60 * 1000;
  const wibDate = new Date(wibMs);
  const wibYear = wibDate.getUTCFullYear();
  const wibMonth = wibDate.getUTCMonth();
  const wibDay = wibDate.getUTCDate();
  const nextMidnightWib = Date.UTC(wibYear, wibMonth, wibDay + 1, 0, 0, 0);
  const nextMidnightUtc = nextMidnightWib - 7 * 60 * 60 * 1000;
  return new Date(nextMidnightUtc).toISOString();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/instruction-domain.test.ts`
Expected: PASS

- [ ] **Step 5: Format and commit**

```bash
npx prettier --write src/lib/instruction-domain.ts tests/instruction-domain.test.ts
git add src/lib/instruction-domain.ts tests/instruction-domain.test.ts
git commit -m "feat: add instruction domain types and computeWibMidnight"
```

---

### Task 2: Database Migration

**Files:**
- Create: `supabase/migrations/20260907150000_manager_instructions.sql`
- Test: `tests/instruction-migration.test.ts`

- [ ] **Step 1: Write failing source-assertion test**

```ts
// tests/instruction-migration.test.ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = () =>
  readFileSync(
    new URL(
      "../supabase/migrations/20260907150000_manager_instructions.sql",
      import.meta.url,
    ),
    "utf8",
  ).toLowerCase();

describe("manager instructions migration", () => {
  it("creates manager_instructions table with correct columns", () => {
    const sql = source();
    expect(sql).toContain("create table public.manager_instructions");
    expect(sql).toContain("restaurant_id uuid not null");
    expect(sql).toContain("manager_id uuid not null");
    expect(sql).toContain("target_type text not null");
    expect(sql).toContain("check (target_type in ('all', 'individual'))");
    expect(sql).toContain("char_length(message) <= 200");
    expect(sql).toContain("expires_at timestamptz not null");
  });

  it("creates instruction_receipts table with correct columns", () => {
    const sql = source();
    expect(sql).toContain("create table public.instruction_receipts");
    expect(sql).toContain(
      "instruction_id uuid not null references public.manager_instructions",
    );
    expect(sql).toContain("role_session_id uuid not null");
    expect(sql).toContain("ack_at timestamptz");
    expect(sql).toContain("char_length(reply_text) <= 100");
    expect(sql).toContain("unique (instruction_id, role_session_id)");
  });

  it("defines send_manager_instruction RPC", () => {
    const sql = source();
    expect(sql).toContain(
      "create or replace function public.send_manager_instruction(",
    );
    expect(sql).toContain("p_manager_token text");
    expect(sql).toContain("p_target_type text");
    expect(sql).toContain("p_message text");
    expect(sql).toContain("returns uuid");
  });

  it("validates manager session in send RPC", () => {
    const sql = source();
    expect(sql).toContain(
      "encode(extensions.digest(p_manager_token, 'sha256'), 'hex')",
    );
    expect(sql).toContain("ma.status = 'aktif'");
    expect(sql).toContain("ms.expires_at > now()");
  });

  it("raises NO_ACTIVE_CREW when target all and no crew", () => {
    const sql = source();
    expect(sql).toContain("no_active_crew");
  });

  it("defines ack_instruction RPC", () => {
    const sql = source();
    expect(sql).toContain(
      "create or replace function public.ack_instruction(",
    );
    expect(sql).toContain("p_role_session_token text");
    expect(sql).toContain("p_instruction_id uuid");
  });

  it("ack is idempotent — skips already-acked", () => {
    const sql = source();
    expect(sql).toContain("ack_at is null");
  });

  it("defines get_pending_instructions RPC", () => {
    const sql = source();
    expect(sql).toContain(
      "create or replace function public.get_pending_instructions(",
    );
    expect(sql).toContain("expires_at > now()");
  });

  it("defines get_instruction_thread RPC", () => {
    const sql = source();
    expect(sql).toContain(
      "create or replace function public.get_instruction_thread(",
    );
    expect(sql).toContain("p_manager_token text");
  });

  it("creates broadcast triggers for instruction events", () => {
    const sql = source();
    expect(sql).toContain("broadcast_instruction_created");
    expect(sql).toContain("broadcast_instruction_acked");
    expect(sql).toContain("realtime.send(");
    expect(sql).toContain("'instruction'");
    expect(sql).toContain("'instruction_ack'");
  });

  it("grants RPCs to authenticated only", () => {
    const sql = source();
    expect(sql).toContain(
      "grant execute on function public.send_manager_instruction",
    );
    expect(sql).toContain(
      "grant execute on function public.ack_instruction",
    );
    expect(sql).toContain(
      "grant execute on function public.get_pending_instructions",
    );
    expect(sql).toContain(
      "grant execute on function public.get_instruction_thread",
    );
  });

  it("enables RLS on both tables", () => {
    const sql = source();
    expect(sql).toContain(
      "alter table public.manager_instructions enable row level security",
    );
    expect(sql).toContain(
      "alter table public.instruction_receipts enable row level security",
    );
  });

  it("schedules cleanup cron at 19:00 UTC (02:00 WIB)", () => {
    const sql = source();
    expect(sql).toContain("0 19 * * *");
    expect(sql).toContain("cleanup-expired-instructions");
  });

  it("adds manager_instructions and instruction_receipts to purge RPC", () => {
    const sql = source();
    expect(sql).toContain(
      "delete from public.instruction_receipts",
    );
    expect(sql).toContain(
      "delete from public.manager_instructions where restaurant_id",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/instruction-migration.test.ts`
Expected: FAIL — file not found

- [ ] **Step 3: Write the migration SQL**

```sql
-- supabase/migrations/20260907150000_manager_instructions.sql
-- Manager → Crew messaging: instructions with ACK + reply.

-- 1. Tables
create table public.manager_instructions (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  manager_id uuid not null references public.manager_accounts (id) on delete cascade,
  target_type text not null check (target_type in ('all', 'individual')),
  target_session_id uuid references public.crew_role_sessions (id) on delete set null,
  message text not null check (char_length(message) <= 200),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index manager_instructions_restaurant_idx
  on public.manager_instructions (restaurant_id, created_at desc);
alter table public.manager_instructions enable row level security;
revoke all on public.manager_instructions from public, anon, authenticated;

create table public.instruction_receipts (
  id uuid primary key default gen_random_uuid(),
  instruction_id uuid not null references public.manager_instructions (id) on delete cascade,
  role_session_id uuid not null references public.crew_role_sessions (id) on delete cascade,
  ack_at timestamptz,
  reply_text text check (reply_text is null or char_length(reply_text) <= 100),
  replied_at timestamptz,
  unique (instruction_id, role_session_id)
);
create index instruction_receipts_pending_idx
  on public.instruction_receipts (role_session_id, ack_at)
  where ack_at is null;
alter table public.instruction_receipts enable row level security;
revoke all on public.instruction_receipts from public, anon, authenticated;

-- 2. RPC: send_manager_instruction
create or replace function public.send_manager_instruction(
  p_manager_token text,
  p_target_type text,
  p_target_role_session_id uuid default null,
  p_message text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_manager_id uuid;
  v_restaurant uuid;
  v_instruction_id uuid;
  v_inserted_count integer;
begin
  select ma.id, ms.restaurant_id into v_manager_id, v_restaurant
  from public.manager_sessions ms
  join public.manager_accounts ma on ma.id = ms.manager_id
  join public.restaurants r on r.id = ms.restaurant_id
  where ms.token_hash = encode(extensions.digest(p_manager_token, 'sha256'), 'hex')
    and ma.status = 'aktif'
    and ms.expires_at > now()
    and r.is_active;
  if v_restaurant is null then raise exception 'INVALID_SESSION'; end if;

  if p_target_type not in ('all', 'individual') then
    raise exception 'INVALID_TARGET_TYPE';
  end if;
  if char_length(p_message) < 1 or char_length(p_message) > 200 then
    raise exception 'INVALID_MESSAGE';
  end if;

  -- Compute expires_at = next WIB midnight (UTC+7)
  insert into public.manager_instructions
    (restaurant_id, manager_id, target_type, target_session_id, message, expires_at)
  values (
    v_restaurant, v_manager_id, p_target_type,
    case when p_target_type = 'individual' then p_target_role_session_id else null end,
    p_message,
    date_trunc('day', now() at time zone 'Asia/Jakarta' + interval '1 day') at time zone 'Asia/Jakarta'
  )
  returning id into v_instruction_id;

  if p_target_type = 'all' then
    insert into public.instruction_receipts (instruction_id, role_session_id)
    select v_instruction_id, rst.role_session_id
    from public.role_session_tokens rst
    where rst.restaurant_id = v_restaurant
      and rst.expires_at > now()
    group by rst.role_session_id;

    get diagnostics v_inserted_count = row_count;
    if v_inserted_count = 0 then
      delete from public.manager_instructions where id = v_instruction_id;
      raise exception 'NO_ACTIVE_CREW';
    end if;
  else
    if p_target_role_session_id is null then
      raise exception 'INVALID_TARGET';
    end if;
    insert into public.instruction_receipts (instruction_id, role_session_id)
    values (v_instruction_id, p_target_role_session_id);
  end if;

  return v_instruction_id;
end;
$$;
revoke all on function public.send_manager_instruction(text, text, uuid, text)
  from public, anon, service_role;
grant execute on function public.send_manager_instruction(text, text, uuid, text)
  to authenticated;

-- 3. RPC: ack_instruction
create or replace function public.ack_instruction(
  p_role_session_token text,
  p_instruction_id uuid,
  p_reply_text text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role_session_id uuid;
  v_updated boolean;
begin
  select rst.role_session_id into v_role_session_id
  from public.role_session_tokens rst
  where rst.token_hash = encode(extensions.digest(p_role_session_token, 'sha256'), 'hex')
    and rst.expires_at > now();
  if v_role_session_id is null then raise exception 'INVALID_SESSION'; end if;

  if p_reply_text is not null and char_length(p_reply_text) > 100 then
    raise exception 'REPLY_TOO_LONG';
  end if;

  update public.instruction_receipts
  set ack_at = now(),
      reply_text = p_reply_text,
      replied_at = case when p_reply_text is not null then now() else null end
  where instruction_id = p_instruction_id
    and role_session_id = v_role_session_id
    and ack_at is null;

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;
revoke all on function public.ack_instruction(text, uuid, text)
  from public, anon, service_role;
grant execute on function public.ack_instruction(text, uuid, text)
  to authenticated;

-- 4. RPC: get_pending_instructions
create or replace function public.get_pending_instructions(
  p_role_session_token text
)
returns table (
  instruction_id uuid,
  message text,
  manager_name text,
  created_at timestamptz,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role_session_id uuid;
begin
  select rst.role_session_id into v_role_session_id
  from public.role_session_tokens rst
  where rst.token_hash = encode(extensions.digest(p_role_session_token, 'sha256'), 'hex')
    and rst.expires_at > now();
  if v_role_session_id is null then raise exception 'INVALID_SESSION'; end if;

  return query
  select mi.id as instruction_id, mi.message, ma.full_name as manager_name,
         mi.created_at, mi.expires_at
  from public.instruction_receipts ir
  join public.manager_instructions mi on mi.id = ir.instruction_id
  join public.manager_accounts ma on ma.id = mi.manager_id
  where ir.role_session_id = v_role_session_id
    and ir.ack_at is null
    and mi.expires_at > now()
  order by mi.created_at asc;
end;
$$;
revoke all on function public.get_pending_instructions(text)
  from public, anon, service_role;
grant execute on function public.get_pending_instructions(text)
  to authenticated;

-- 5. RPC: get_instruction_thread
create or replace function public.get_instruction_thread(
  p_manager_token text,
  p_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant uuid;
  v_target_date date;
  v_result jsonb;
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

  v_target_date := coalesce(p_date, (now() at time zone 'Asia/Jakarta')::date);

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'instruction_id', mi.id,
      'message', mi.message,
      'target_type', mi.target_type,
      'target_display_name', (
        select crs.display_name from public.crew_role_sessions crs
        where crs.id = mi.target_session_id
      ),
      'created_at', mi.created_at,
      'receipts', (
        select coalesce(jsonb_agg(
          jsonb_build_object(
            'role_session_id', ir.role_session_id,
            'display_name', crs2.display_name,
            'role', crs2.role,
            'ack_at', ir.ack_at,
            'reply_text', ir.reply_text,
            'replied_at', ir.replied_at
          ) order by ir.ack_at nulls last
        ), '[]'::jsonb)
        from public.instruction_receipts ir
        join public.crew_role_sessions crs2 on crs2.id = ir.role_session_id
        where ir.instruction_id = mi.id
      )
    ) order by mi.created_at desc
  ), '[]'::jsonb) into v_result
  from public.manager_instructions mi
  where mi.restaurant_id = v_restaurant
    and (mi.created_at at time zone 'Asia/Jakarta')::date = v_target_date;

  return v_result;
end;
$$;
revoke all on function public.get_instruction_thread(text, date)
  from public, anon, service_role;
grant execute on function public.get_instruction_thread(text, date)
  to authenticated;

-- 6. Broadcast triggers
create or replace function public.broadcast_instruction_created()
returns trigger
language plpgsql
security definer
set search_path = public, realtime
as $$
declare
  v_instruction record;
  v_manager_name text;
begin
  select mi.*, ma.full_name into v_instruction
  from public.manager_instructions mi
  join public.manager_accounts ma on ma.id = mi.manager_id
  where mi.id = new.instruction_id;

  select ma.full_name into v_manager_name
  from public.manager_accounts ma
  where ma.id = v_instruction.manager_id;

  perform realtime.send(
    jsonb_build_object(
      'instruction_id', v_instruction.id,
      'message', v_instruction.message,
      'target_session_id', new.role_session_id,
      'manager_name', v_manager_name,
      'created_at', v_instruction.created_at
    ),
    'instruction',
    'table-occupancy:' || v_instruction.restaurant_id::text,
    true
  );
  return new;
end;
$$;
revoke all on function public.broadcast_instruction_created() from public, anon, authenticated;

create trigger instruction_receipts_broadcast_created
  after insert on public.instruction_receipts
  for each row execute function public.broadcast_instruction_created();

create or replace function public.broadcast_instruction_acked()
returns trigger
language plpgsql
security definer
set search_path = public, realtime
as $$
declare
  v_restaurant uuid;
  v_display_name text;
begin
  if old.ack_at is not null or new.ack_at is null then return new; end if;

  select mi.restaurant_id into v_restaurant
  from public.manager_instructions mi
  where mi.id = new.instruction_id;

  select crs.display_name into v_display_name
  from public.crew_role_sessions crs
  where crs.id = new.role_session_id;

  perform realtime.send(
    jsonb_build_object(
      'instruction_id', new.instruction_id,
      'role_session_id', new.role_session_id,
      'display_name', v_display_name,
      'ack_at', new.ack_at,
      'reply_text', new.reply_text
    ),
    'instruction_ack',
    'table-occupancy:' || v_restaurant::text,
    true
  );
  return new;
end;
$$;
revoke all on function public.broadcast_instruction_acked() from public, anon, authenticated;

create trigger instruction_receipts_broadcast_acked
  after update on public.instruction_receipts
  for each row execute function public.broadcast_instruction_acked();

-- 7. Cleanup cron: 02:00 WIB = 19:00 UTC daily
create or replace function public.cleanup_expired_instructions()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.manager_instructions where expires_at < now();
$$;
revoke all on function public.cleanup_expired_instructions() from public, anon, authenticated;
grant execute on function public.cleanup_expired_instructions() to service_role;

do $$
begin
  create extension if not exists pg_cron;
  if not exists (
    select 1 from cron.job where jobname = 'cleanup-expired-instructions-daily'
  ) then
    perform cron.schedule(
      'cleanup-expired-instructions-daily',
      '0 19 * * *',
      $cron$select public.cleanup_expired_instructions()$cron$
    );
  end if;
exception
  when insufficient_privilege or undefined_file or undefined_function or invalid_schema_name
       or feature_not_supported then null;
end;
$$;

-- 8. Add to Realtime publication
do $$
begin
  begin
    alter publication supabase_realtime add table public.instruction_receipts;
  exception
    when duplicate_object then null;
  end;
end;
$$;

-- 9. Update purge RPC to include new tables
create or replace function public.super_admin_purge_restaurant_test_data(
  p_restaurant_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exists boolean;
  v_rev bigint;
begin
  select exists(select 1 from public.restaurants where id = p_restaurant_id) into v_exists;
  if not v_exists then
    return jsonb_build_object('ok', false, 'error', 'RESTAURANT_NOT_FOUND');
  end if;

  -- 1. Table occupancy & status
  delete from public.table_occupancy_state where restaurant_id = p_restaurant_id;
  delete from public.occupancy_transitions where restaurant_id = p_restaurant_id;
  delete from public.table_escort_intents where restaurant_id = p_restaurant_id;
  delete from public.qr_scan_events where restaurant_id = p_restaurant_id;
  delete from public.pending_qr_scans where restaurant_id = p_restaurant_id;
  delete from public.qr_scan_debounce where restaurant_id = p_restaurant_id;

  -- 2. Crew sessions & tokens (all roles)
  delete from public.role_session_tokens
  where role_session_id in (
    select id from public.crew_role_sessions where restaurant_id = p_restaurant_id
  );
  delete from public.role_session_pin_attempts where restaurant_id = p_restaurant_id;

  -- 3. Manager instructions (before crew_role_sessions cascade)
  delete from public.instruction_receipts
  where instruction_id in (
    select id from public.manager_instructions where restaurant_id = p_restaurant_id
  );
  delete from public.manager_instructions where restaurant_id = p_restaurant_id;

  delete from public.crew_role_sessions where restaurant_id = p_restaurant_id;

  -- 4. Soundboard legacy crew sessions & tokens
  delete from public.crew_session_tokens
  where crew_session_id in (
    select id from public.crew_sessions where restaurant_id = p_restaurant_id
  );
  delete from public.crew_sessions where restaurant_id = p_restaurant_id;

  -- 5. Activity, playback, errors, and messages
  delete from public.playback_events where restaurant_id = p_restaurant_id;
  delete from public.crew_messages where restaurant_id = p_restaurant_id;
  delete from public.remote_commands where restaurant_id = p_restaurant_id;
  delete from public.operational_errors where restaurant_id = p_restaurant_id;

  -- 6. Realtime revision bump
  select public.bump_table_occupancy_revision(p_restaurant_id) into v_rev;

  return jsonb_build_object('ok', true, 'revision', coalesce(v_rev, 0));
end;
$$;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/instruction-migration.test.ts`
Expected: PASS

- [ ] **Step 5: Format and commit**

```bash
npx prettier --write tests/instruction-migration.test.ts
git add supabase/migrations/20260907150000_manager_instructions.sql tests/instruction-migration.test.ts
git commit -m "feat(db): add manager_instructions + instruction_receipts tables and RPCs"
```

- [ ] **Step 6: Apply migration to Supabase production**

Use the `supabase_apply_migration` tool to apply the migration.

---

### Task 3: Server Functions — Manager Side

**Files:**
- Create: `src/lib/manager-instructions.server.ts`
- Test: `tests/manager-instructions-server.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/manager-instructions-server.test.ts
import { describe, expect, it } from "vitest";
import {
  sendManagerInstructionCore,
  getInstructionThreadCore,
} from "../src/lib/manager-instructions.server";

describe("sendManagerInstructionCore", () => {
  it("calls send_manager_instruction RPC with correct params", async () => {
    const calls: [string, Record<string, unknown>][] = [];
    const rpc = async (fn: string, params: Record<string, unknown>) => {
      calls.push([fn, params]);
      return { data: "fake-uuid", error: null };
    };
    const r = await sendManagerInstructionCore(
      {
        managerToken: "tok",
        targetType: "all",
        targetRoleSessionId: null,
        message: "Test",
      },
      rpc,
    );
    expect(r).toMatchObject({ ok: true, instructionId: "fake-uuid" });
    expect(calls[0][0]).toBe("send_manager_instruction");
    expect(calls[0][1]).toMatchObject({
      p_manager_token: "tok",
      p_target_type: "all",
      p_message: "Test",
    });
  });

  it("maps INVALID_SESSION error", async () => {
    const rpc = async () => ({
      data: null,
      error: { message: "INVALID_SESSION" },
    });
    const r = await sendManagerInstructionCore(
      {
        managerToken: "tok",
        targetType: "all",
        targetRoleSessionId: null,
        message: "X",
      },
      rpc,
    );
    expect(r).toMatchObject({ ok: false, code: "INVALID_SESSION" });
  });

  it("maps NO_ACTIVE_CREW error", async () => {
    const rpc = async () => ({
      data: null,
      error: { message: "NO_ACTIVE_CREW" },
    });
    const r = await sendManagerInstructionCore(
      {
        managerToken: "tok",
        targetType: "all",
        targetRoleSessionId: null,
        message: "X",
      },
      rpc,
    );
    expect(r).toMatchObject({ ok: false, code: "NO_ACTIVE_CREW" });
  });
});

describe("getInstructionThreadCore", () => {
  it("normalizes thread response", async () => {
    const rpc = async () => ({
      data: [
        {
          instruction_id: "i1",
          message: "Hello",
          target_type: "all",
          target_display_name: null,
          created_at: "2026-09-07T07:00:00Z",
          receipts: [
            {
              role_session_id: "rs1",
              display_name: "Budi",
              role: "kasir",
              ack_at: "2026-09-07T07:01:00Z",
              reply_text: "Siap",
              replied_at: "2026-09-07T07:01:00Z",
            },
          ],
        },
      ],
      error: null,
    });
    const r = await getInstructionThreadCore(
      { managerToken: "tok" },
      rpc,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.threads).toHaveLength(1);
      expect(r.threads[0].message).toBe("Hello");
      expect(r.threads[0].receipts[0].displayName).toBe("Budi");
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/manager-instructions-server.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/manager-instructions.server.ts
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getAnonAuthedSupabaseClient, type RpcCaller } from "./role-session.server";
import type { InstructionThread, InstructionReceipt, InstructionTargetType } from "./instruction-domain";

const GENERIC = "Gagal mengirim instruksi.";

const KNOWN_ERRORS = new Set([
  "INVALID_SESSION",
  "INVALID_TARGET_TYPE",
  "INVALID_MESSAGE",
  "INVALID_TARGET",
  "NO_ACTIVE_CREW",
]);

export type SendInstructionResult =
  | { ok: true; instructionId: string }
  | { ok: false; code: string; message: string };

export async function sendManagerInstructionCore(
  data: {
    managerToken: string;
    targetType: InstructionTargetType;
    targetRoleSessionId: string | null;
    message: string;
  },
  rpc: RpcCaller,
): Promise<SendInstructionResult> {
  try {
    const { data: result, error } = await rpc("send_manager_instruction", {
      p_manager_token: data.managerToken,
      p_target_type: data.targetType,
      p_target_role_session_id: data.targetRoleSessionId,
      p_message: data.message,
    });
    if (error) {
      const code = KNOWN_ERRORS.has(error.message) ? error.message : "UNAVAILABLE";
      return { ok: false, code, message: GENERIC };
    }
    return { ok: true, instructionId: String(result) };
  } catch {
    return { ok: false, code: "UNAVAILABLE", message: GENERIC };
  }
}

export type InstructionThreadResult =
  | { ok: true; threads: InstructionThread[] }
  | { ok: false; code: string; message: string };

function normalizeThread(raw: unknown): InstructionThread {
  const r = raw as Record<string, unknown>;
  const receipts = (Array.isArray(r.receipts) ? r.receipts : []).map((rc: unknown) => {
    const c = rc as Record<string, unknown>;
    return {
      roleSessionId: String(c.role_session_id),
      displayName: String(c.display_name),
      role: String(c.role),
      ackAt: typeof c.ack_at === "string" ? c.ack_at : null,
      replyText: typeof c.reply_text === "string" ? c.reply_text : null,
      repliedAt: typeof c.replied_at === "string" ? c.replied_at : null,
    } satisfies InstructionReceipt;
  });
  return {
    instructionId: String(r.instruction_id),
    message: String(r.message),
    targetType: r.target_type === "individual" ? "individual" : "all",
    targetDisplayName: typeof r.target_display_name === "string" ? r.target_display_name : null,
    createdAt: String(r.created_at),
    receipts,
  };
}

export async function getInstructionThreadCore(
  data: { managerToken: string; date?: string },
  rpc: RpcCaller,
): Promise<InstructionThreadResult> {
  try {
    const { data: raw, error } = await rpc("get_instruction_thread", {
      p_manager_token: data.managerToken,
      p_date: data.date ?? null,
    });
    if (error) {
      const code = error.message === "INVALID_SESSION" ? "INVALID_SESSION" : "UNAVAILABLE";
      return { ok: false, code, message: "Gagal memuat pesan." };
    }
    const rows = Array.isArray(raw) ? raw : [];
    return { ok: true, threads: rows.map(normalizeThread) };
  } catch {
    return { ok: false, code: "UNAVAILABLE", message: "Gagal memuat pesan." };
  }
}

export const sendManagerInstructionInputSchema = z.object({
  managerToken: z.string().min(1),
  accessToken: z.string().min(1),
  targetType: z.enum(["all", "individual"]),
  targetRoleSessionId: z.string().uuid().nullable(),
  message: z.string().min(1).max(200),
});

export const sendManagerInstruction = createServerFn({ method: "POST" })
  .validator(sendManagerInstructionInputSchema)
  .handler(async ({ data }): Promise<SendInstructionResult> => {
    const client = getAnonAuthedSupabaseClient(data.accessToken);
    if (!client) return { ok: false, code: "UNAVAILABLE", message: GENERIC };
    return sendManagerInstructionCore(
      {
        managerToken: data.managerToken,
        targetType: data.targetType,
        targetRoleSessionId: data.targetRoleSessionId,
        message: data.message,
      },
      async (fn, params) => client.rpc(fn, params),
    );
  });

export const getInstructionThreadInputSchema = z.object({
  managerToken: z.string().min(1),
  accessToken: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const getInstructionThread = createServerFn({ method: "GET" })
  .validator(getInstructionThreadInputSchema)
  .handler(async ({ data }): Promise<InstructionThreadResult> => {
    const client = getAnonAuthedSupabaseClient(data.accessToken);
    if (!client) return { ok: false, code: "UNAVAILABLE", message: "Gagal memuat pesan." };
    return getInstructionThreadCore(
      { managerToken: data.managerToken, date: data.date },
      async (fn, params) => client.rpc(fn, params),
    );
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/manager-instructions-server.test.ts`
Expected: PASS

- [ ] **Step 5: Format and commit**

```bash
npx prettier --write src/lib/manager-instructions.server.ts tests/manager-instructions-server.test.ts
git add src/lib/manager-instructions.server.ts tests/manager-instructions-server.test.ts
git commit -m "feat: add manager instruction server fns (send + thread)"
```

---

### Task 4: Server Functions — Crew Side

**Files:**
- Create: `src/lib/crew-instructions.server.ts`
- Test: `tests/crew-instructions-server.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// tests/crew-instructions-server.test.ts
import { describe, expect, it } from "vitest";
import {
  getPendingInstructionsCore,
  ackInstructionCore,
} from "../src/lib/crew-instructions.server";

describe("getPendingInstructionsCore", () => {
  it("normalizes pending instructions from RPC", async () => {
    const rpc = async () => ({
      data: [
        {
          instruction_id: "i1",
          message: "Meja 7 prioritas",
          manager_name: "Pak Dirga",
          created_at: "2026-09-07T07:00:00Z",
          expires_at: "2026-09-07T17:00:00Z",
        },
      ],
      error: null,
    });
    const r = await getPendingInstructionsCore({ roleSessionToken: "tok" }, rpc);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.instructions).toHaveLength(1);
      expect(r.instructions[0]).toMatchObject({
        instructionId: "i1",
        message: "Meja 7 prioritas",
        managerName: "Pak Dirga",
      });
    }
  });

  it("maps INVALID_SESSION error", async () => {
    const rpc = async () => ({ data: null, error: { message: "INVALID_SESSION" } });
    const r = await getPendingInstructionsCore({ roleSessionToken: "tok" }, rpc);
    expect(r).toMatchObject({ ok: false, code: "INVALID_SESSION" });
  });
});

describe("ackInstructionCore", () => {
  it("calls ack_instruction RPC and returns ok", async () => {
    const calls: [string, Record<string, unknown>][] = [];
    const rpc = async (fn: string, params: Record<string, unknown>) => {
      calls.push([fn, params]);
      return { data: true, error: null };
    };
    const r = await ackInstructionCore(
      { roleSessionToken: "tok", instructionId: "i1", replyText: "Siap" },
      rpc,
    );
    expect(r).toMatchObject({ ok: true });
    expect(calls[0][0]).toBe("ack_instruction");
    expect(calls[0][1]).toMatchObject({
      p_role_session_token: "tok",
      p_instruction_id: "i1",
      p_reply_text: "Siap",
    });
  });

  it("calls with null reply when no reply given", async () => {
    const calls: [string, Record<string, unknown>][] = [];
    const rpc = async (fn: string, params: Record<string, unknown>) => {
      calls.push([fn, params]);
      return { data: true, error: null };
    };
    await ackInstructionCore(
      { roleSessionToken: "tok", instructionId: "i1", replyText: null },
      rpc,
    );
    expect(calls[0][1].p_reply_text).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/crew-instructions-server.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/crew-instructions.server.ts
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getAnonAuthedSupabaseClient, type RpcCaller } from "./role-session.server";
import type { PendingInstruction } from "./instruction-domain";

const GENERIC = "Gagal memuat instruksi.";

export type PendingInstructionsResult =
  | { ok: true; instructions: PendingInstruction[] }
  | { ok: false; code: string; message: string };

export async function getPendingInstructionsCore(
  data: { roleSessionToken: string },
  rpc: RpcCaller,
): Promise<PendingInstructionsResult> {
  try {
    const { data: rows, error } = await rpc("get_pending_instructions", {
      p_role_session_token: data.roleSessionToken,
    });
    if (error) {
      const code = error.message === "INVALID_SESSION" ? "INVALID_SESSION" : "UNAVAILABLE";
      return { ok: false, code, message: GENERIC };
    }
    if (!Array.isArray(rows)) return { ok: false, code: "UNAVAILABLE", message: GENERIC };
    const instructions = rows.map((row) => {
      const r = row as Record<string, unknown>;
      return {
        instructionId: String(r.instruction_id),
        message: String(r.message),
        managerName: String(r.manager_name),
        createdAt: String(r.created_at),
        expiresAt: String(r.expires_at),
      } satisfies PendingInstruction;
    });
    return { ok: true, instructions };
  } catch {
    return { ok: false, code: "UNAVAILABLE", message: GENERIC };
  }
}

export type AckInstructionResult =
  | { ok: true }
  | { ok: false; code: string; message: string };

export async function ackInstructionCore(
  data: { roleSessionToken: string; instructionId: string; replyText: string | null },
  rpc: RpcCaller,
): Promise<AckInstructionResult> {
  try {
    const { error } = await rpc("ack_instruction", {
      p_role_session_token: data.roleSessionToken,
      p_instruction_id: data.instructionId,
      p_reply_text: data.replyText,
    });
    if (error) {
      const code = error.message === "INVALID_SESSION" ? "INVALID_SESSION" : "UNAVAILABLE";
      return { ok: false, code, message: "Gagal mengirim konfirmasi." };
    }
    return { ok: true };
  } catch {
    return { ok: false, code: "UNAVAILABLE", message: "Gagal mengirim konfirmasi." };
  }
}

export const getPendingInstructions = createServerFn({ method: "GET" })
  .validator(
    z.object({
      roleSessionToken: z.string().min(1),
      accessToken: z.string().min(1),
    }),
  )
  .handler(async ({ data }): Promise<PendingInstructionsResult> => {
    const client = getAnonAuthedSupabaseClient(data.accessToken);
    if (!client) return { ok: false, code: "UNAVAILABLE", message: GENERIC };
    return getPendingInstructionsCore(
      { roleSessionToken: data.roleSessionToken },
      async (fn, params) => client.rpc(fn, params),
    );
  });

export const ackInstruction = createServerFn({ method: "POST" })
  .validator(
    z.object({
      roleSessionToken: z.string().min(1),
      accessToken: z.string().min(1),
      instructionId: z.string().uuid(),
      replyText: z.string().max(100).nullable(),
    }),
  )
  .handler(async ({ data }): Promise<AckInstructionResult> => {
    const client = getAnonAuthedSupabaseClient(data.accessToken);
    if (!client) return { ok: false, code: "UNAVAILABLE", message: "Gagal mengirim konfirmasi." };
    return ackInstructionCore(
      {
        roleSessionToken: data.roleSessionToken,
        instructionId: data.instructionId,
        replyText: data.replyText,
      },
      async (fn, params) => client.rpc(fn, params),
    );
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/crew-instructions-server.test.ts`
Expected: PASS

- [ ] **Step 5: Format and commit**

```bash
npx prettier --write src/lib/crew-instructions.server.ts tests/crew-instructions-server.test.ts
git add src/lib/crew-instructions.server.ts tests/crew-instructions-server.test.ts
git commit -m "feat: add crew instruction server fns (pending + ack)"
```

---

### Task 5: Crew Blocking Banner Component

**Files:**
- Create: `src/components/InstructionBanner.tsx`
- Create: `src/hooks/use-pending-instructions.ts`
- Test: `tests/instruction-banner.test.ts`

- [ ] **Step 1: Write failing source-assertion test**

```ts
// tests/instruction-banner.test.ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const bannerSource = () =>
  readFileSync(
    new URL("../src/components/InstructionBanner.tsx", import.meta.url),
    "utf8",
  );

const hookSource = () =>
  readFileSync(
    new URL("../src/hooks/use-pending-instructions.ts", import.meta.url),
    "utf8",
  );

describe("InstructionBanner component", () => {
  it("renders a fixed overlay with z-50", () => {
    const src = bannerSource();
    expect(src).toContain("fixed");
    expect(src).toContain("z-50");
  });
  it("shows TERIMA button", () => {
    const src = bannerSource();
    expect(src).toContain("TERIMA");
  });
  it("has reply input with max 100 char", () => {
    const src = bannerSource();
    expect(src).toContain("maxLength={100}");
  });
  it("shows Balas & Terima toggle", () => {
    const src = bannerSource();
    expect(src).toContain("Balas");
  });
  it("imports ackInstruction server fn", () => {
    const src = bannerSource();
    expect(src).toContain("ackInstruction");
  });
  it("auto-dismisses expired instructions", () => {
    const src = bannerSource();
    expect(src).toContain("expiresAt");
  });
});

describe("use-pending-instructions hook", () => {
  it("fetches pending instructions on mount", () => {
    const src = hookSource();
    expect(src).toContain("getPendingInstructions");
  });
  it("listens for instruction realtime event", () => {
    const src = hookSource();
    expect(src).toContain("instruction");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/instruction-banner.test.ts`
Expected: FAIL — file not found

- [ ] **Step 3: Write the hook**

```ts
// src/hooks/use-pending-instructions.ts
import { useCallback, useEffect, useRef, useState } from "react";
import { getPendingInstructions } from "@/lib/crew-instructions.server";
import { getLiveAccessToken, getSupabaseBrowserClient } from "@/lib/supabase-browser";
import type { PendingInstruction } from "@/lib/instruction-domain";

export function usePendingInstructions(
  roleSessionToken: string,
  accessToken: string,
  restaurantId: string,
  roleSessionId: string,
) {
  const [pending, setPending] = useState<PendingInstruction[]>([]);
  const fetchedRef = useRef(false);

  const fetchPending = useCallback(async () => {
    const client = getSupabaseBrowserClient();
    const token = await getLiveAccessToken(client, accessToken);
    const result = await getPendingInstructions({
      data: { roleSessionToken, accessToken: token },
    });
    if (result.ok) setPending(result.instructions);
  }, [roleSessionToken, accessToken]);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    void fetchPending();
  }, [fetchPending]);

  useEffect(() => {
    const client = getSupabaseBrowserClient();
    if (!client || !restaurantId) return;
    const channelName = `table-occupancy:${restaurantId}`;
    const channel = (client as unknown as {
      channel: (name: string, opts: { config: { private: true } }) => {
        on: (type: string, filter: { event: string }, cb: (msg: unknown) => void) => unknown;
        subscribe: (cb: (status: string) => void) => unknown;
      };
    }).channel(channelName, { config: { private: true } });

    channel
      .on("broadcast", { event: "instruction" }, (msg: unknown) => {
        const payload = (msg as { payload?: Record<string, unknown> })?.payload;
        if (!payload) return;
        const targetId = payload.target_session_id as string | null;
        if (targetId && targetId !== roleSessionId) return;
        void fetchPending();
      })
      .subscribe(() => {});

    return () => {
      (client as unknown as { removeChannel: (ch: unknown) => void }).removeChannel(channel);
    };
  }, [restaurantId, roleSessionId, fetchPending]);

  const dismiss = useCallback((instructionId: string) => {
    setPending((prev) => prev.filter((p) => p.instructionId !== instructionId));
  }, []);

  return { pending, dismiss, refetch: fetchPending };
}
```

- [ ] **Step 4: Write the component**

```tsx
// src/components/InstructionBanner.tsx
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Megaphone, Loader2 } from "lucide-react";
import { ackInstruction } from "@/lib/crew-instructions.server";
import { getLiveAccessToken, getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { REPLY_MAX_LENGTH } from "@/lib/instruction-domain";
import type { PendingInstruction } from "@/lib/instruction-domain";
import { formatWibClock } from "@/lib/manager-crew-groups";

export function InstructionBanner({
  instructions,
  roleSessionToken,
  accessToken,
  onDismiss,
}: {
  instructions: PendingInstruction[];
  roleSessionToken: string;
  accessToken: string;
  onDismiss: (instructionId: string) => void;
}) {
  const current = instructions[0];
  if (!current) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-16">
      <BannerCard
        instruction={current}
        roleSessionToken={roleSessionToken}
        accessToken={accessToken}
        remaining={instructions.length}
        onDismiss={onDismiss}
      />
    </div>
  );
}

function BannerCard({
  instruction,
  roleSessionToken,
  accessToken,
  remaining,
  onDismiss,
}: {
  instruction: PendingInstruction;
  roleSessionToken: string;
  accessToken: string;
  remaining: number;
  onDismiss: (id: string) => void;
}) {
  const [showReply, setShowReply] = useState(false);
  const [replyText, setReplyText] = useState("");

  const expired = new Date(instruction.expiresAt).getTime() < Date.now();

  const ack = useMutation({
    mutationFn: async (reply: string | null) => {
      const client = getSupabaseBrowserClient();
      const token = await getLiveAccessToken(client, accessToken);
      return ackInstruction({
        data: {
          roleSessionToken,
          accessToken: token,
          instructionId: instruction.instructionId,
          replyText: reply,
        },
      });
    },
    onSuccess: () => onDismiss(instruction.instructionId),
  });

  if (expired) {
    onDismiss(instruction.instructionId);
    return null;
  }

  return (
    <div className="w-full max-w-md rounded-xl border border-ta-gray-200 bg-white p-5 shadow-xl dark:border-ta-gray-700 dark:bg-ta-gray-800">
      <div className="mb-3 flex items-center gap-2 text-brand-600 dark:text-brand-400">
        <Megaphone className="size-5 shrink-0" />
        <span className="text-xs font-bold uppercase">
          Instruksi dari {instruction.managerName}
        </span>
      </div>
      <p className="mb-1 text-sm font-semibold text-ta-gray-900 dark:text-white">
        {instruction.message}
      </p>
      <p className="mb-4 text-[11px] text-ta-gray-500 dark:text-ta-gray-400">
        {formatWibClock(instruction.createdAt)}
      </p>

      {remaining > 1 && (
        <p className="mb-3 text-[11px] font-bold text-ta-warning">
          +{remaining - 1} instruksi lainnya menunggu
        </p>
      )}

      {showReply && (
        <div className="mb-3">
          <input
            type="text"
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            maxLength={100}
            placeholder="Tulis balasan singkat..."
            className="w-full rounded-lg border border-ta-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 dark:border-ta-gray-600 dark:bg-ta-gray-700 dark:text-white"
          />
          <p className="mt-1 text-right text-[10px] text-ta-gray-400">
            {replyText.length}/{REPLY_MAX_LENGTH}
          </p>
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={ack.isPending}
          onClick={() => ack.mutate(showReply && replyText.trim() ? replyText.trim() : null)}
          className="flex-1 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {ack.isPending ? (
            <Loader2 className="mx-auto size-4 animate-spin" />
          ) : (
            "TERIMA"
          )}
        </button>
        {!showReply && (
          <button
            type="button"
            onClick={() => setShowReply(true)}
            className="text-xs font-semibold text-brand-600 hover:text-brand-700 dark:text-brand-400"
          >
            Balas & Terima
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/instruction-banner.test.ts`
Expected: PASS

- [ ] **Step 6: Format and commit**

```bash
npx prettier --write src/components/InstructionBanner.tsx src/hooks/use-pending-instructions.ts tests/instruction-banner.test.ts
git add src/components/InstructionBanner.tsx src/hooks/use-pending-instructions.ts tests/instruction-banner.test.ts
git commit -m "feat: add InstructionBanner component and usePendingInstructions hook"
```

---

### Task 6: Mount InstructionBanner in Crew Routes

**Files:**
- Modify: `src/routes/kasir/index.tsx`
- Modify: `src/routes/satgas/index.tsx`
- Modify: `src/routes/clear-up/index.tsx`
- Modify: `src/routes/index.tsx`

The same pattern applies to all 4 routes. For each route:

1. Add imports: `InstructionBanner` + `usePendingInstructions`
2. Call `usePendingInstructions(token, accessToken, restaurantId, roleSessionId)` inside the component
3. Render `<InstructionBanner ... />` at the top of the JSX return

- [ ] **Step 1: Edit `src/routes/kasir/index.tsx`**

Add import after existing imports:
```ts
import { InstructionBanner } from "@/components/InstructionBanner";
import { usePendingInstructions } from "@/hooks/use-pending-instructions";
```

Inside `KasirRoute()`, after the `useNotificationCenter()` call, add:
```ts
const { pending: pendingInstructions, dismiss: dismissInstruction } = usePendingInstructions(
  identity?.roleSessionToken ?? "",
  identity?.accessToken ?? "",
  identity?.restaurantId ?? "",
  identity?.roleSessionId ?? "",
);
```

At the very start of the JSX return (after `if (!identityHydrated || !identity) return null;`), wrap with a Fragment and add:
```tsx
<InstructionBanner
  instructions={pendingInstructions}
  roleSessionToken={identity.roleSessionToken}
  accessToken={identity.accessToken}
  onDismiss={dismissInstruction}
/>
```

- [ ] **Step 2: Edit `src/routes/satgas/index.tsx`** — same pattern as kasir

- [ ] **Step 3: Edit `src/routes/clear-up/index.tsx`** — same pattern as kasir

- [ ] **Step 4: Edit `src/routes/index.tsx`** (SS role) — same pattern, but uses `CrewSessionIdentity` not `RoleSessionIdentity`. The SS route uses `crewSessionToken` instead of `roleSessionToken`, and `crewSessionId` instead of `roleSessionId`. Adapt the hook call to use these fields. Note: SS uses `claim_crew_session` not `claim_role_session`; the `usePendingInstructions` hook validates via `role_session_tokens` — so SS crew would need a `role_session_token` as well. **If SS does NOT have a role_session_token** (it uses `crew_session_tokens` instead), skip mounting InstructionBanner on the SS route and add a TODO comment. Check `src/routes/index.tsx` for which token type SS uses.

Actually, looking at the codebase: SS crew uses `crew_sessions` + `crew_session_tokens`, NOT `crew_role_sessions` + `role_session_tokens`. The `get_pending_instructions` RPC validates via `role_session_tokens`. So **SS cannot receive instructions** with the current RPC design.

**Decision:** Skip SS route for now. Only mount on kasir, satgas, clear_up (which all use `role_session_tokens`).

- [ ] **Step 5: Format and commit**

```bash
npx prettier --write src/routes/kasir/index.tsx src/routes/satgas/index.tsx src/routes/clear-up/index.tsx
git add src/routes/kasir/index.tsx src/routes/satgas/index.tsx src/routes/clear-up/index.tsx
git commit -m "feat: mount InstructionBanner on kasir, satgas, clear-up routes"
```

---

### Task 7: Manager "PESAN" Tab

**Files:**
- Modify: `src/components/ManagerLayout.tsx`
- Modify: `src/routes/manager/index.tsx`
- Test: `tests/manager-messages-tab.test.ts`

- [ ] **Step 1: Write failing source-assertion test**

```ts
// tests/manager-messages-tab.test.ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const layoutSource = () =>
  readFileSync(
    new URL("../src/components/ManagerLayout.tsx", import.meta.url),
    "utf8",
  );

const routeSource = () =>
  readFileSync(
    new URL("../src/routes/manager/index.tsx", import.meta.url),
    "utf8",
  );

describe("ManagerLayout PESAN menu", () => {
  it("includes messages in ManagerMenu type", () => {
    const src = layoutSource();
    expect(src).toContain('"messages"');
  });
  it("has PESAN label with MessageSquare icon", () => {
    const src = layoutSource();
    expect(src).toContain("KIRIM INSTRUKSI");
    expect(src).toContain("MessageSquare");
  });
});

describe("Manager dashboard messages tab", () => {
  it("imports sendManagerInstruction and getInstructionThread", () => {
    const src = routeSource();
    expect(src).toContain("sendManagerInstruction");
    expect(src).toContain("getInstructionThread");
  });
  it("renders compose area with textarea and send button", () => {
    const src = routeSource();
    expect(src).toContain("KIRIM INSTRUKSI");
    expect(src).toContain("maxLength={200}");
  });
  it("renders target selector (SEMUA CREW or individual)", () => {
    const src = routeSource();
    expect(src).toContain("SEMUA CREW");
  });
  it("shows ACK status with checkmark", () => {
    const src = routeSource();
    expect(src).toContain("ackAt");
  });
  it("subscribes to instruction_ack realtime event", () => {
    const src = routeSource();
    expect(src).toContain("instruction_ack");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/manager-messages-tab.test.ts`
Expected: FAIL

- [ ] **Step 3: Update ManagerLayout — add "messages" menu**

In `src/components/ManagerLayout.tsx`:

Change the type to include `"messages"`:
```ts
export type ManagerMenu = "tables" | "crew" | "log" | "stats" | "messages";
```

Add import `MessageSquare` from lucide-react.

Update ICONS and LABELS:
```ts
const ICONS = { tables: Table2, crew: Users, log: ScrollText, stats: BarChart3, messages: MessageSquare } as const;
const LABELS: { id: ManagerMenu; label: string }[] = [
  { id: "tables", label: "LIHAT STATUS MEJA LIVE" },
  { id: "crew", label: "LIHAT CREW AKTIF" },
  { id: "messages", label: "KIRIM INSTRUKSI" },
  { id: "stats", label: "STATISTIK" },
  { id: "log", label: "LOG AKTIVITAS CREW" },
];
```

- [ ] **Step 4: Add messages tab content to manager/index.tsx**

Add imports at top of `src/routes/manager/index.tsx`:
```ts
import { sendManagerInstruction, getInstructionThread } from "@/lib/manager-instructions.server";
import { getManagerCrewHistory } from "@/lib/manager-dashboard.server";
import type { InstructionThread, InstructionReceipt } from "@/lib/instruction-domain";
import { INSTRUCTION_MAX_LENGTH, REPLY_MAX_LENGTH } from "@/lib/instruction-domain";
```

Inside `ManagerDashboard()`, add queries and mutation for messages tab:
```ts
const threads = useQuery({
  queryKey: ["instruction-thread", restaurantId],
  queryFn: async () =>
    getInstructionThread({
      data: {
        managerToken: identity!.managerToken,
        accessToken: await getLiveAccessToken(getSupabaseBrowserClient(), identity!.accessToken),
      },
    }),
  enabled: Boolean(identity) && menu === "messages",
  refetchInterval: 30_000,
});

const activeCrew = useQuery({
  queryKey: ["manager-active-crew-for-messages", restaurantId],
  queryFn: async () =>
    getManagerCrewHistory({
      data: {
        managerToken: identity!.managerToken,
        accessToken: await getLiveAccessToken(getSupabaseBrowserClient(), identity!.accessToken),
      },
    }),
  enabled: Boolean(identity) && menu === "messages",
});
```

Add state for compose form:
```ts
const [msgTarget, setMsgTarget] = useState<"all" | string>("all");
const [msgText, setMsgText] = useState("");
```

Add mutation for sending:
```ts
const sendInstruction = useMutation({
  mutationFn: async () =>
    sendManagerInstruction({
      data: {
        managerToken: identity!.managerToken,
        accessToken: await getLiveAccessToken(getSupabaseBrowserClient(), identity!.accessToken),
        targetType: msgTarget === "all" ? "all" : "individual",
        targetRoleSessionId: msgTarget === "all" ? null : msgTarget,
        message: msgText,
      },
    }),
  onSuccess: (result) => {
    if (result.ok) {
      setMsgText("");
      void queryClient.invalidateQueries({ queryKey: ["instruction-thread", restaurantId] });
    }
  },
});
```

Add the `{menu === "messages" && (...)}` JSX block after the existing stats section, containing:
- Compose area: target dropdown, textarea (maxLength={200}), "KIRIM INSTRUKSI" button
- Thread list: map `threads.data?.threads` showing each instruction card with receipts
- Each receipt: `✓`/`✗` + displayName + ackAt time + replyText
- Progress indicator: "N/M sudah terima"

Add `instruction_ack` realtime listener: extend the existing `useTableOccupancyRealtime` hook's channel (already subscribed) to also handle `instruction_ack` events by invalidating the thread query. This can be done by adding a new `useEffect` that subscribes to the same channel for the `instruction_ack` event.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/manager-messages-tab.test.ts`
Expected: PASS

- [ ] **Step 6: Format and commit**

```bash
npx prettier --write src/components/ManagerLayout.tsx src/routes/manager/index.tsx tests/manager-messages-tab.test.ts
git add src/components/ManagerLayout.tsx src/routes/manager/index.tsx tests/manager-messages-tab.test.ts
git commit -m "feat: add PESAN tab to Manager Dashboard with compose + thread view"
```

---

### Task 8: Full Quality Gate

- [ ] **Step 1: Run `npm run verify`**

```bash
npm run verify
```

Expected: exit 0 (all tests pass, typecheck clean, lint clean, build clean).

- [ ] **Step 2: Fix any issues found**

If tests/typecheck/lint/build fail, fix issues and re-run until exit 0.

- [ ] **Step 3: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "chore: fix quality gate issues for manager-crew messaging"
```

- [ ] **Step 4: Apply migration to Supabase production**

Use `supabase_apply_migration` tool.

- [ ] **Step 5: STOP — ask user permission before pushing to main**
