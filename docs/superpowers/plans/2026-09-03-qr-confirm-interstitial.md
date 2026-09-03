# QR Confirmation Interstitial Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sisipkan halaman konfirmasi "MEJA {n}" antara scan QR dan halaman pesan ESB; tombol TIDAK mengosongkan meja dengan aturan ketat; tombol YA besar (usia rentan) dan navigasi langsung ke ESB tanpa hop server.

**Architecture:** Satu migrasi SQL (RPC `decline_qr_scan` service-role-only), `dynamic-qr.server.ts` ganti 302 → HTML interstitial (pola `invalidQrResponse`), route baru `src/routes/q/decline.ts` (POST scan_id → RPC → HTML). TDD: test kontrak MERAH → implementasi → HIJAU → verify → push → CI replay → apply migrasi → read-back → produksi.

**Tech Stack:** TanStack Start server routes, Supabase RPC (security definer), Vitest source-string tests, pg_cron (tidak disentuh).

**Spec:** `docs/superpowers/specs/2026-09-03-qr-confirm-interstitial-design.md`

---

### Task 1: Migrasi + test kontrak MERAH

**Files:**
- Create: `supabase/migrations/20260903013000_decline_qr_scan.sql`
- Create: `tests/qr-decline.test.ts`

- [ ] **Step 1: Tulis test kontrak migrasi + halaman (MERAH)**

```ts
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const migration = () =>
  readFileSync(
    new URL("../supabase/migrations/20260903013000_decline_qr_scan.sql", import.meta.url),
    "utf8",
  );
const server = () => readFileSync(new URL("../src/lib/dynamic-qr.server.ts", import.meta.url), "utf8");
const declineRoute = () => readFileSync(new URL("../src/routes/q/decline.ts", import.meta.url), "utf8");

it("ships decline_qr_scan RPC: security definer, service-role only", () => {
  const sql = migration();
  expect(sql).toMatch(/create or replace function public\.decline_qr_scan\(p_scan_id uuid\)/i);
  expect(sql).toMatch(/revoke all on function public\.decline_qr_scan\(uuid\) from public, anon, authenticated/i);
  expect(sql).toMatch(/grant execute on function public\.decline_qr_scan\(uuid\) to service_role/i);
  expect(sql).toMatch(/security definer/i);
});

it("decline guards: processed status, 10-minute window, latest scan, qr_scan source", () => {
  const sql = migration();
  expect(sql).toMatch(/status = 'processed'/i);
  expect(sql).toMatch(/created_at >= now\(\) - interval '10 minutes'/i);
  expect(sql).toMatch(/not exists \(\s*select 1 from public\.qr_scan_events[\s\S]*?scanned_at > v_scan\.processed_at/i);
  expect(sql).toMatch(/occupied_source = 'qr_scan'/i);
  expect(sql).toMatch(/status = 'terisi'/i);
  expect(sql).toMatch(/terminal_reason = 'CUSTOMER_DECLINED'/i);
  expect(sql).toMatch(/bump_table_occupancy_revision/i);
  expect(sql).toMatch(/realtime\.send/i);
});

it("confirmation interstitial: big YA anchor to ESB, TIDAK form to /q/decline", () => {
  const src = server();
  expect(src).toContain('status: 200');
  expect(src).toContain('YA, SAYA MAU PESAN');
  expect(src).toContain('min-h-20');
  expect(src).toContain('text-2xl');
  expect(src).toContain('Saya pindah meja');
  expect(src).toContain('action="/q/decline"');
  expect(src).toContain('name="scan_id"');
  expect(src).toContain("form-action 'self'");
  expect(src).not.toMatch(/status: 302,\s*\n\s*headers: \{ Location/);
});

it("decline page uses the approved copy exactly", () => {
  const src = server();
  expect(src).toContain("Meja dibatalkan. Silakan scan QR di meja baru ya, Kak.");
});

it("decline route validates scan_id and calls the RPC", () => {
  const route = declineRoute();
  expect(route).toContain('createFileRoute("/q/decline")');
  expect(route).toContain('method: "POST"');
  expect(route).toContain("decline_qr_scan");
  expect(route).toMatch(/scan_id/i);
});
```

- [ ] **Step 2: Jalankan, pastikan MERAH**

Run: `npm test -- tests/qr-decline.test.ts`
Expected: FAIL (migrasi/route/interstitial belum ada).

---

### Task 2: Migrasi `decline_qr_scan`

**Files:**
- Create: `supabase/migrations/20260903013000_decline_qr_scan.sql`

- [ ] **Step 1: Tulis migrasi**

