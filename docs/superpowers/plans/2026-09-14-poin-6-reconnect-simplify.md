# Poin 6 — Reconnect Jujur, Rampingkan Fitur, Turun Transport: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hapus total fitur instruksi Manager→crew, buat status koneksi jujur + recovery online/backoff, dan pindahkan read-path snapshot (crew & manager) ke RPC browser langsung — target tagihan $25-45/bln, nol memoles sesi crew hidup.

**Architecture:** Spec `docs/superpowers/specs/2026-09-14-poin-6-reconnect-simplify-design.md` (disetujui pemilik 14 Sep). Frontend: hapus 5 modul instruksi + tab manager; `createTableOccupancyRealtimeController` mendapat `NetworkSource` (online/offline) + retry backoff 1→2→4…cap 60 dtk + dua periode polling (12 dtk hanya saat sakit, `IDLE_REFRESH_MS` 120 dtk saat sehat). Browser: `getSupabaseBrowserClient()` menyinkronkan token rotasi ke `realtime.setAuth`; queryFn snapshot memanggil `*Core` dengan `client.rpc` (JWT asli user — supabase-js otomatis mengirimnya; kedua RPC `grant execute to authenticated`). DB: satu migration tombstone drop 2 tabel + 6 fungsi + 2 trigger fn + cron `cleanup-expired-instructions-daily` + keanggotaan publication; file migration pembuat TIDAK disentuh.

**Tech Stack:** React 19, TanStack Query/Start (server fn), vitest 4 (node default; `// @vitest-environment jsdom` per file untuk DOM), embedded-postgres harness `tests/db/harness.ts`, Supabase JS 2.112, PostgreSQL + pg_cron.

**Koreksi fakta terhadap spec (jujur, dibaca sebelum mulai):**
1. Spec §3.1 menulis `crew/manager-instructions.server.ts` — file itu TIDAK ada. Yang nyata: `src/lib/crew-instructions.server.ts` + `src/lib/manager-instructions.server.ts` + `src/lib/instruction-domain.ts`.
2. Spec §3.3 menulis flush SS `report_crew_events` pindah ke browser — nama RPC itu tidak ada. Flush nyata = `ingestPlaybackEvents` server fn (`src/lib/playback-events.server.ts`) yang verifikasi tenant+crew session via service-role lalu upsert via PostgREST — BUKAN satu RPC, TIDAK bisa dipindah tanpa RPC baru di luar scope. SS flush TETAP server fn (residual biaya kecil, diterima).
3. RPC `get_manager_active_crew(text)` hidup hanya karena fitur instruksi (dibangkitkan ulang oleh migration instruksi; konsumen satu-satunya `getActiveCrewForMessagingCore`) → ikut di-drop. `get_manager_snapshot` dan `get_manager_crew_history` TETAP (dipakai dashboard/crew-stats).
4. `src/lib/manager-crew-groups.ts` JANGAN dihapus — dipakai tab crew/stats (`groupActiveCrewByStation` manager/index.tsx:538,:598,:654).

**Hard constraints (AGENTS.md):** TDD — test ditulis lebih dulu dan DILIHAT GAGAL sebelum implementasi. Jangan sentuh aset §2 spec. Jangan pernah print secret. Migration production hanya lewat prosedur Task 7 (leader). Setiap task: commit kecil, message imperatif bahasa Inggris.

**Perintah lokal (Windows, PowerShell 7):** prefix PATH node dulu di setiap shell baru:
`$env:Path = 'C:\Users\dirga\AppData\Local\Temp\opencode\node-v22.20.0-win-x64;' + $env:Path`
Test unit: `npx vitest run <file>`. Test DB (berat, ~2-4 menit): `npx vitest run tests/db/<file>`. Typecheck: `npm run typecheck`. Branch kerja: `poin-6-reconnect-simplify` (dari `main` @ `f4f3081`), satu PR ber-CI di akhir (Task 6). JANGAN push `main` langsung.

---

### Task 1: S1 — grep-lock test RED, lalu hapus fitur instruksi dari frontend

**Files:**
- Create: `tests/point-6-instruction-removal.test.ts`
- Delete: `src/hooks/use-pending-instructions.ts`, `src/components/InstructionBanner.tsx`, `src/lib/instruction-domain.ts`, `src/lib/crew-instructions.server.ts`, `src/lib/manager-instructions.server.ts`
- Delete: `tests/crew-instructions-server.test.ts`, `tests/instruction-domain.test.ts`, `tests/instruction-banner.test.ts`, `tests/instruction-migration.test.ts`, `tests/manager-messages-tab.test.ts`, `tests/manager-instructions-server.test.ts`, `tests/manager-instruction-realtime.test.ts`
- Modify: `src/routes/kasir/index.tsx`, `src/routes/satgas/index.tsx`, `src/routes/clear-up/index.tsx`, `src/routes/manager/index.tsx`, `src/components/ManagerLayout.tsx`, `src/lib/role-session.server.ts`, `tests/point-2-manager-dashboard-pending.test.tsx`, `tests/db/round6-manager-pending.test.ts`

- [ ] **Step 1: Tulis test grep-lock (RED)**

Create `tests/point-6-instruction-removal.test.ts`:

```ts
// Poin 6 S1 contract: the Manager->Crew instruction feature must be GONE from
// the browser bundle. Source-scan style (node env), like the client-asset guards
// in tests/restaurant-login-build.test.ts.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function listSources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? listSources(full) : /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

const FORBIDDEN = [
  "@/lib/crew-instructions.server",
  "@/lib/manager-instructions.server",
  "@/lib/instruction-domain",
  "@/hooks/use-pending-instructions",
  "@/components/InstructionBanner",
  "KIRIM INSTRUKSI",
  "mgr-instr",
  "instruction-thread",
  "manager-active-crew-msg",
];

describe("Poin 6 S1: instruction feature fully removed from src/", () => {
  it("no source file references any instruction module or marker", () => {
    const offenders: string[] = [];
    for (const file of listSources(join(process.cwd(), "src"))) {
      const source = readFileSync(file, "utf8");
      for (const needle of FORBIDDEN) {
        if (source.includes(needle)) offenders.push(`${file} :: ${needle}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 2: Jalankan, pastikan GAGAL**

Run: `npx vitest run tests/point-6-instruction-removal.test.ts`
Expected: FAIL — daftar offender berisi `src/routes/manager/index.tsx :: mgr-instr`, `src/components/ManagerLayout.tsx :: KIRIM INSTRUKSI`, dll. CATATAN: kalau langsung hijau, test salah — perbaiki sebelum lanjut.

