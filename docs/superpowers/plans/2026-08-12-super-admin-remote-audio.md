# Super Admin Remote Audio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optional Supabase-backed foreground remote playback of existing bundled soundboard audio on a selected dashboard browser, without breaking dashboard authentication or manual playback when Supabase is absent.

**Architecture:** `src/lib/remote-audio-domain.ts` contains server-safe catalog metadata, validation, ordering, and presence rules; it must not import Vite asset URLs. `src/lib/audio.ts` remains the browser-only bundled-URL catalog and combines its URLs with that metadata. Crew browsers use anonymous Supabase auth, RPC-only presence/acknowledgement, and INSERT-only Realtime delivery; protected TanStack Start server functions use a service-role client to read presence/audit and insert commands.

**Tech Stack:** TanStack Start/React 19, TanStack Query, Zod, `@supabase/supabase-js`, Supabase Postgres/RLS/Realtime, bundled Vite MP3 assets, Vitest.

---

## File structure

| File | Responsibility |
| --- | --- |
| `src/lib/audio.ts` | Existing Vite `import.meta.glob` bundled URLs; compose browser playback catalog from metadata. |
| `src/lib/remote-audio-domain.ts` | Pure server-safe IDs/labels, input normalization, command/presence rules, shared types. No `import.meta`, browser globals, or asset imports. |
| `src/lib/supabase-browser.ts` | Lazy browser-only anonymous Supabase client using public `VITE_*` values. |
| `src/lib/remote-audio.server.ts` | `*.server.ts` protected server functions; service-role client, snapshot, and command insertion. Do not import `server-only`: ESLint forbids it. |
| `src/lib/auth.ts` | Dashboard-only login/status, reusing `readEnv` and timing-safe `safeEqual` for a Super Admin session bit. |
| `src/lib/auth.server.ts` | Session bit plus `requireSuperAdmin`. |
| `src/hooks/use-remote-crew.ts` | Visible foreground claim/heartbeat, INSERT delivery, no replay, acknowledgement. |
| `src/components/CrewIdentityDialog.tsx` | Name entry, real muted bundled-audio unlock on `LANJUT!!`, recovery control. |
| `src/routes/index.tsx` | Existing local playback plus remote override: newest valid remote command stops previous audio; local controls still reject concurrent starts. |
| `src/routes/super-admin.tsx` | Dedicated `/super-admin` protected login, live eligible targets, catalog selection, send, audit. |
| `supabase/migrations/20260812000000_super_admin_remote_audio.sql` | Tables, atomic RPCs, deny-by-default RLS, Realtime, retention functions, optional pg_cron schedule. |
| `tests/*.test.ts` | Node tests included in `tsconfig.json`; every newly introduced test starts red. |

`src/routeTree.gen.ts` is generated. Never edit it. Creating `src/routes/super-admin.tsx` causes the configured TanStack/Vite plugin to generate the route during `npm run build`; stage its generated diff only after that command.

### Task 1: Install test/runtime dependencies and include tests in typecheck

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `tsconfig.json:2`
- Create: `vitest.config.ts`

- [ ] **Step 1: Add scripts and package names**

Add `"test": "vitest run"` to `scripts`. Run this exact install; let npm choose compatible current versions and update `package-lock.json`:

```bash
npm install @supabase/supabase-js && npm install -D vitest
```

Expected: both commands exit `0`; `package.json` and `package-lock.json` list both packages. Do not install `server-only` or `jsdom`.

- [ ] **Step 2: Create the Node test configuration**

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});
```

- [ ] **Step 3: Include tests in the compiler project**

Change `tsconfig.json` `include` to:

```json
["src/**/*.ts", "src/**/*.tsx", "tests/**/*.ts", "vite.config.ts", "vitest.config.ts", "eslint.config.js"]
```

- [ ] **Step 4: Verify baseline commands**

Run: `npm test && npx tsc --noEmit`

Expected: both exit `0`; Vitest may report no tests yet, but must exit `0` after adding `passWithNoTests: true` only if the installed version otherwise exits non-zero.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts
git commit -m "chore: add remote audio test tooling"
```

### Task 2: Create server-safe catalog metadata and pure remote rules