```sql
-- Opsi D: pelanggan menekan "Saya pindah meja" pada halaman konfirmasi QR.
-- Mengosongkan meja yang baru ditandai scan-nya, dengan guard ketat:
-- hanya scan 'processed' dalam 10 menit, masih scan terbaru di meja itu,
-- dan occupancy-nya bersumber 'qr_scan' (bukan kasir manual).

create or replace function public.decline_qr_scan(p_scan_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_scan public.pending_qr_scans%rowtype;
  v_revision bigint;
begin
  if p_scan_id is null then return false; end if;

  select * into v_scan
  from public.pending_qr_scans
  where scan_id = p_scan_id
    and status = 'processed'
    and created_at >= now() - interval '10 minutes'
  for update;
  if not found then return false; end if;

  if exists (
    select 1 from public.qr_scan_events
    where restaurant_id = v_scan.restaurant_id
      and table_number = v_scan.table_number
      and scanned_at > v_scan.processed_at
  ) then
    return false;
  end if;

  update public.table_occupancy_state
  set status = 'kosong',
      occupied_at = null,
      occupied_source = null,
      updated_at = now()
  where restaurant_id = v_scan.restaurant_id
    and table_number = v_scan.table_number
    and status = 'terisi'
    and occupied_source = 'qr_scan';
  if not found then return false; end if;

  update public.table_escort_intents
  set resolved = true
  where restaurant_id = v_scan.restaurant_id
    and table_number = v_scan.table_number
    and resolved = false;

  v_revision := public.bump_table_occupancy_revision(v_scan.restaurant_id);
  perform realtime.send(
    jsonb_build_object('table_number', v_scan.table_number, 'revision', v_revision),
    'invalidate',
    'table-occupancy:' || v_scan.restaurant_id::text,
    true
  );

  update public.pending_qr_scans
  set status = 'terminal',
      terminal_at = now(),
      terminal_reason = 'CUSTOMER_DECLINED'
  where scan_id = p_scan_id;

  return true;
end;
$$;
revoke all on function public.decline_qr_scan(uuid) from public, anon, authenticated;
grant execute on function public.decline_qr_scan(uuid) to service_role;
```

Catatan: `update ... if not found then return false` setelah occupancy update
adalah guard terakhir (occupied_source='qr_scan' sudah di WHERE, `found`
mencegah double-decline karena status berubah ke 'kosong' pada percobaan kedua).

---

### Task 3: Interstitial + halaman TIDAK di `dynamic-qr.server.ts`

**Files:**
- Modify: `src/lib/dynamic-qr.server.ts`

- [ ] **Step 1: Ganti path sukses 302 → halaman konfirmasi**

Ubah `handleOpaqueQrRequest` (setelah `processDurableScanBestEffort`):

```ts
  const esbUrl = `${ESB_BASE_URL}/APP/${encodeURIComponent(resolved.esbAppId)}/order?mode=dinein&tableNumber=${resolved.tableNumber}`;
  return confirmationPageResponse(resolved.tableNumber, scanId, esbUrl);
```

Hapus `return new Response(null, { status: 302, ... })` yang lama.

- [ ] **Step 2: Tambah helper halaman (pola invalidQrResponse)**