- [ ] **Step 3: Hapus berkas fitur**

```powershell
Remove-Item src/hooks/use-pending-instructions.ts, src/components/InstructionBanner.tsx, src/lib/instruction-domain.ts, src/lib/crew-instructions.server.ts, src/lib/manager-instructions.server.ts, tests/crew-instructions-server.test.ts, tests/instruction-domain.test.ts, tests/instruction-banner.test.ts, tests/instruction-migration.test.ts, tests/manager-messages-tab.test.ts, tests/manager-instructions-server.test.ts, tests/manager-instruction-realtime.test.ts
```

- [ ] **Step 4: `src/routes/kasir/index.tsx`**

- Hapus import baris 38-39 (`usePendingInstructions`, `InstructionBanner`).
- Hapus blok hook baris 81-86 (`const { pending: pendingInstructions, dismiss: dismissInstruction } = usePendingInstructions(...)` seluruh destructuring + arg).
- Hapus blok JSX baris 183-188 (`<InstructionBanner ... />`). `<>...</>` wrapper boleh tetap (fragments tidak melanggar lint di sini).

- [ ] **Step 5: `src/routes/satgas/index.tsx`**

Sama persis pola kasir: hapus import :46-47, destructuring hook mulai :149 (6 baris, arg identik), mount `<InstructionBanner` mulai :331 (6 baris).

- [ ] **Step 6: `src/routes/clear-up/index.tsx`**

Sama: hapus import :45-46, hook :118 (6 baris), mount :183 (6 baris).

- [ ] **Step 7: `src/routes/manager/index.tsx`**

- Baris 4: `import { CalendarDays, Download, Loader2, Send, Check, X } from "lucide-react";` → `import { CalendarDays, Download } from "lucide-react";` (Loader2/Send/Check/X hanya dipakai tab messages — terverifikasi grep).
- Hapus import baris 35-41 (blok `manager-instructions.server` + dua baris `instruction-domain`).
- Hapus state baris 95-97 (`msgTarget`, `msgText`, `msgError`).
- Hapus query `threads` baris 181-192 dan `activeCrewForMsg` baris 194-204.
- Hapus mutation `sendInstruction` baris 206-242 (dan `useMutation` dari import react-query baris 2 → `import { keepPreviousData, useQuery, useQueryClient }`).
- Hapus effect ack channel baris 259-278 (blok `mgr-instr` penuh).
- Hapus blok JSX baris 860-973 (`{menu === "messages" && (<> ... </>)}`) — dari `{menu === "messages" && (` sampai `)}` tepat sebelum `</ManagerLayout>`.
- Baris 34: `import { getSupabaseBrowserClient, refreshCarrierToken } from "@/lib/browser-auth";` → `import { refreshCarrierToken } from "@/lib/browser-auth";` (satu-satunya pemakai `getSupabaseBrowserClient` di file ini adalah broadcast mutation + effect ack yang dihapus; Task 5 akan menambahnya kembali).

- [ ] **Step 8: `src/components/ManagerLayout.tsx`**

- Baris 2: hapus `MessageSquare` dari import lucide.
- Baris 6: `export type ManagerMenu = "tables" | "otp" | "crew" | "log" | "stats" | "messages";` → buang `| "messages"`.
- Baris 14: hapus entri `messages: MessageSquare,`.
- Baris 20: hapus entri `{ id: "messages", label: "KIRIM INSTRUKSI" },`.

- [ ] **Step 9: `src/lib/role-session.server.ts` — komentar basi**

- Baris 22: `... table-occupancy.server.ts, crew-instructions, the manager/AM dashboard reads, and manager-auth.` → `... table-occupancy.server.ts, the manager/AM dashboard reads, and manager-auth.`
- Baris 41: `(crew-auth.server.ts, crew-instructions, manager reads, table-occupancy)` → `(crew-auth.server.ts, manager reads, table-occupancy)`

- [ ] **Step 10: Test campuran — sunting, jangan hapus file**

`tests/point-2-manager-dashboard-pending.test.tsx`: hapus blok mock baris 60-64 penuh (`vi.mock("@/lib/manager-instructions.server", () => ({ ... }));`).
`tests/db/round6-manager-pending.test.ts`: hapus assertion instruksi baris 133-148 (`const thread = await rpc(c, "get_instruction_thread"...` s.d. `const crew = await rpcRows(c, "get_manager_active_crew"...` + `expect(crew.rows).toHaveLength(0);`) dan ganti judul test baris 120 menjadi `"pending token yields no dashboard snapshot, stats, crew history, realtime bind"`. Assertion snapshot/stats/history/bind tetap utuh.

- [ ] **Step 11: Jalankan sampai HIJAU**

Run: `npx vitest run tests/point-6-instruction-removal.test.ts tests/point-2-manager-dashboard-pending.test.tsx tests/manager-crew-groups.test.ts tests/manager-crew-history.test.ts tests/purge-removal-contract.test.ts tests/manager-dashboard-server.test.ts`
Expected: semua PASS.
Run: `npm run typecheck` → exit 0 (redaksi import tersisa = sinyal RED yang jujur).

- [ ] **Step 12: Commit**

```powershell
git add -A
git commit -m "feat(poin-6): remove manager-to-crew instruction feature from the app"
```

---

### Task 2: S1 — migration drop DB (test db RED dulu)

**Files:**
- Create: `tests/db/point-6-instruction-drop.test.ts`
- Create: `supabase/migrations/20260914140000_drop_manager_instructions.sql`

- [ ] **Step 1: Tulis test DB RED**

Create `tests/db/point-6-instruction-drop.test.ts` (pola harness sama dengan point-5: `createTestDb` replay SEMUA migration berurutan, nama db unik):