**Files:**
- Create: `src/lib/remote-audio-domain.ts`
- Modify: `src/lib/audio.ts:15-89`
- Create: `tests/remote-audio-domain.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/remote-audio-domain.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  ANNOUNCEMENT_CATALOG,
  COMMAND_TTL_MS,
  commandIsProcessable,
  getCatalogMetadata,
  normalizeCrewName,
  sessionIsEligible,
} from "../src/lib/remote-audio-domain";

describe("remote audio domain", () => {
  it("exposes all six existing announcement IDs without asset URLs", () => {
    expect(ANNOUNCEMENT_CATALOG.map(({ id }) => id)).toEqual([
      "seating", "himbauan-barang-bawaan-pelanggan", "outside-food", "no-smoking", "larangan-gabung-meja", "jam-buka-resto",
    ]);
    expect(getCatalogMetadata("announcement:no-smoking")).toEqual({ id: "announcement:no-smoking", label: "Dilarang Merokok di Area Lobby" });
  });

  it("normalizes valid crew names and rejects invalid input", () => {
    expect(normalizeCrewName("  Rina  ")).toEqual({ displayName: "Rina", normalizedName: "rina" });
    expect(normalizeCrewName(" ")).toEqual({ error: "Nama wajib diisi." });
    expect(normalizeCrewName("Rina<>")).toEqual({ error: "Nama berisi karakter yang tidak didukung." });
  });

  it("requires a visible heartbeat no older than thirty seconds", () => {
    const now = Date.parse("2026-08-12T10:00:30.000Z");
    expect(sessionIsEligible({ connectionState: "connected", visibilityState: "visible", audioReady: true, lastSeen: "2026-08-12T10:00:00.000Z" }, now)).toBe(true);
    expect(sessionIsEligible({ connectionState: "connected", visibilityState: "hidden", audioReady: true, lastSeen: "2026-08-12T10:00:01.000Z" }, now)).toBe(false);
  });

  it("accepts a newest unexpired targeted command once", () => {
    const command = { id: "new", targetSessionId: "crew-1", audioId: "table:7" as const, createdAt: "2026-08-12T10:00:02.000Z", expiresAt: "2026-08-12T10:00:07.000Z" };
    const now = Date.parse("2026-08-12T10:00:03.000Z");
    expect(commandIsProcessable(command, "crew-1", new Set(), null, now)).toBe(true);
    expect(commandIsProcessable(command, "crew-1", new Set(["new"]), null, now)).toBe(false);
    expect(commandIsProcessable({ ...command, id: "old", createdAt: "2026-08-12T10:00:01.000Z" }, "crew-1", new Set(), command.createdAt, now)).toBe(false);
    expect(COMMAND_TTL_MS).toBe(5_000);
  });
});
```

- [ ] **Step 2: Run red test**

Run: `npx vitest run tests/remote-audio-domain.test.ts`

Expected: FAIL with `Failed to resolve import "../src/lib/remote-audio-domain"`.

- [ ] **Step 3: Implement the pure module**

Create `src/lib/remote-audio-domain.ts`:

```ts
export const HEARTBEAT_MS = 10_000;
export const ONLINE_WINDOW_MS = 30_000;
export const COMMAND_TTL_MS = 5_000;
export const FAILURE_REASON_MAX_LENGTH = 160;

export const ANNOUNCEMENT_CATALOG = [
  { id: "seating", label: "Himbauan Duduk Sesuai Nomor Meja" },
  { id: "himbauan-barang-bawaan-pelanggan", label: "Himbauan Barang Bawaan Pelanggan" },
  { id: "outside-food", label: "Dilarang Bawa Makanan Dari Luar" },
  { id: "no-smoking", label: "Dilarang Merokok di Area Lobby" },
  { id: "larangan-gabung-meja", label: "Dilarang Gabungkan Meja" },
  { id: "jam-buka-resto", label: "Informasi Jam Buka Tutup Resto" },
] as const;

export type AnnouncementId = (typeof ANNOUNCEMENT_CATALOG)[number]["id"];
export type AudioId = `table:${number}` | `announcement:${AnnouncementId}`;
export type CatalogMetadata = { id: AudioId; label: string };
export type RemoteCommand = { id: string; targetSessionId: string; audioId: AudioId; createdAt: string; expiresAt: string };
export type CrewSessionEligibility = { connectionState: "connected" | "disconnected"; visibilityState: "visible" | "hidden"; audioReady: boolean; lastSeen: string };

export function getCatalogMetadata(id: string): CatalogMetadata | null {
  if (/^table:[1-9][0-9]*$/.test(id)) return { id: id as AudioId, label: `Meja ${id.slice(6)}` };
  const announcement = ANNOUNCEMENT_CATALOG.find((item) => `announcement:${item.id}` === id);
  return announcement ? { id: `announcement:${announcement.id}`, label: announcement.label } : null;
}

export function normalizeCrewName(value: string): { displayName: string; normalizedName: string } | { error: string } {
  const displayName = value.trim().replace(/\s+/g, " ");
  if (!displayName) return { error: "Nama wajib diisi." };
  if (displayName.length > 40) return { error: "Nama maksimal 40 karakter." };
  if (!/^[\p{L}\p{N} .,'-]+$/u.test(displayName)) return { error: "Nama berisi karakter yang tidak didukung." };
  return { displayName, normalizedName: displayName.toLocaleLowerCase("id-ID") };
}

export function sessionIsEligible(session: CrewSessionEligibility, now: number): boolean {
  const seen = Date.parse(session.lastSeen);
  return session.audioReady && session.connectionState === "connected" && session.visibilityState === "visible" && Number.isFinite(seen) && now - seen <= ONLINE_WINDOW_MS;
}

export function commandIsProcessable(command: RemoteCommand, sessionId: string, processedIds: ReadonlySet<string>, newestCreatedAt: string | null, now: number): boolean {
  const created = Date.parse(command.createdAt);
  const expires = Date.parse(command.expiresAt);
  return command.targetSessionId === sessionId && !processedIds.has(command.id) && Number.isFinite(created) && Number.isFinite(expires) && expires > now && (!newestCreatedAt || created > Date.parse(newestCreatedAt));
}

export function boundedFailureReason(error: unknown): string {
  return (error instanceof Error ? error.message : "Pemutaran audio gagal.").slice(0, FAILURE_REASON_MAX_LENGTH);
}
```