```ts
function pageResponse(html: string): Response {
  return new Response(html, {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function confirmationPageResponse(tableNumber: number, scanId: string, esbUrl: string): Response {
  const html = `<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Konfirmasi Meja ${tableNumber}</title>
  <style>
    :root{font-family:system-ui,sans-serif;color:#0f172a;background:#f8fafc}
    body{min-height:100vh;margin:0;display:grid;place-items:center;padding:24px;box-sizing:border-box}
    .card{max-width:460px;width:100%;border:0;border-radius:24px;background:white;padding:32px;box-shadow:0 20px 60px #0f172a22;text-align:center;box-sizing:border-box}
    .meja{font-size:15px;font-weight:800;letter-spacing:.12em;color:#b45309;margin:0}
    .nomor{font-size:64px;font-weight:900;line-height:1.1;margin:4px 0 18px}
    .pesan{font-size:19px;font-weight:700;line-height:1.55;margin:0 0 26px}
    .ya{display:flex;min-height:80px;align-items:center;justify-content:center;width:100%;box-sizing:border-box;border:0;border-radius:18px;background:#f59e0b;color:#0f172a;font-size:26px;font-weight:900;text-decoration:none;cursor:pointer}
    .ya:active{transform:scale(.98)}
    .tidak{margin-top:18px}
    .tidak button{min-height:48px;width:100%;box-sizing:border-box;border:2px solid #e2e8f0;border-radius:14px;background:white;color:#475569;font-size:16px;font-weight:700;cursor:pointer}
    .hint{margin-top:20px;font-size:13px;font-weight:600;color:#94a3b8;line-height:1.5}
  </style>
</head>
<body>
  <div class="card">
    <p class="meja">MEJA</p>
    <p class="nomor">${tableNumber}</p>
    <p class="pesan">Anda akan memesan di Meja Nomor ${tableNumber}. Mohon untuk tidak berpindah Meja agar makanan tidak tertukar dengan pesanan lainnya.</p>
    <a class="ya" href="${esbUrl}">YA, SAYA MAU PESAN</a>
    <form class="tidak" method="post" action="/q/decline">
      <input type="hidden" name="scan_id" value="${scanId}">
      <button type="submit">Saya pindah meja</button>
    </form>
    <p class="hint">Salah tekan atau pindah meja? Scan ulang QR di meja kamu.</p>
  </div>
</body>
</html>`;
  return pageResponse(html);
}

function declinedPageResponse(): Response {
  const html = `<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Meja dibatalkan</title>
  <style>
    :root{font-family:system-ui,sans-serif;color:#0f172a;background:#f8fafc}
    body{min-height:100vh;margin:0;display:grid;place-items:center;padding:24px;box-sizing:border-box}
    .card{max-width:460px;width:100%;border:0;border-radius:24px;background:white;padding:32px;box-shadow:0 20px 60px #0f172a22;text-align:center;box-sizing:border-box}
    .pesan{font-size:22px;font-weight:800;line-height:1.5;margin:0 0 14px}
    .sub{font-size:15px;font-weight:600;color:#64748b;line-height:1.6;margin:0}
  </style>
</head>
<body>
  <div class="card">
    <p class="pesan">Meja dibatalkan. Silakan scan QR di meja baru ya, Kak.</p>
    <p class="sub">Meja sebelumnya sudah kami bebaskan secara otomatis.</p>
  </div>
</body>
</html>`;
  return pageResponse(html);
}

export { declinedPageResponse };
```

---

### Task 4: Route `/q/decline`

**Files:**
- Create: `src/routes/q/decline.ts`

- [ ] **Step 1: Tulis route**

```ts
import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { declinedPageResponse, defaultDeclineQrScan } from "@/lib/dynamic-qr.server";

export const Route = createFileRoute("/q/decline")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const contentType = request.headers.get("content-type") ?? "";
        if (!contentType.includes("application/x-www-form-urlencoded")) {
          return declinedPageResponse();
        }
        let scanId = "";
        try {
          const form = await request.formData();
          scanId = String(form.get("scan_id") ?? "");
        } catch {
          return declinedPageResponse();
        }
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(scanId)) {
          return declinedPageResponse();
        }
        try {
          await defaultDeclineQrScan(scanId);
        } catch {
          // Idempoten: kegagalan DB tetap menayangkan halaman konfirmasi;
          // crew tetap backstop. Tidak ada informasi bocor ke pelanggan.
        }
        return declinedPageResponse();
      },
    },
  },
});
```

- [ ] **Step 2: Tambah `defaultDeclineQrScan` di dynamic-qr.server.ts**

```ts
export const defaultDeclineQrScan = async (scanId: string): Promise<void> => {
  const client = getServiceClient();
  if (!client) throw new Error("QR_DATABASE_UNAVAILABLE");
  const { error } = await client.rpc("decline_qr_scan", { p_scan_id: scanId });
  if (error) throw error;
};
```

---

### Task 5: Update test 302 → interstitial

**Files:**
- Modify: `tests/dynamic-qr-interceptor.test.ts` (2 asersi)
- Modify: `tests/qr-interceptor-durable-outbox.test.ts` (1 asersi)

- [ ] **Step 1: Ganti asersi**

Setiap `expect(response.status).toBe(302);` pada alur `/q/{token}` yang sukses
menjadi:

```ts
expect(response.status).toBe(200);
const html = await response.text();
expect(html).toContain("MEJA");
expect(html).toContain("YA, SAYA MAU PESAN");
```

Asersi `location` header 302 (bila ada) diganti asersi `href` ESB URL di HTML.
Test lain dalam file (invalid token 404, dsb.) tidak disentuh.
Legacy wrapper (`qr-interceptor.test.ts`) tetap 302 — tidak disentuh.

---

### Task 6: HIJAU + verify

- [ ] **Step 1: Focused**

Run: `npm test -- tests/qr-decline.test.ts tests/dynamic-qr-interceptor.test.ts tests/qr-interceptor-durable-outbox.test.ts tests/qr-interceptor.test.ts`
Expected: PASS semua.

- [ ] **Step 2: Gate penuh**

Run: `npm run verify` — Expected: exit 0.

- [ ] **Step 3: Review diff → commit → push**

```bash
git add -A
git commit -m "feat: QR scan confirmation interstitial with self-service table release"
git push origin main
```

- [ ] **Step 4: CI + migrasi + produksi**

- CI Database migrations replay sukses untuk SHA baru.
- Apply migrasi `20260903013000_decline_qr_scan` ke target Supabase
  (hanya migrasi baru; cek ledger dulu) → read-back grants + fungsi.
- Vercel READY + alias domain; probe live: `curl -I https://lihatmeja.com/q/{token-uji?}`
  tidak memungkinkan tanpa token valid — gunakan verifikasi Vercel READY +
  HTTP 200 halaman /super-admin sebagai bukti deploy, plus read-back DB
  sebagai bukti fungsional backend.

---

## Self-review

1. Spec coverage: interstitial (Task 3), YA besar (Task 3 CSS), TIDAK redaksi eksak (Task 3 + test), aturan guard (Task 2 + test), route decline (Task 4), kontrak 302 → 200 (Task 5), migrasi + CI + apply + read-back (Task 6). ✓
2. Placeholder scan: tidak ada TBD; semua kode/SQL lengkap. ✓
3. Konsistensi: nama `decline_qr_scan`, `defaultDeclineQrScan`, `declinedPageResponse`, `confirmationPageResponse` konsisten lintas task. ✓