```ts
// Poin 6 S1 DB suite: the instruction-drop tombstone must remove every DB
// object the feature owned while replaying the full history, and must not
// touch any protected asset table.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { Client } from "pg";
import { createTestDb, stopAll, type TestDb } from "./harness";

let db: TestDb;
let c: Client;

beforeAll(async () => {
  db = await createTestDb("lime_p6_instruction_drop");
  c = await db.client();
}, 600_000);

afterAll(async () => {
  await db?.close();
  await stopAll();
});

const FEATURE_FUNCTIONS = [
  "send_manager_instruction",
  "get_pending_instructions",
  "ack_instruction",
  "get_instruction_thread",
  "cleanup_expired_instructions",
  "get_manager_active_crew",
  "broadcast_instruction_created",
  "broadcast_instruction_acked",
];

describe("instruction drop tombstone", () => {
  test("every instruction-feature function is gone after replay", async () => {
    const rows = await c.query(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = any($1::text[])`,
      [FEATURE_FUNCTIONS],
    );
    expect(rows.rows).toEqual([]);
  });

  test("instruction tables are gone", async () => {
    const rows = await c.query(
      `select table_name from information_schema.tables
        where table_schema = 'public'
          and table_name in ('manager_instructions', 'instruction_receipts')`,
    );
    expect(rows.rows).toEqual([]);
  });

  test("instruction_receipts no longer in the supabase_realtime publication (when pg_cron/publication exist)", async () => {
    const pub = await c.query(
      `select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'instruction_receipts'`,
    );
    expect(pub.rows).toEqual([]);
  });

  test("cron cleanup job not registered (skipped when pg_cron unavailable in embedded harness)", async () => {
    const ext = await c.query(`select 1 from pg_extension where extname = 'pg_cron'`);
    if (ext.rows.length === 0) return;
    const jobs = await c.query(
      `select jobname from cron.job where jobname = 'cleanup-expired-instructions-daily'`,
    );
    expect(jobs.rows).toEqual([]);
  });

  test("protected asset tables all survive the replay", async () => {
    const rows = await c.query(
      `select count(*)::int as n from information_schema.tables
        where table_schema = 'public' and table_name = any($1::text[])`,
      [
        [
          "restaurants",
          "crew_accounts",
          "crew_role_sessions",
          "role_session_tokens",
          "manager_accounts",
          "area_manager_accounts",
          "crew_pairing_requests",
          "admin_audit_log",
          "table_occupancy_state",
          "table_occupancy_revisions",
        ],
      ],
    );
    expect(rows.rows[0].n).toBe(10);
  });
});
```

- [ ] **Step 2: Jalankan, pastikan GAGAL**

Run: `npx vitest run tests/db/point-6-instruction-drop.test.ts`
Expected: test 1-4 FAIL (objek masih ada pasca-replay); test 5 PASS. Jika error koneksi/harness — baca `tests/db/harness.ts` dulu, jangan sulap testnya.

- [ ] **Step 3: Tulis migration**

Create `supabase/migrations/20260914140000_drop_manager_instructions.sql`:

```sql
-- Poin 6 S1 (owner decision 2026-09-14): the Manager->Crew instruction feature
-- is removed entirely -- the real-world instruction channel is each restaurant's
-- WhatsApp group (YAGNI; cost was not the driver). Tombstone pattern (Poin 1):
-- supabase/migrations/20260907150000_manager_instructions.sql stays on disk
-- untouched as history. This migration drops ONLY objects that file owned:
-- manager_instructions, instruction_receipts, their broadcast trigger fns,
-- send/ack/get/thread/cleanup RPCs, the get_manager_active_crew revival
-- (its sole consumer was getActiveCrewForMessaging), the daily cleanup cron,
-- and the realtime publication membership. Protected assets (restaurants,
-- crew/manager/area accounts, sessions/tokens, pairings, audit log, occupancy,
-- QR tokens, audio) are NOT touched.

do $$
begin
  create extension if not exists pg_cron;
  perform cron.unschedule('cleanup-expired-instructions-daily');
exception
  when insufficient_privilege or undefined_object or undefined_function
       or invalid_text_representation or feature_not_supported then null;
end;
$$;

drop trigger if exists instruction_receipts_broadcast_created
  on public.instruction_receipts;
drop trigger if exists instruction_receipts_broadcast_acked
  on public.instruction_receipts;

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure::text as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'broadcast_instruction_created',
        'broadcast_instruction_acked',
        'send_manager_instruction',
        'get_pending_instructions',
        'ack_instruction',
        'get_instruction_thread',
        'cleanup_expired_instructions',
        'get_manager_active_crew'
      )
  loop
    execute format('drop function %s', r.signature);
  end loop;
end;
$$;

do $$
begin
  alter publication supabase_realtime drop table public.instruction_receipts;
exception
  when undefined_object or undefined_table then null;
end;
$$;