- [ ] **Step 4: Compose browser URLs only in `audio.ts`**

Keep `import.meta.glob` in `src/lib/audio.ts`. Import `ANNOUNCEMENT_CATALOG`, `getCatalogMetadata`, and `type AudioId` from `./remote-audio-domain`; add this export after `readyTables`:

```ts
export type CatalogAudio = { id: AudioId; label: string; url: string };

export const bundledAudioCatalog: readonly CatalogAudio[] = [
  ...ANNOUNCEMENT_CATALOG.flatMap((announcement) => {
    const url = announcementAudioUrls[announcement.id];
    return url ? [{ id: `announcement:${announcement.id}` as AudioId, label: announcement.label, url }] : [];
  }),
  ...[...tableAudioUrls.entries()]
    .sort(([a], [b]) => a - b)
    .flatMap(([tableNumber, url]) => {
      const metadata = getCatalogMetadata(`table:${tableNumber}`);
      return metadata ? [{ ...metadata, url }] : [];
    }),
];
```

This is the only URL-bearing catalog. `remote-audio.server.ts` must import only `remote-audio-domain.ts`, never `audio.ts`, because Vite asset glob URLs are browser-build concerns.

- [ ] **Step 5: Verify green test and typecheck**

Run: `npx vitest run tests/remote-audio-domain.test.ts && npx tsc --noEmit`

Expected: PASS, 4 tests; then exit `0`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/remote-audio-domain.ts src/lib/audio.ts tests/remote-audio-domain.test.ts
git commit -m "feat: add server-safe remote audio catalog"
```

### Task 3: Add atomic Supabase schema, RPCs, RLS, Realtime, retention

**Files:**
- Create: `supabase/migrations/20260812000000_super_admin_remote_audio.sql`
- Create: `docs/supabase-super-admin-remote-audio.md`

- [ ] **Step 1: Create migration**

Create `supabase/migrations/20260812000000_super_admin_remote_audio.sql`:

```sql
create extension if not exists pgcrypto;

create table public.crew_sessions (
  id uuid primary key,
  normalized_name text not null,
  display_name text not null check (char_length(display_name) between 1 and 40),
  device_description text not null check (char_length(device_description) between 1 and 200),
  audio_ready boolean not null default false,
  visibility_state text not null check (visibility_state in ('visible', 'hidden')),
  connection_state text not null check (connection_state in ('connected', 'disconnected')),
  last_seen timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  offline_at timestamptz
);
create unique index crew_sessions_online_name_key on public.crew_sessions (normalized_name) where connection_state = 'connected';