drop table if exists public.instruction_receipts;
drop table if exists public.manager_instructions;
```

- [ ] **Step 4: Jalankan sampai HIJAU**

Run: `npx vitest run tests/db/point-6-instruction-drop.test.ts`
Expected: 5/5 PASS (replay penuh: drop-after-create bekerja; `manager_reads` v1 `get_manager_active_crew` sudah di-drop migration crew_history; v2 di-drop tombstone ini — test proname = any(...) menangkap keduanya).

- [ ] **Step 5: Commit**

```powershell
git add supabase/migrations/20260914140000_drop_manager_instructions.sql tests/db/point-6-instruction-drop.test.ts
git commit -m "feat(poin-6): drop instruction feature schema via tombstone migration"
```

---

### Task 3: S2 — status jujur + NetworkSource + retry backoff + dua periode polling

**Files:**
- Modify: `src/hooks/use-table-occupancy-realtime.ts`
- Modify: `tests/use-table-occupancy-realtime.test.ts`

Aturan perilaku final (kontrak):
- Status yang dilaporkan = status channel asli dari callback `.subscribe()`; TIDAK ADA timer yang pernah menyetel SUBSCRIBED sendiri.
- Periode polling: `SUBSCRIBED && online` → `IDLE_REFRESH_MS = 120_000`; selainnya → `POLL_FALLBACK_MS = 12_000` (saat hidden tetap tidak polling — kontrak lama). Ganti periode = restart interval (fase timer baru mulai dari ganti status).
- Retry resubscribe: setiap status error (`CHANNEL_ERROR`/`TIMED_OUT`/`CLOSED`) saat online → schedule ulang `startSession()` (bind RPC + join channel, buang channel lama) dengan delay `min(1000 * 2**attempt, 60_000)`; `attempt` naik tiap penjadwalan; SUBSCRIBED → `attempt = 0` + batalkan timer tertunda. Saat offline: tanpa timer retry.
- Transisi offline→online: batalkan timer retry, `attempt = 0`, langsung `startSession()`; TANPA refetch ekstra — data fresh terserap polling tick pertama (≤12 dtk, kontrak §3.3).
- Tanpa client / tanpa token: `handleStatus("CHANNEL_ERROR")` sekali (kontrak lama dipertahankan; retry tidak dijadwalkan karena `startSession` tetap butuh client).

- [ ] **Step 1: Tulis/ubah kontrak test (RED)**

Di `tests/use-table-occupancy-realtime.test.ts`:

(a) Tambah helper setelah `fakeVisibility`:

```ts
function fakeNet(initiallyOnline = true) {
  let online = initiallyOnline;
  let callback: (() => void) | null = null;
  const net = {
    isOnline: () => online,
    subscribe: vi.fn((next: () => void) => {
      callback = next;
      return () => {
        callback = null;
      };
    }),
  };
  return {
    net,
    setOnline(next: boolean) {
      online = next;
      callback?.();
    },
  };
}
```

(b) Ganti isi test `"keeps light safety polling active even while SUBSCRIBED"` (baris 199-218) menjadi:

```ts
it("polls at the 120-second idle cadence while healthy", () => {
  vi.useFakeTimers();
  try {
    const { client, channels } = fakeClient();
    const refetch = vi.fn();
    createTableOccupancyRealtimeController({
      client,
      restaurantId: RESTAURANT_ID,
      sessionToken: SESSION_TOKEN,
      refetch,
    });
    const entry = channels.get(`table-occupancy:${RESTAURANT_ID}`)!;

    entry.emitStatus("SUBSCRIBED");
    vi.advanceTimersByTime(60_000);
    expect(refetch).not.toHaveBeenCalled();

    vi.advanceTimersByTime(IDLE_REFRESH_MS - 60_000);
    expect(refetch).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});
```
(tambah `IDLE_REFRESH_MS` ke import dari modul di baris 3-8 file test.)

(c) Test invariant `"never calls any heartbeat..."` (baris 355-372): ubah `expect(refetch).toHaveBeenCalledTimes(5);` menjadi `expect(refetch).toHaveBeenCalledTimes(0);` dan `vi.advanceTimersByTime(60_000);` tetap (SUBSCRIBED + idle 120s = nol refetch dalam 60s; rpc bind tetap 1). Comment di atasnya: sesuaikan kata "light safety poll" → "idle safety poll".

(d) Tambah describe baru di akhir file:

```ts
describe("Poin 6 reconnect contract", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("never reports SUBSCRIBED without a real channel callback", () => {
    const { client } = fakeClient();
    const onStatusChange = vi.fn();
    createTableOccupancyRealtimeController({
      client,
      restaurantId: RESTAURANT_ID,
      sessionToken: SESSION_TOKEN,
      refetch: vi.fn(),
      onStatusChange,
    });
    vi.advanceTimersByTime(300_000);
    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it("resubscribes with exponential backoff after status errors, capped at 60s", () => {
    const { client, channels } = fakeClient();
    createTableOccupancyRealtimeController({
      client,
      restaurantId: RESTAURANT_ID,
      sessionToken: SESSION_TOKEN,
      refetch: vi.fn(),
    });
    expect(client.channel).toHaveBeenCalledTimes(1);

    channels.get(`table-occupancy:${RESTAURANT_ID}`)!.emitStatus("CHANNEL_ERROR");
    vi.advanceTimersByTime(999);
    expect(client.channel).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(client.channel).toHaveBeenCalledTimes(2);

    channels.get(`table-occupancy:${RESTAURANT_ID}`)!.emitStatus("TIMED_OUT");
    vi.advanceTimersByTime(1_999);
    expect(client.channel).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1);
    expect(client.channel).toHaveBeenCalledTimes(3);

    // The third ladder rung would be 4s. A SUBSCRIBED verdict resets it: after
    // error again the retry is due at +1s, not +4s.
    channels.get(`table-occupancy:${RESTAURANT_ID}`)!.emitStatus("SUBSCRIBED");
    channels.get(`table-occupancy:${RESTAURANT_ID}`)!.emitStatus("CHANNEL_ERROR");
    vi.advanceTimersByTime(3_999);
    expect(client.channel).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(1);
    expect(client.channel).toHaveBeenCalledTimes(4);
  });

  it("drops the previous channel before each retry resubscribe", () => {
    const { client, channels, removeChannel } = fakeClient();
    createTableOccupancyRealtimeController({
      client,
      restaurantId: RESTAURANT_ID,
      sessionToken: SESSION_TOKEN,
      refetch: vi.fn(),
    });
    const first = channels.get(`table-occupancy:${RESTAURANT_ID}`)!;
    first.emitStatus("CHANNEL_ERROR");
    vi.advanceTimersByTime(1_000);
    expect(removeChannel).toHaveBeenCalledWith(first.channel);
  });

  it("goes quiet while offline, then resubscribes immediately on the online transition", () => {
    const { client, channels } = fakeClient();
    const { net, setOnline } = fakeNet(true);
    createTableOccupancyRealtimeController({
      client,
      restaurantId: RESTAURANT_ID,
      sessionToken: SESSION_TOKEN,
      refetch: vi.fn(),
      net,
    });
    setOnline(false);
    channels.get(`table-occupancy:${RESTAURANT_ID}`)!.emitStatus("CLOSED");
    vi.advanceTimersByTime(300_000);
    expect(client.channel).toHaveBeenCalledTimes(1); // no retry ladder while offline

    setOnline(true);
    expect(client.channel).toHaveBeenCalledTimes(2); // immediate resubscribe, ladder reset
    // and the next error starts from 1s again:
    channels.get(`table-occupancy:${RESTAURANT_ID}`)!.emitStatus("CHANNEL_ERROR");
    vi.advanceTimersByTime(1_000);
    expect(client.channel).toHaveBeenCalledTimes(3);
  });

  it("uses the 12-second fallback cadence while unhealthy", () => {
    const { client, channels } = fakeClient();
    const refetch = vi.fn();
    createTableOccupancyRealtimeController({
      client,
      restaurantId: RESTAURANT_ID,
      sessionToken: SESSION_TOKEN,
      refetch,
    });
    channels.get(`table-occupancy:${RESTAURANT_ID}`)!.emitStatus("CHANNEL_ERROR");
    vi.advanceTimersByTime(POLL_FALLBACK_MS);
    expect(refetch).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(POLL_FALLBACK_MS);
    expect(refetch).toHaveBeenCalledTimes(2);
  });
});
```

(e) Sumber-scan invariant test (baris 379-388): TETAP (nama konstanta baru `IDLE_REFRESH_MS` tidak melanggar regex `/heartbeat/i` maupun `HEARTBEAT_MS`). Tambah satu assertion dalam test itu: `expect(hookSource).not.toMatch(/setStatus\("SUBSCRIBED"/);` dan dalam `useTableOccupancyRealtime hook source contract` tambah:

```ts
it("contains no fabricated SUBSCRIBED fallback timer", () => {
  const start = hookSource.indexOf("export function useTableOccupancyRealtime");
  const block = hookSource.slice(start);
  expect(block).not.toContain("setTimeout");
  expect(block).not.toContain("force SUBSCRIBED");
});
```

- [ ] **Step 2: Jalankan, pastikan gagal di tempat yang benar**

Run: `npx vitest run tests/use-table-occupancy-realtime.test.ts`
Expected: FAIL — (b) `IDLE_REFRESH_MS` belum diekspor (import error = RED yang sah), (d)/(e) kontraktum baru gagal, test (c) gagal karena hook saat ini memaksa SUBSCRIBED lewat setTimeout 5s di level hook? (c controller-level sudah benar gagal karena polling lama 12s → 5 refetch vs 0). Semua merah harus masuk akal; kalau ada yang hijau padahal harus merah (mis. tidak ada `net` option → TS error di test file, itu OK sebagai RED), lanjut.

- [ ] **Step 3: Implementasi controller (HIJAU)**

Di `src/hooks/use-table-occupancy-realtime.ts`:

(a) Setelah `POLL_FALLBACK_MS` (baris 16) tambah:

```ts
export const IDLE_REFRESH_MS = 120_000;
export const RETRY_BASE_MS = 1_000;
export const RETRY_CAP_MS = 60_000;
```

(b) Setelah `VisibilitySource`/browser source tambah:

```ts
export type NetworkSource = {
  isOnline: () => boolean;
  subscribe: (callback: () => void) => () => void;
};

const ALWAYS_ONLINE: NetworkSource = {
  isOnline: () => true,
  subscribe: () => () => undefined,
};

function browserNetworkSource(): NetworkSource {
  if (typeof window === "undefined") return ALWAYS_ONLINE;
  return {
    isOnline: () => window.navigator.onLine,
    subscribe: (callback) => {
      window.addEventListener("online", callback);
      window.addEventListener("offline", callback);
      return () => {
        window.removeEventListener("online", callback);
        window.removeEventListener("offline", callback);
      };
    },
  };
}

function backoffDelayMs(attempt: number): number {
  return Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_CAP_MS);
}
```

(c) Controller options: tambah `net = ALWAYS_ONLINE,` di destructure (setelah `visibility`) + tipe `net?: NetworkSource;`.

(d) Ganti isi badan controller (mulai `let lastRefetchAt` s.d. `return { dispose... }`) menjadi struktur berikut — `handleInvalidate`, `rateLimitedRefetch` semantics, revision-guard, dan self-notice-suppression TIDAK berubah, hanya wiring status/period/retry baru:

```ts
let lastRefetchAt = -Infinity;
let pollHandle: ReturnType<typeof setInterval> | null = null;
let pollPeriodMs: number | null = null;
let channel: BroadcastChannelLike | null = null;
let disposed = false;
let currentStatus: TableOccupancyRealtimeStatus | null = null;
let online = net.isOnline();
let retryAttempt = 0;
let retryHandle: ReturnType<typeof setTimeout> | null = null;
let startSession: () => void = () => undefined;

const rateLimitedRefetch = () => {
  if (disposed) return;
  const current = now();
  if (current - lastRefetchAt < REFETCH_RATE_LIMIT_MS) return;
  lastRefetchAt = current;
  refetch();
};

const clearRetryTimer = () => {
  if (retryHandle !== null) {
    clearTimeout(retryHandle);
    retryHandle = null;
  }
};

const scheduleRetry = () => {
  if (disposed || !online || retryHandle !== null) return;
  const delay = backoffDelayMs(retryAttempt);
  retryAttempt += 1;
  retryHandle = setTimeout(() => {
    retryHandle = null;
    if (disposed) return;
    startSession();
  }, delay);
};

const healthy = () => online && currentStatus === "SUBSCRIBED";

const startPolling = () => {
  if (pollHandle || disposed || !visibility.isVisible()) return;
  const period = healthy() ? IDLE_REFRESH_MS : POLL_FALLBACK_MS;
  pollPeriodMs = period;
  pollHandle = setIntervalFn(() => {
    if (!disposed && visibility.isVisible()) refetch();
  }, period);
};

const stopPolling = () => {
  if (!pollHandle) return;
  clearIntervalFn(pollHandle);
  pollHandle = null;
  pollPeriodMs = null;
};

const syncPolling = () => {
  if (pollHandle && pollPeriodMs !== (healthy() ? IDLE_REFRESH_MS : POLL_FALLBACK_MS)) {
    stopPolling();
  }
  if (!disposed && visibility.isVisible()) startPolling();
  else stopPolling();
};

const unsubscribeVisibility = visibility.subscribe(syncPolling);
const unsubscribeNet = net.subscribe(() => {
  const nextOnline = net.isOnline();
  if (nextOnline && !online) {
    retryAttempt = 0;
    clearRetryTimer();
    startSession();
  }
  online = nextOnline;
  if (!online) clearRetryTimer();
  syncPolling();
});

const handleStatus = (status: string) => {
  if (disposed) return;
  currentStatus = status as TableOccupancyRealtimeStatus;
  if (currentStatus === "SUBSCRIBED") {
    retryAttempt = 0;
    clearRetryTimer();
  } else if (currentStatus === "CHANNEL_ERROR" || currentStatus === "TIMED_OUT" || currentStatus === "CLOSED") {
    scheduleRetry();
  }
  onStatusChange?.(currentStatus);
  syncPolling();
};
```

`handleInvalidate` salin apa adanya (baris 135-157 lama). Lalu:

```ts
const subscribePrivate = () => {
  if (!client || disposed) return;
  if (channel) client.removeChannel(channel);
  channel = client
    .channel(tableOccupancyChannelName(restaurantId), { config: { private: true } })
    .on("broadcast", { event: "invalidate" }, handleInvalidate)
    .subscribe(handleStatus);
};

if (client && restaurantId && sessionToken) {
  const onRpcResult = ({ data, error }: { data?: unknown; error?: unknown }) => {
    if (disposed) return;
    if (error || data !== true) {
      handleStatus("CHANNEL_ERROR");
      return;
    }
    subscribePrivate();
  };
  const onRpcReject = () => {
    if (!disposed) handleStatus("CHANNEL_ERROR");
  };

  startSession = () => {
    const hasAuth =
      "auth" in client &&
      typeof (client as unknown as { auth?: { getSession?: () => Promise<unknown> } }).auth
        ?.getSession === "function";

    const bindAfterAuth = () =>
      client
        .rpc(bindRpc, {
          p_restaurant_id: restaurantId,
          p_session_token: sessionToken,
        })
        .then(onRpcResult, onRpcReject);

    if (hasAuth) {
      void (client as unknown as { auth: { getSession: () => Promise<unknown> } }).auth
        .getSession()
        .then(
          () => {
            const rt = (client as unknown as { realtime?: { setAuth?: () => Promise<void> } })
              .realtime;
            if (rt?.setAuth) {
              return rt.setAuth().then(bindAfterAuth, bindAfterAuth);
            }
            return bindAfterAuth();
          },
          () => bindAfterAuth(),
        );
    } else {
      void bindAfterAuth();
    }
  };
  startSession();
} else {
  handleStatus("CHANNEL_ERROR");
}
syncPolling();

return {
  dispose() {
    if (disposed) return;
    disposed = true;
    clearRetryTimer();
    unsubscribeNet();
    unsubscribeVisibility();
    stopPolling();
    if (channel && client) client.removeChannel(channel);
  },
};
```

Pergeseran-perilaku yang disengaja vs lama: (i) `subscribePrivate` kini selalu `removeChannel` channel lama → test lama "removes the channel ... on dispose" tetap lolos (dispose memanggil removeChannel kedua kali atas channel yang sama — `removeChannel` mock tak keberatan; kalau assertion `toHaveBeenCalledTimes(1)` pecah di test dispose: ubah expectation menjadi `expect(removeChannel).toHaveBeenCalledWith(entry.channel)` TANPA hitung — assertion yang ada memang `toHaveBeenCalledWith`, aman). (ii) `else handleStatus("CHANNEL_ERROR")` tanpa client: `scheduleRetry` no-op karena `startSession` tak pernah butuh client? TIDAK — retry akan memanggil startSession() = closure yang tetap menyimpan `client` argumen; saat client null subscribePrivate guard keluar sendiri; tapi `handleStatus` schedules retry → loop channel? Saat client null tidak ada `client.channel` untuk dipanggil (subscribePrivate guard `if (!client...) return;`) → retry timer fire, nothing happens, TIDAK ada error baru ter-schedule → ladder berhenti diam setelah 1 retry tak terlihat. Test "falls back to polling immediately when no Supabase client" assert `onStatusChange CHANNEL_ERROR` + poll — retry tak terlihat; lolos.

(e) Level hook: hapus blok fallback force-SUBSCRIBED (baris 268-273 + `clearTimeout(fallback)` cleanup menjadi hanya `controller.dispose()`), dan ganti mount controller dengan passing net: `net: browserNetworkSource(),` di samping `visibility: browserVisibilitySource(),` (baris 262). Hapus `setStatus("SUBSCRIBING")` awal? TETAP (inisial UI, jujur: belum ada verdict).

- [ ] **Step 4: Jalankan sampai HIJAU**

Run: `npx vitest run tests/use-table-occupancy-realtime.test.ts`
Expected: semua PASS termasuk kontrak lama yang tidak diubah. Kalau test lama `subscribes to the per-restaurant broadcast channel...` gagal karena channel kedua tercipta saat retry (tidak terjadi — tanpa emit error tak ada retry) — laporkan kalau merah tak masuk akal, JANGAN sulam assertion.

- [ ] **Step 5: Commit**

```powershell
git add src/hooks/use-table-occupancy-realtime.ts tests/use-table-occupancy-realtime.test.ts
git commit -m "feat(poin-6): honest realtime status with online recovery and backoff"
```

---

### Task 4: S2 — sinkron auth→realtime di browser client (L5)

**Files:**
- Modify: `src/lib/browser-auth.ts:12-18`
- Modify: `tests/point-3-browser-auth.test.ts`

- [ ] **Step 1: Tulis test RED**

Di `tests/point-3-browser-auth.test.ts`: ganti `const auth = {...}` (baris 8-15) + `const fakeClient = { auth };` (baris 16) menjadi:

```ts
let authStateCallback:
  | ((event: string, session: { access_token?: string } | null) => void)
  | null = null;
const setAuth = vi.fn();
const auth = {
  getSession: vi.fn(),
  signInWithOtp: vi.fn(),
  verifyOtp: vi.fn(),
  signOut: vi.fn(),
  signInWithPassword: vi.fn(),
  signInAnonymously: vi.fn(),
  onAuthStateChange: vi.fn(
    (
      callback: (event: string, session: { access_token?: string } | null) => void,
    ) => {
      authStateCallback = callback;
      return { data: { subscription: { unsubscribe: () => undefined } } };
    },
  ),
};
const fakeClient = { auth, realtime: { setAuth } };
```

Tambah dalam `beforeEach` (baris 38-48): `authStateCallback = null; vi.mocked(auth.onAuthStateChange).mockClear(); setAuth.mockReset();`
Tambah test baru di dalam `describe("getSupabaseBrowserClient")`:

```ts
it("hands every rotated session token to the singleton realtime connection", async () => {
  const client = getSupabaseBrowserClient();
  expect(client).toBeTruthy();
  expect(auth.onAuthStateChange).toHaveBeenCalledTimes(1);
  expect(authStateCallback).toBeTypeOf("function");
  authStateCallback!("TOKEN_REFRESHED", { access_token: "rotated-token" });
  await Promise.resolve();
  expect(setAuth).toHaveBeenCalledWith("rotated-token");
  authStateCallback!("SIGNED_OUT", null);
  await Promise.resolve();
  expect(setAuth).toHaveBeenCalledTimes(1); // sign-out must NOT clear/set anything
});
```

- [ ] **Step 2: Jalankan, pastikan GAGAL**

Run: `npx vitest run tests/point-3-browser-auth.test.ts`
Expected: FAIL `onAuthStateChange` count 0 vs 1 (dan callback null). Assertion `calls[0]` createClient masih PASS (2 arg tetap).

- [ ] **Step 3: Implementasi**

`src/lib/browser-auth.ts` baris 12-18 menjadi:

```ts
export function getSupabaseBrowserClient(): SupabaseClient | null {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  if (!client) {
    client = createClient(url, anonKey);
    // Poin 6 L5: whenever GoTrue rotates the session, hand the fresh JWT to the
    // singleton Realtime connection. Without this an open tab that survives a
    // refresh keeps a stale access_token inside the socket and every private
    // channel re-join afterwards binds against a dead token.
    // ponytail: the listener subscription is never released because this client
    // is a page-lifetime singleton; upgrade path = store subscription if the
    // singleton ever becomes disposable.
    client.auth.onAuthStateChange((_event, session) => {
      const accessToken = session?.access_token;
      if (accessToken) void client?.realtime.setAuth(accessToken);
    });
  }
  return client;
}
```

- [ ] **Step 4: HIJAU**

Run: `npx vitest run tests/point-3-browser-auth.test.ts` → PASS semua.

- [ ] **Step 5: Commit**

```powershell
git add src/lib/browser-auth.ts tests/point-3-browser-auth.test.ts
git commit -m "feat(poin-6): sync rotated auth tokens into the realtime socket"
```

---

### Task 5: S3 — read-path snapshot langsung dari browser (T1)

**Files:**
- Modify: `src/routes/kasir/index.tsx`, `src/routes/satgas/index.tsx`, `src/routes/clear-up/index.tsx`, `src/routes/manager/index.tsx`
- Modify: `src/lib/table-occupancy.server.ts` (hapus wrapper), `src/lib/manager-dashboard.server.ts` (hapus wrapper)
- Modify: `tests/point-6-instruction-removal.test.ts` (tambah grep-lock transport)

- [ ] **Step 1: Tambah grep-lock RED**

Tambah ke `tests/point-6-instruction-removal.test.ts` (atau file baru `tests/point-6-read-transport.test.ts` — pilih tambah file baru agar kontrak terpisah):

```ts
// Poin 6 S3 contract: occupancy/manager snapshot READ paths must not go through
// Vercel server functions any more — the browser calls the authenticated RPC.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const READERS = [
  "src/routes/kasir/index.tsx",
  "src/routes/satgas/index.tsx",
  "src/routes/clear-up/index.tsx",
  "src/routes/manager/index.tsx",
];