create table public.remote_commands (
  id uuid primary key default gen_random_uuid(),
  target_session_id uuid not null references public.crew_sessions(id) on delete cascade,
  audio_id text not null check (audio_id ~ '^(table:[1-9][0-9]*|announcement:(seating|himbauan-barang-bawaan-pelanggan|outside-food|no-smoking|larangan-gabung-meja|jam-buka-resto))$'),
  actor text not null check (actor = 'super-admin'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  status text not null default 'sent' check (status in ('sent', 'played', 'failed', 'expired')),
  acknowledged_at timestamptz,
  failure_reason text check (char_length(failure_reason) <= 160),
  check (expires_at = created_at + interval '5 seconds'),
  check ((status = 'failed') = (failure_reason is not null)),
  check ((status in ('played', 'failed')) = (acknowledged_at is not null))
);
create index remote_commands_target_created_at_idx on public.remote_commands (target_session_id, created_at desc);
create index remote_commands_created_at_idx on public.remote_commands (created_at);

create or replace function public.claim_crew_session(p_display_name text, p_normalized_name text, p_device_description text, p_audio_ready boolean, p_visibility_state text)
returns public.crew_sessions language plpgsql security definer set search_path = public as $$
declare result public.crew_sessions;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  if p_display_name !~ '^[[:print:]]+$' or char_length(p_display_name) not between 1 and 40 then raise exception 'INVALID_NAME'; end if;
  if p_normalized_name <> lower(trim(regexp_replace(p_display_name, '\s+', ' ', 'g'))) then raise exception 'INVALID_NAME'; end if;
  if p_device_description = '' or char_length(p_device_description) > 200 then raise exception 'INVALID_DEVICE'; end if;
  if p_visibility_state not in ('visible', 'hidden') then raise exception 'INVALID_VISIBILITY'; end if;
  update public.crew_sessions set connection_state = 'disconnected', offline_at = now(), updated_at = now() where connection_state = 'connected' and last_seen <= now() - interval '30 seconds';
  insert into public.crew_sessions (id, normalized_name, display_name, device_description, audio_ready, visibility_state, connection_state, last_seen, offline_at)
  values (auth.uid(), p_normalized_name, p_display_name, p_device_description, p_audio_ready, p_visibility_state, case when p_visibility_state = 'visible' then 'connected' else 'disconnected' end, now(), case when p_visibility_state = 'visible' then null else now() end)
  on conflict (id) do update set normalized_name = excluded.normalized_name, display_name = excluded.display_name, device_description = excluded.device_description, audio_ready = excluded.audio_ready, visibility_state = excluded.visibility_state, connection_state = excluded.connection_state, last_seen = now(), offline_at = excluded.offline_at, updated_at = now()
  returning * into result;
  return result;
end $$;

create or replace function public.heartbeat_crew_session(p_audio_ready boolean, p_visibility_state text, p_connection_state text)
returns public.crew_sessions language plpgsql security definer set search_path = public as $$
declare result public.crew_sessions;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  if p_visibility_state not in ('visible', 'hidden') or p_connection_state not in ('connected', 'disconnected') then raise exception 'INVALID_PRESENCE'; end if;
  update public.crew_sessions set audio_ready = p_audio_ready, visibility_state = p_visibility_state, connection_state = p_connection_state, last_seen = now(), offline_at = case when p_connection_state = 'connected' and p_visibility_state = 'visible' then null else now() end, updated_at = now() where id = auth.uid() returning * into result;
  if result.id is null then raise exception 'SESSION_NOT_FOUND'; end if;
  return result;
end $$;

create or replace function public.ack_remote_command(p_command_id uuid, p_status text, p_failure_reason text default null)
returns public.remote_commands language plpgsql security definer set search_path = public as $$
declare result public.remote_commands;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  if p_status not in ('played', 'failed') then raise exception 'INVALID_STATUS'; end if;
  update public.remote_commands set status = p_status, acknowledged_at = now(), failure_reason = case when p_status = 'failed' then left(coalesce(nullif(p_failure_reason, ''), 'Pemutaran audio gagal.'), 160) else null end
  where id = p_command_id and target_session_id = auth.uid() and status = 'sent' and expires_at > now()
  returning * into result;
  if result.id is null then raise exception 'COMMAND_NOT_ACKNOWLEDGEABLE'; end if;
  return result;
end $$;

create or replace function public.expire_remote_commands() returns integer language sql security definer set search_path = public as $$
  with changed as (update public.remote_commands set status = 'expired' where status = 'sent' and expires_at <= now() returning 1) select count(*)::integer from changed;
$$;
create or replace function public.cleanup_remote_commands() returns integer language sql security definer set search_path = public as $$
  with deleted as (delete from public.remote_commands where created_at < now() - interval '7 days' returning 1) select count(*)::integer from deleted;
$$;

alter table public.crew_sessions enable row level security;
alter table public.remote_commands enable row level security;
revoke all on public.crew_sessions, public.remote_commands from anon, authenticated;
grant execute on function public.claim_crew_session(text, text, text, boolean, text), public.heartbeat_crew_session(boolean, text, text), public.ack_remote_command(uuid, text, text) to authenticated;
grant select on public.crew_sessions, public.remote_commands to authenticated;
create policy "crew reads own session" on public.crew_sessions for select to authenticated using (id = auth.uid());
create policy "crew reads targeted commands" on public.remote_commands for select to authenticated using (target_session_id = auth.uid());
alter publication supabase_realtime add table public.remote_commands;
```

- [ ] **Step 2: Document concrete Hobby-safe retention**

Create `docs/supabase-super-admin-remote-audio.md`:

```md
# Supabase remote audio operations

Apply migration:

```bash
npx supabase db push
```

Retention is not on the playback path. In projects where Database Extensions permits `pg_cron`, run once in SQL Editor:

```sql
create extension if not exists pg_cron;
select cron.schedule('expire-remote-commands-every-minute', '* * * * *', $$select public.expire_remote_commands()$$);
select cron.schedule('cleanup-remote-commands-daily', '17 3 * * *', $$select public.cleanup_remote_commands()$$);
```

On Supabase Hobby projects where `pg_cron` is unavailable, do not run either statement. Create a Supabase Dashboard Scheduled Function named `remote-audio-retention`, schedule `17 3 * * *`, and give it this Edge Function body:

```ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
Deno.serve(async () => {
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { error: expireError } = await supabase.rpc("expire_remote_commands");
  if (expireError) return new Response(expireError.message, { status: 500 });
  const { error: cleanupError } = await supabase.rpc("cleanup_remote_commands");
  return cleanupError ? new Response(cleanupError.message, { status: 500 }) : new Response("ok");
});
```

The scheduled function is optional operational cleanup: its failure never changes command delivery, acknowledgement, or local soundboard playback.
```

- [ ] **Step 3: Apply and verify database boundary**

Run: `npx supabase db push`

Expected: exit `0`, migration applies. In SQL Editor run:

```sql
select proname from pg_proc where proname in ('claim_crew_session','heartbeat_crew_session','ack_remote_command','expire_remote_commands','cleanup_remote_commands') order by proname;
select tablename, rowsecurity from pg_tables where schemaname = 'public' and tablename in ('crew_sessions','remote_commands') order by tablename;
```

Expected: first query returns five names; second returns both tables with `true`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260812000000_super_admin_remote_audio.sql docs/supabase-super-admin-remote-audio.md
git commit -m "feat: add remote audio Supabase schema"
```

### Task 4: Add Super Admin auth and protected server functions

**Files:**
- Modify: `src/lib/auth.server.ts:9-11,66-72`
- Modify: `src/lib/auth.ts:3-63`
- Create: `src/lib/remote-audio.server.ts`
- Create: `tests/auth-super-admin.test.ts`
- Create: `tests/remote-audio-server.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/auth-super-admin.test.ts`:

```ts
import { expect, it } from "vitest";
import { isSuperAdminPasswordValid } from "../src/lib/auth";

it("uses absent environment as fail-closed and compares valid passwords", () => {
  expect(isSuperAdminPasswordValid("secret", null)).toBe(false);
  expect(isSuperAdminPasswordValid("secret", "other")).toBe(false);
  expect(isSuperAdminPasswordValid("secret", "secret")).toBe(true);
});
```

Create `tests/remote-audio-server.test.ts`:

```ts
import { expect, it } from "vitest";
import { validateCommandRequest } from "../src/lib/remote-audio.server";

it("rejects invalid targets and non-catalog audio", () => {
  expect(validateCommandRequest({ targetSessionId: "bad", audioId: "table:7" }, [], ["table:7"])).toEqual({ error: "Target crew tidak valid." });
  expect(validateCommandRequest({ targetSessionId: "d2719c7e-5b88-4ee3-8a45-7c95305a3023", audioId: "announcement:missing" }, [{ id: "d2719c7e-5b88-4ee3-8a45-7c95305a3023", eligible: true }], ["table:7"])).toEqual({ error: "Audio tidak tersedia." });
});
```

- [ ] **Step 2: Run red tests**

Run: `npx vitest run tests/auth-super-admin.test.ts tests/remote-audio-server.test.ts`

Expected: FAIL because neither export exists.

- [ ] **Step 3: Reuse existing auth helpers**

In `src/lib/auth.server.ts`, add `superAdmin?: boolean` to `TableTalkerSession`; add:

```ts
export async function requireSuperAdmin() {
  const session = await getAuthSession();
  if (session.data.superAdmin !== true) throw new Error("UNAUTHORIZED");
  return session;
}
```

In `src/lib/auth.ts`, change `AuthStatus` to `{ dashboard: boolean; superAdmin: boolean }`; return both bits from `getAuthStatus`. Keep `readEnv` and `safeEqual` private and reuse them; add:

```ts
export function isSuperAdminPasswordValid(password: string, expectedPassword: string | null): boolean {
  return expectedPassword !== null && safeEqual(password, expectedPassword);
}

export const loginSuperAdmin = createServerFn({ method: "POST" })
  .inputValidator((data: LoginInput) => data)
  .handler(async ({ data }): Promise<{ ok: boolean; message?: string }> => {
    const { updateAuthSession } = await import("./auth.server");
    const expectedPassword = readEnv("SUPER_ADMIN_PASSWORD");
    if (!isSuperAdminPasswordValid(data.password, expectedPassword)) return { ok: false, message: expectedPassword === null ? MISCONFIGURED_MESSAGE : "Password Super Admin salah." };
    await updateAuthSession({ superAdmin: true });
    return { ok: true };
  });
```

Do not add roles, `/manage`, client claims, fallback passwords, or a second comparison helper.

- [ ] **Step 4: Implement server-only-by-filename module**

Create `src/lib/remote-audio.server.ts`. It must import `createServerFn`, `createClient`, `z`, `requireSuperAdmin`, and pure functions/types from `./remote-audio-domain`; it must not import `server-only`, `audio.ts`, `import.meta`, or a browser module. Define `getServiceClient()` using `process.env.SUPABASE_URL` and `process.env.SUPABASE_SERVICE_ROLE_KEY`; return `null` when either is missing. Export this validator:

```ts
const uuid = z.string().uuid();

export function validateCommandRequest(input: { targetSessionId: string; audioId: string }, sessions: Array<{ id: string; eligible: boolean }>, catalogIds: readonly string[]): { error: string } | { targetSessionId: string; audioId: string } {
  if (!uuid.safeParse(input.targetSessionId).success) return { error: "Target crew tidak valid." };
  if (!sessions.some((session) => session.id === input.targetSessionId && session.eligible)) return { error: "Crew tidak sedang siap menerima audio." };
  if (!catalogIds.includes(input.audioId)) return { error: "Audio tidak tersedia." };
  return input;
}
```

Implement `getRemoteAdminSnapshot` and `sendRemoteCommand` as `createServerFn` handlers. Both call `requireSuperAdmin()` first. The snapshot uses service role to select `crew_sessions` and commands from `created_at >= now() - interval '7 days'`, computes `eligible` with `sessionIsEligible`, and returns catalog metadata assembled from all `ANNOUNCEMENT_CATALOG` entries plus `table:1` through `table:70`; no URL is returned. `sendRemoteCommand` re-reads sessions, validates one selected target and ID, inserts `{ target_session_id, audio_id, actor: "super-admin", expires_at: new Date(Date.now() + COMMAND_TTL_MS).toISOString() }`. Missing config or Supabase error returns `{ offline: true, message: "Realtime offline" }`; unauthorised requests still throw `UNAUTHORIZED`.

- [ ] **Step 5: Verify green tests, lint, types**

Run: `npx vitest run tests/auth-super-admin.test.ts tests/remote-audio-server.test.ts && npm run lint && npx tsc --noEmit`

Expected: 2 passing tests; lint and typecheck exit `0`. In particular, no ESLint `no-restricted-imports` error for `server-only` exists because it was not imported.

- [ ] **Step 6: Commit**

```bash
git add src/lib/auth.ts src/lib/auth.server.ts src/lib/remote-audio.server.ts tests/auth-super-admin.test.ts tests/remote-audio-server.test.ts
git commit -m "feat: add Super Admin remote command boundary"
```

### Task 5: Add anonymous crew transport with one-shot ordering

**Files:**
- Create: `src/lib/supabase-browser.ts`
- Create: `src/hooks/use-remote-crew.ts`
- Create: `tests/supabase-browser.test.ts`

- [ ] **Step 1: Write a failing browser-client contract test**

Create `tests/supabase-browser.test.ts`:

```ts
import { expect, it } from "vitest";
import { getSupabaseBrowserClient } from "../src/lib/supabase-browser";

it("exports the lazy public Supabase client factory", () => {
  expect(getSupabaseBrowserClient).toBeTypeOf("function");
});
```

- [ ] **Step 2: Run red test**

Run: `npx vitest run tests/supabase-browser.test.ts`

Expected: FAIL with `Failed to resolve import "../src/lib/supabase-browser"`.

- [ ] **Step 3: Create browser client**

Create `src/lib/supabase-browser.ts`:

```ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;
export function getSupabaseBrowserClient(): SupabaseClient | null {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  client ??= createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}
```

- [ ] **Step 4: Implement hook**

Create `src/hooks/use-remote-crew.ts` exporting `useRemoteCrew({ registration, playRemoteAudio })`, where `registration` is `{ displayName: string; normalizedName: string; audioReady: boolean } | null` and `playRemoteAudio(audioId)` resolves only once playback starts.

Within one effect: return offline without retry when no client/registration; call `signInAnonymously()`, get `user.id`, call `claim_crew_session`; subscribe solely to `postgres_changes` `INSERT` on `remote_commands` filtered by `target_session_id=eq.${user.id}`. Never query commands, including on reconnect. Before playback, pass row payload through `commandIsProcessable`, add ID to `processedIdsRef`, and set `newestCreatedAtRef` before awaiting playback. Valid newer commands call `playRemoteAudio`; that callback stops any prior audio. Older/equal, duplicate, wrong-target, expired commands do nothing. Acknowledge `played`; catch playback failure, set `needsAudioRecovery`, then acknowledge `failed` with `boundedFailureReason`. An acknowledgement error only sets `deliveryUncertain`; it never retries playback.

Call heartbeat after claim and every `HEARTBEAT_MS` while `document.visibilityState === "visible"`; send disconnected/hidden best effort on `visibilitychange`, `pagehide`, and cleanup. Return `retryAudioUnlock` as a state setter only; it must not call audio because it is not itself a user gesture.

- [ ] **Step 5: Verify**

Run: `npm test && npm run lint && npx tsc --noEmit`

Expected: all tests pass; lint/typecheck exit `0`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/supabase-browser.ts src/hooks/use-remote-crew.ts tests/supabase-browser.test.ts
git commit -m "feat: add foreground remote crew transport"
```

### Task 6: Integrate real bundled-audio unlock and remote replacement playback

**Files:**
- Create: `src/components/CrewIdentityDialog.tsx`
- Modify: `src/routes/index.tsx:1-401`
- Create: `tests/audio-unlock.test.ts`

- [ ] **Step 1: Write failing pure unlock-source test**

Create `tests/audio-unlock.test.ts`:

```ts
import { expect, it } from "vitest";
import { getUnlockAudioUrl } from "../src/lib/audio";

it("chooses a real bundled catalog URL for muted audio unlock", () => {
  expect(getUnlockAudioUrl).toBeTypeOf("function");
});
```

- [ ] **Step 2: Run red test**

Run: `npx vitest run tests/audio-unlock.test.ts`

Expected: FAIL because `getUnlockAudioUrl` is not exported.

- [ ] **Step 3: Export real unlock source**

Add to `src/lib/audio.ts`:

```ts
export function getUnlockAudioUrl(): string | null {
  return bundledAudioCatalog[0]?.url ?? null;
}
```

- [ ] **Step 4: Implement modal and route integration**

`CrewIdentityDialog` uses existing `Dialog`, `DialogContent`, `DialogDescription`, and `DialogTitle`. It has required labelled name input, an alert for `normalizeCrewName` errors, `LANJUT!!`, offline copy `Remote control tidak tersedia. Soundboard tetap bisa dipakai.`, and `Aktifkan Suara` only when requested.

In `index.tsx`, preserve the current manual `play` lock: manual table/announcement calls still return while `activeAudioIdRef.current !== null`. Add a separate `playRemoteAudio(audioId)` that finds `bundledAudioCatalog`, calls existing `stop()` first, creates a new `Audio(url)`, and resolves from its `playing` event; reject on `error` or `audio.play()` rejection. Remote newest therefore replaces current audio, while older commands never reach this callback.

The `LANJUT!!` submit handler must obtain `getUnlockAudioUrl()`, create `new Audio(url)`, set `audio.muted = true`, await `audio.play()`, then `audio.pause(); audio.currentTime = 0; audio.src = ""`; set `audioReady` true only after that succeeds. This exact gesture uses a real bundled catalog source, makes no audible sound, and does not fabricate readiness. If no catalog URL or `play()` fails, continue into the dashboard with `audioReady: false`, show `Aktifkan Suara`, and let its button repeat the same muted sequence in that button's click gesture. Register the normalized name after this gesture; Supabase failure must not block dashboard manual playback.

- [ ] **Step 5: Verify real UI behavior manually**

Run: `npx vitest run tests/audio-unlock.test.ts && npm run lint && npx tsc --noEmit && npm run build`

Expected: test PASS; all commands exit `0`. `npm run build` is the direct Vite build—there is no Blob upload prebuild, no `BLOB_READ_WRITE_TOKEN`, and no alternate build command.

- [ ] **Step 6: Commit**

```bash
git add src/lib/audio.ts src/components/CrewIdentityDialog.tsx src/routes/index.tsx tests/audio-unlock.test.ts
git commit -m "feat: unlock bundled audio for remote playback"
```

### Task 7: Build dedicated Super Admin route

**Files:**
- Create: `src/routes/super-admin.tsx`
- Modify: `src/components/AuthGate.tsx:3-85`
- [ ] **Step 1: Adapt AuthGate without introducing roles**

Add optional props `title`, `instruction`, `submitLabel`, and `loginAction`; defaults retain the current dashboard copy/action. `/super-admin` passes `Login Super Admin`, `Masukkan password khusus untuk remote audio.`, `Masuk`, and `loginSuperAdmin`. Do not add `AuthRole`, username input, `/manage`, or manage compatibility code: this repository has dashboard-only `AuthGate` baseline.

- [ ] **Step 2: Implement route**

Create a `/super-admin` file route whose loader calls `getAuthStatus`. If `auth.superAdmin` is false, render `AuthGate` with Task 7 props and invalidate router on success. Otherwise use TanStack Query to call `getRemoteAdminSnapshot` every 10 seconds and on focus. Render native selects for eligible sessions and metadata-only catalog IDs; disable `Play audio` unless snapshot is online, target/audio are selected, and mutation is idle. Call `sendRemoteCommand`, invalidate on success, and render seven-day audit status, actor, target, label, timestamps, and reason. A browser Realtime channel may invalidate the query for `crew_sessions` and `remote_commands`; when unavailable, polling remains. Offline state is exactly `Realtime offline`; Play stays disabled. Add no navigation link.

- [ ] **Step 3: Generate route and verify**

Run: `npm test && npm run lint && npx tsc --noEmit && npm run build`

Expected: all exit `0`; `src/routeTree.gen.ts` contains `/super-admin` generated by the build. Do not hand-edit it.

- [ ] **Step 4: Commit**

```bash
git add src/components/AuthGate.tsx src/routes/super-admin.tsx src/routeTree.gen.ts
git commit -m "feat: add Super Admin remote controls"
```

### Task 8: Document configuration and validate acceptance paths

**Files:**
- Modify: `.env.example:1-11`
- Modify: `README.md:3-88`

- [ ] **Step 1: Add only required variables**

Append to `.env.example`:

```dotenv
SUPER_ADMIN_PASSWORD=
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

State that audio remains bundled under `src/assets/audio/**`; never document Blob, Vercel Blob, storage tokens, `/manage`, or prebuild uploads.

- [ ] **Step 2: Update README**

Document `/super-admin`, the dedicated password, anonymous Supabase RLS, 10-second visible heartbeat, 30-second eligible window, 5-second TTL, no replay, seven-day audit, optional retention scheduling, and `LANJUT!!` muted real-source unlock. State `SUPABASE_SERVICE_ROLE_KEY` has no `VITE_` prefix and must not be committed. Keep existing bundled-audio deployment instructions.

- [ ] **Step 3: Run full verification**

Run: `npm test && npm run lint && npx tsc --noEmit && npm run build`

Expected: every command exits `0`.

Manual database/browser checks:

1. Two anonymous sessions claim `  RINA  ` and `rina` concurrently: exactly one succeeds. Make the winner hidden/disconnected, wait 31 seconds, then the other claim succeeds.
2. An anonymous client direct-inserts into `remote_commands`: RLS denies it. It cannot read another crew row/command. `ack_remote_command` rejects another target and expired command.
3. Visible audio-ready session heartbeats every 10 seconds; it becomes ineligible after 30 seconds without heartbeat.
4. Send command to visible crew: `sent` becomes `played`. Force playback rejection: `failed`, reason length <=160, `Aktifkan Suara`, no replay. Deliver duplicate, reconnect, then older/equal command: no additional playback. Newer command stops current playback.
5. Remove `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`: dashboard login/manual tables/manual six announcements still work; crew shows unavailable; `/super-admin` shows `Realtime offline`; no route errors.
6. Android Chrome and iOS Safari: press `LANJUT!!`, confirm muted real bundled source unlock; foreground command plays selected output. Hidden tab, screen lock, suspension, reconnect never promise/replay playback. Test autoplay failure shows recovery and `failed` acknowledgement.

- [ ] **Step 4: Commit documentation**

```bash
git add .env.example README.md
git commit -m "docs: configure Super Admin remote audio"
```

## Plan self-review

- [x] **Spec/repository coverage:** Corrects the stale Blob/manage assumptions: audio is Vite-bundled, six `AnnouncementId` values are enumerated, baseline auth is dashboard-only, and build is direct `npm run build`.
- [x] **Security/operations:** Server uses `*.server.ts` rather than forbidden `server-only`; service role stays server runtime; anonymous auth + RPC/RLS are deny-by-default; name claim is atomic; TTL is 5 seconds; heartbeat/online windows are 10/30 seconds; retention is 7 days with concrete optional pg_cron and Hobby-safe scheduled function.
- [x] **Behavior/tests:** Browser URL catalog is separate from server-safe metadata; local concurrent playback still rejects, valid newest remote playback stops previous, older/equal commands do not interrupt; every newly added test has a red run before implementation; no intentional-green test remains.
- [x] **Placeholders/types:** No TODO/TBD/similar references; `AudioId`, six announcement values, RPC names, command fields, and route generation instructions are consistent; tests are in `tsconfig.json`.