describe("Poin 6 S3: snapshot reads are browser-direct", () => {
  it.each(READERS)("%s calls the snapshot core with a browser rpc, not the server fn", (file) => {
    const source = readFileSync(file, "utf8");
    expect(source).toContain("getSupabaseBrowserClient");
    expect(source).toMatch(/getTableOccupancySnapshotCore|getManagerSnapshotCore/);
    expect(source).not.toMatch(/\bgetTableOccupancySnapshot\(/);
    expect(source).not.toMatch(/\bgetManagerSnapshot\(/);
  });
});
```

Run: `npx vitest run tests/point-6-read-transport.test.ts` → FAIL (route masih pakai wrapper). RED dilihat.

- [ ] **Step 2: Route kasir — queryFn browser-direct**

`src/routes/kasir/index.tsx`:
- Import baris 42: `import { refreshCarrierToken } from "@/lib/browser-auth";` → `import { getSupabaseBrowserClient, refreshCarrierToken } from "@/lib/browser-auth";`
- Import baris 43-47: ganti `getTableOccupancySnapshot` → `getTableOccupancySnapshotCore` (nama lain blok tetap: `setTableOccupiedKasir`, `type TableOccupancyRow`).
- Ganti queryFn (baris 102-115) menjadi:

```ts
const snapshot = useQuery({
  queryKey: snapshotQueryKey(restaurantId),
  queryFn: async () => {
    const client = getSupabaseBrowserClient();
    if (!client) {
      return { ok: false as const, code: "UNAVAILABLE" as const, message: "Gagal memproses permintaan meja." };
    }
    return getTableOccupancySnapshotCore(
      { restaurantId, sessionToken: identity!.roleSessionToken },
      async (fn, params) => client.rpc(fn, params),
    );
  },
  enabled: Boolean(identity),
  // Realtime is primary; the hook owns the honest polling fallback.
  refetchOnWindowFocus: true,
});
```
(Mutasi `markOccupied` TIDAK berubah — stateful tetap lewat server fn.)

- [ ] **Step 3: Route satgas & clear-up — pola identik**

- `src/routes/satgas/index.tsx`: baris 50 `import { refreshCarrierToken } from "@/lib/browser-auth";` → `import { getSupabaseBrowserClient, refreshCarrierToken } from "@/lib/browser-auth";`; import blok `@/lib/table-occupancy.server` (baris 53-57): ganti `getTableOccupancySnapshot,` → `getTableOccupancySnapshotCore,`; ganti queryFn snapshot (mulai `getTableOccupancySnapshot({` di baris 137) persis pola Step 2.
- `src/routes/clear-up/index.tsx`: baris 49 sama pola browser-auth; baris 55 ganti nama simbol sama; queryFn mulai `getTableOccupancySnapshot({` di baris 106 → pola Step 2.
- Pesan error literal untuk cabang `!client` di KEDUA file role-route itu: `"Gagal memproses permintaan meja."` (sama seperti kasir).


- [ ] **Step 4: Route manager — queryFn browser-direct**

`src/routes/manager/index.tsx`:
- Import browser-auth: `import { refreshCarrierToken } from "@/lib/browser-auth";` → `import { getSupabaseBrowserClient, refreshCarrierToken } from "@/lib/browser-auth";`
- Import :19 `import { getManagerSnapshot, getManagerCrewHistory } from "@/lib/manager-dashboard.server";` → `import { getManagerSnapshotCore, getManagerCrewHistory } from "@/lib/manager-dashboard.server";`
- Ganti query snapshot (baris 127-138) menjadi:

```ts
const snapshot = useQuery({
  queryKey: snapshotKey(restaurantId),
  queryFn: async () => {
    const client = getSupabaseBrowserClient();
    if (!client) {
      return { ok: false as const, code: "UNAVAILABLE" as const, message: "Gagal memuat data manager." };
    }
    return getManagerSnapshotCore(
      { managerToken: identity!.managerToken },
      async (fn, params) => client.rpc(fn, params),
    );
  },
  enabled: Boolean(identity),
  refetchOnWindowFocus: true,
});
```
(`getManagerCrewHistory`, `getManagerDailyStats` — query on-demand, TETAP server fn. `refreshCarrierToken` import tetap dipakai snapshot? tidak lagi — tapi masih dipakai query crew/stats lain + mutation; JANGAN hapus.)

- [ ] **Step 5: Hapus wrapper server fn read**

`src/lib/table-occupancy.server.ts`: hapus blok `export const getTableOccupancySnapshot = createServerFn...` (baris 369-376). `tableOccupancySnapshotInputSchema` + `TableOccupancySnapshotRpcInput` TETAP (type input core mengacu padanya).
`src/lib/manager-dashboard.server.ts`: hapus `export const getManagerSnapshot = createServerFn...` (baris 58-66). `managerSnapshotInputSchema` TETAP kalau masih dirujuk (grep `managerSnapshotInputSchema` — kalau nol rujukan, hapus juga; laporkan apa adanya).
Grep kontrol: `rg -n "getTableOccupancySnapshot\b|getManagerSnapshot\b" src tests` → hanya boleh sisa nama `Core`/schema; tidak ada call-site wrapper.

- [ ] **Step 6: Update mock test mount**

`tests/point-2-manager-dashboard-pending.test.tsx` mock `@/lib/manager-dashboard.server` (baris 53-56) tambah `getManagerSnapshotCore: async () => ({ ok: false }),` (route kini memanggil Core). Cek `rg -n "manager-dashboard.server" tests -l` dan `rg -n "table-occupancy.server" tests -l`: mock yang menyediakan simbol wrapper untuk mount test harus ikut nama Core (contoh: test mount kasir/satgas/clear-up kalau ada). Jalankan grep, sunting mock secukupnya — laporan setiap suntingan.

- [ ] **Step 7: HIJAU**

Run: `npx vitest run tests/point-6-read-transport.test.ts tests/point-6-instruction-removal.test.ts tests/point-2-manager-dashboard-pending.test.tsx tests/table-occupancy-server.test.ts tests/manager-dashboard-server.test.ts`
(nama test server-file cek `ls tests` — jalankan semua yang cocok `table-occupancy`/`manager-dashboard` via `npx vitest run tests/<actual-file>`.)
Expected: PASS. Run: `npm run typecheck` → 0.

- [ ] **Step 8: Commit**

```powershell
git add -A
git commit -m "perf(poin-6): read occupancy snapshots directly from the browser as the user JWT"
```

---

### Task 6: Quality gate penuh + PR + CI (leader)

- [ ] `npm run verify` lokal (lint full bisa >7 menit — biarkan jalan; semua test harus hijau termasuk db replay)
- [ ] `git push -u origin poin-6-reconnect-simplify`
- [ ] PR → `main`, judul "Poin 6: honest reconnect, instruction removal, browser-direct reads", body ringkas: scope S1-S3 + koreksi fakta vs spec (4 butir di header plan) + bukti: nama test baru, hasil verify, angka aset belum (produksi = Task 7).
- [ ] Tunggu CI `verify` HIJAU (GitHub MCP `get_check_runs`). FAIL → perbaiki commit tambahan, jangan bypass.
- [ ] JANGAN merge dulu — merge = deploy app, harus SETELAH migration produksi (Task 7 urutkan).

### Task 7: Rollout production (leader, urutan mutlak, malam/jendela sepi)

- [ ] 7a. PRE-COUNT aset via supabase MCP `execute_sql` (simpan output di evidence): `select relname, n_live_tup from pg_stat_user_tables where relname in ('restaurants','crew_accounts','crew_role_sessions','role_session_tokens','manager_accounts','area_manager_accounts','crew_pairing_requests','admin_audit_log','table_occupancy_state','table_occupancy_revisions') order by relname;` + hitungan `manager_instructions` & `instruction_receipts` (jumlah baris yang akan hilang) + `select count(*) from role_session_tokens where expires_at > now();` (sesi crew HIDUP — angka ini harus SAMA setelah deploy).
- [ ] 7b. Backup DB terenkripsi pola Poin 3 → `LIME\backup\point6-pre-drop-<ts>.dump.enc` (jangan hapus backup lama).
- [ ] 7c. `apply_migration` MCP dengan ISI PERSIS `20260914140000_drop_manager_instructions.sql`. Post-check: `select proname ... where proname = any(...) → []`, `information_schema.tables` → [], `select exists(select 1 from cron.job where jobname='cleanup-expired-instructions-daily');` kalau masih true: `select cron.unschedule('cleanup-expired-instructions-daily');` lalu verify false.
- [ ] 7d. POST-COUNT 7a lagi → aset identik; sesi crew hidup identik.
- [ ] 7e. Merge PR (squash) → Vercel production deploy otomatis → tunggu Ready → cek `https://lihatmeja.com` 200. Tab lama di jendela 7c→7e: banner fetch gagal silent (try/catch), tab manager messages error — durasi menit, diterima.
- [ ] 7f. Cek PostgREST/edge logs 24 jam sebelumnya untuk panggilan `send_manager_instruction`/`get_pending_instructions` dari perangkat tua: `supabase_query_logs` window 24 jam terakhir sebelum 7c, filter path rpc — sertakan di evidence (bukti tak ada trafik tersisa = keputusan aman).

### Task 8: T3 runbook GoTrue + field test + evidence + docs (leader + pemilik)

- [ ] 8a. T3 (leader, prosedur runbook Poin 3 — token TIDAK PERNAH dicetak): GET `https://api.supabase.com/v1/projects/kjzxtmxdbcanvkgqqdow/config/auth` → catat field umur access token saat ini → PATCH flat perpanjangan (satu-satunya field umur token; JANGAN sentuh `disable_signup=false`, `rate_limit_email_sent=30`, verify/otp) → GET balik → tempel diff dua nilai di evidence. Hanya token BARU terpengaruh; sesi hidup utuh (verifikasi ulang angka 7a).
- [ ] 8b. Field test manual PEMILIK (penutup DONE): tab SS/kasir terbuka → cabut router resto ±2 menit → banner koneksi MERAH jujur (bukan "tersambung" palsu) → colok lagi → TANPA menyentuh tab: data fresh ≤12 dtk (max) dan bell hidup lagi; tab standby semalaman besoknya masih real-time ≤120 dtk.
- [ ] 8c. Evidence doc `docs/operations/evidence/production-point-6-<tanggal>.md`: SHA commit, ID run CI, URL deploy, pre/post-count, diff config, hasil 7f, catatan field test pemilik.
- [ ] 8d. `MASTER-ROADMAP.md`: Poin 6 DONE + tanggal; skor baris 6 "DONE (owner field-test <tgl>)".

---

## Self-review coverage spec (sudah dijalankan saat plan ditulis)

- §3.1 → Task 1+2 (+koreksi fakta 1-3). §3.2 → Task 3 (L1,L2,L3-in-memory-boleh,L4 via status asli di subscribe manager? channel ack `mgr-instr` DIHAPUS bersama fitur — L4 manager beres; subscribe buta `use-pending-instructions` ikut terhapus) + Task 4 (L5). §3.3 T1 → Task 5; T2 → Task 3; T3 → Task 8a; residual realtime dicatat di spec §3.3. §3.4.1 → seluruh task TDD; §3.4.2 kontrak wajib → Task 1 Step 1, Task 2 Step 1, Task 3 Step 1, Task 4 Step 1, Task 5 Step 1; §3.4.3 → Task 6 CI; §3.4.4 → Task 7; §3.4.5 → Task 8b; §3.4.6 → Task 8c-d. L6 (nol test putus-nyambung) → Task 3 describe baru. Tidak ada requirement spec tanpa task; deviasi flush didokumentasikan di header plan (bukan diam-diam).
