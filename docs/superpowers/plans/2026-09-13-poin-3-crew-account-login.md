# Poin 3 — Crew Email-Account Login + Manager-OTP Pairing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ganti jalur login crew dari "anonymous JWT + nama + PIN" menjadi akun email OTP dengan pairing email↔resto (approve Manager via OTP 6 digit), hard cutover, provider Anonymous tetap OFF selamanya.

**Architecture:** Crew = user Supabase asli (Email provider, OTP flow). Otoritas kerja tetap `role_session_tokens` (pola lama). Pairing & device-pin di dua tabel baru (`crew_accounts`, `crew_pairing_requests`); `restaurant_id` klaim SELALU server-derived dari pairing. Manager/AM dapat JWT carrier dari akun bayangan (admin createUser + rotate password + signInWithPassword), kredensial mereka tetap diverifikasi sistem sendiri.

**Tech Stack:** TanStack Start server fns (zod validator), Supabase Postgres (security-definer RPC, grant `authenticated`), supabase-js ^2.112.3, vitest (jsdom + node) + harness DB PG lokal `tests/db/harness.ts`.

**Spec:** `docs/superpowers/specs/2026-09-13-poin-3-crew-account-login-design.md`
**Kerja di worktree:** `.worktrees/feat-point-3-crew-login`, branch `feat/point-3-crew-account-login`.
**Konvensi test DB:** header setup + pola JWT lihat `tests/db/staff-access.integration.test.ts` dan `tests/db/round6-postgrest.test.ts`. Helper claims (bila belum ada): `await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role: 'authenticated' })])` — set per-tx (`is_local=true`).

---

## Phase A — Spike (risiko §12 spec)

### Task 1: Verifikasi GoTrue: OTP bikin user baru TANPA membuka jalur password-signup

**Files:**
- Modify: `docs/superpowers/specs/2026-09-13-poin-3-crew-account-login-design.md` (§12 #1, isi hasil)

- [ ] **Step 1: Baca dokumentasi GoTrue** — cek webfetch `https://supabase.com/docs/guides/auth/auth-email-passwordless` + `https://supabase.com/docs/guides/auth/edge/functions/trigger-events` + config `GOTRUE_DISABLE_SIGNUP`. Expected fact: toggle "Enable signups" Mematikan `/signup` (password) tetapi flow magic-link/OTP email MASIH bisa membuat user baru. Bila dokumen menyatakan lain → STOP, laporkan, revisi spec D1.
- [ ] **Step 2: Konfirmasi empiris non-destruktif ke production** (provider Email saat ini ON atau OFF tidak已知 — gunakan auth settings GET via dashboard user; jangan ubah apa pun). Catat hasil aktual provider: anonymous, email, phone.
- [ ] **Step 3: Tulis hasil ke §12 spec** (ganti teks risk #1 dengan "VERIFIED 2026-09-13: …").
- [ ] **Step 4: Commit** `git commit -am "docs(spec): record GoTrue OTP-vs-signup spike result"`

### Task 2: Verifikasi pola carrier staff = rotate-password + signInWithPassword

**Files:**
- Modify: spec §12 #2 (hasil)

- [ ] **Step 1:** Konfirmasi `supabase-js` 2.112 client-side `auth.signInWithPassword` dan admin API `updateUserById(id, { password })` tersedia (baca `node_modules/@supabase/supabase-js/README` / types). 
- [ ] **Step 2:** Catatan keputusan final carrier: create-on-first-login (`createUser({email, email_confirm:true, password: random32})`), setiap login: `updateUserById(id,{password: random32Baru})` → response `{carrierEmail, carrierPassword}` ke browser yang sama → `signInWithPassword` → simpan sesi di localStorage. Password random hidup < 1 respons, single-login-window, HTTPS-only. Alternatif magiclink token_hash TIDAK dipakai (perlu asumsi tambahan).
- [ ] **Step 3: Commit** `docs(spec): fix staff carrier mechanism = rotating shadow password`

---

## Phase B — Database (TDD)

### Task 3: Migration schema akun crew

**Files:**
- Create: `supabase/migrations/20260913100000_crew_account_schema.sql`
- Test: `tests/db/point-3-schema.test.ts`

- [ ] **Step 1: Tulis test gagal** — assert: tabel & kolom & grants.

```ts
import { describe, expect, it } from "vitest";
import { createTestDb } from "./harness";

describe("point-3 crew account schema", async () => {
  const db = await createTestDb();
  it("has crew_accounts, crew_pairing_requests, auth_uid + carrier columns", async () => {
    const c = await db.client();
    for (const q of [
      `select id, auth_uid, restaurant_id, email, full_name, status, active_device_hash, paired_by, paired_at
         from public.crew_accounts`,
      `select id, auth_uid, restaurant_id, email, full_name, otp_hash, attempts, status, expires_at, decided_by
         from public.crew_pairing_requests`,
      `select auth_uid from public.crew_role_sessions`,
      `select auth_user_id from public.manager_accounts`,
      `select auth_user_id from public.area_manager_accounts`,
    ]) {
      await c.query(q);
    }
    expect(
      await c.query(
        `select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
          where n.nspname='public' and p.proname in ('is_anonymous_signup_enabled','set_anonymous_signup_enabled')`,
      ),
    ).toMatchObject({ rowCount: 0 });
    await expect(c.query(`select 1 from public.system_config`)).rejects.toThrow();
  });

  it("public/anon/authenticated have no direct table access", async () => {
    const c = await db.client();
    const { rows } = await c.query(
      `select relname, relacl from pg_class where relname in ('crew_accounts','crew_pairing_requests')`,
    );
    for (const r of rows) {
      const acl: string[] = r.relacl ?? [];
      expect(acl.some((a) => /=(R|w|a|D|U|C|T)/.test(a) && /(=\w+.*anon|=authenticated)/.test(a))).toBe(false);
    }
  });

  it("pairing status values constrained; single pending per uid", async () => {
    const c = await db.client();
    const uid = await db.insertAuthUser("spike@example.com");
    await c.query(
      `insert into public.crew_pairing_requests (auth_uid, restaurant_id, email, full_name, otp_hash, status, expires_at)
       values ($1, (select id from public.restaurants limit 1), 'spike@example.com', 'Spike', 'x', 'pending', now() + interval '15 minutes')`,
      [uid],
    );
    await expect(
      c.query(
        `insert into public.crew_pairing_requests (auth_uid, restaurant_id, email, full_name, otp_hash, status, expires_at)
         values ($1, (select id from public.restaurants limit 1), 'spike@example.com', 'Spike 2', 'y', 'pending', now() + interval '15 minutes')`,
        [uid],
      ),
    ).rejects.toThrow();
  });
});
```

Sesuaikan nama helper setup dengan harness nyata (`db.client()`, seed resto via pola file `tests/db/*` yang sudah ada; bila tidak ada `insertAuthUser`, tambah helper kecil di test ini sendiri pakai `db.client()` insert ke `auth.users` — JANGAN ubah shim global tanpa perlu).

- [ ] **Step 2: Jalankan, pastikan FAIL** — `npx vitest run tests/db/point-3-schema.test.ts` (error tabel tidak ada).
- [ ] **Step 3: Tulis migration** `20260913100000_crew_account_schema.sql`:

```sql
-- Poin 3: crew identity = akun email (auth.users uid) + pairing email↔resto.
-- Spec: docs/superpowers/specs/2026-09-13-poin-3-crew-account-login-design.md

create table public.crew_accounts (
  auth_uid uuid primary key,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  email text not null unique check (position('@' in email) > 1),
  full_name text not null check (char_length(full_name) between 1 and 40),
  status text not null default 'aktif' check (status in ('aktif', 'nonaktif')),
  active_device_hash text check (active_device_hash ~ '^[a-f0-9]{64}$' or active_device_hash is null),
  paired_by uuid references public.manager_accounts (id),
  paired_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index crew_accounts_restaurant_idx on public.crew_accounts (restaurant_id)
  where status = 'aktif';
alter table public.crew_accounts enable row level security;
revoke all on public.crew_accounts from public, anon, authenticated;
-- no policies: all access via security-definer RPCs (service_role bypasses RLS)

create table public.crew_pairing_requests (
  id uuid primary key default gen_random_uuid(),
  auth_uid uuid not null,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  email text not null,
  full_name text not null check (char_length(full_name) between 1 and 40),
  otp_hash text not null check (otp_hash ~ '^[a-f0-9]{64}$'),
  attempts integer not null default 0 check (attempts between 0 and 5),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'expired')),
  expires_at timestamptz not null,
  decided_by uuid references public.manager_accounts (id),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index crew_pairing_requests_single_pending_idx
  on public.crew_pairing_requests (auth_uid) where status = 'pending';
create index crew_pairing_requests_restaurant_pending_idx
  on public.crew_pairing_requests (restaurant_id, created_at) where status = 'pending';
alter table public.crew_pairing_requests enable row level security;
revoke all on public.crew_pairing_requests from public, anon, authenticated;

-- carrier bayangan untuk Manager/AM (GoTrue uid; tanpa FK)
alter table public.manager_accounts add column auth_user_id uuid;
alter table public.area_manager_accounts add column auth_user_id uuid;

-- jejak identitas pada sesi kerja (row historis tetap null = alur lama)
alter table public.crew_role_sessions add column auth_uid uuid;

-- dead code dari 20260907210000: satu sumber kebenaran provider = config GoTrue
drop function if exists public.is_anonymous_signup_enabled();
drop function if exists public.set_anonymous_signup_enabled(boolean);
drop table if exists public.system_config;
```

- [ ] **Step 4: Jalankan test → PASS.**
- [ ] **Step 5: `npm run verify`** (chain lengkap db-reset harus tetap hijau; bila test lain menyentuh `system_config`, update call-site-nya — grep dulu: `rg -n system_config src tests`).
- [ ] **Step 6: Commit** `feat(db): crew account + pairing schema; drop dead anonymous flags`

### Task 4: Migration RPC pairing crew (validate code → request → confirm + manager list/reject)

**Files:**
- Create: `supabase/migrations/20260913110000_crew_pairing_rpcs.sql`
- Test: `tests/db/point-3-pairing.test.ts`

- [ ] **Step 1: Tulis test gagal** — lifecycle penuh (bantu dengan helper lokal `jwt(c, uid)`):

```ts
// Pseudocode test-watak (tulis lengkap):
// 1) crew_validate_code: JWT uid valid + kode resto benar → {restaurant_id, display_name};
//    kode salah → error 'INVALID_CODE'; tanpa JWT (claims anon) → 'UNAUTHORIZED'.
// 2) crew_request_pairing: sukses → baris pending + otp_hash 64-hex; uid sudah punya
//    crew_accounts aktif → 'ALREADY_PAIRED'; dua kali → 'PAIRING_PENDING'.
// 3) crew_confirm_pairing: otp benar → approved + baris crew_accounts (status aktif,
//    paired_by = manager yang OTP-nya dipakai? TIDAK — paired_by diisi dari request
//    yang di-claim manager? lihat Step 3 catatan) ; otp salah x5 → attempts=5 &
//    status 'expired' (burn) ; expiry 15 mnt → 'EXPIRED'; single-use → sukses 2x →
//    'ALREADY_PAIRED'.
// 4) manager list: get_crew_pairing_requests(p_manager_token) hanya resto manager itu,
//    menampilkan otp plaintext HANYA utk pending; token salah → 'INVALID_SESSION'.
// 5) manager reject: reject_crew_pairing_request → status rejected.
// 6) audit: tiap approve/reject → baris admin_audit_log action='crew.pairing'.
```

Test harus assert error-string persis (`raise exception 'INVALID_CODE'` pola file Poin 2).

- [ ] **Step 2: Jalankan → FAIL.**
- [ ] **Step 3: Tulis migration.** Fungsi & kunci keputusan:

```sql
-- =====================================================================
-- Poin 3: RPC pairing crew. Semua grant authenticated; uid dari auth.uid().
-- =====================================================================

-- kode resto => identitas (nama resto tampak HANYA setelah kode benar)
create or replace function public.crew_validate_code(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.restaurants%rowtype;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  select * into v from public.restaurants
   where code = trim(p_code) and is_active;
  if not found then raise exception 'INVALID_CODE'; end if;
  return jsonb_build_object('restaurant_id', v.id, 'display_name', v.display_name);
end $$;
revoke all on function public.crew_validate_code(text) from public, anon, authenticated, service_role;
grant execute on function public.crew_validate_code(text) to authenticated;

create or replace function public.crew_request_pairing(p_restaurant_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_otp text; v_email text; v_name text;
begin
  if v_uid is null then raise exception 'UNAUTHORIZED'; end if;
  if exists (select 1 from public.crew_accounts where auth_uid = v_uid and status = 'aktif')
  then raise exception 'ALREADY_PAIRED'; end if;
  if exists (select 1 from public.crew_pairing_requests
             where auth_uid = v_uid and status = 'pending' and expires_at > now())
  then raise exception 'PAIRING_PENDING'; end if;
  if not exists (select 1 from public.restaurants where id = p_restaurant_id and is_active)
  then raise exception 'INVALID_CODE'; end if;
  -- nama diambil dari metadata user yang dibuat saat OTP pertama (lihat server fn)
  select coalesce(u.raw_user_meta_data->>'full_name', ''), coalesce(u.email, '')
    into v_name, v_email from auth.users u where u.id = v_uid;
  if v_name = '' or v_email = '' then raise exception 'PROFILE_INCOMPLETE'; end if;
  -- expire pending lama
  update public.crew_pairing_requests set status = 'expired'
   where auth_uid = v_uid and status = 'pending';
  v_otp := lpad(to_hex((extensions.digest(gen_random_bytes(4),'sha256')::bytea)[0:1]::int & 999999)::text, 6, '0');
```

CATATAN implementasi OTP: `v_otp := lpad((floor(random()*1e6)::int)::text, 6, '0')` TIDAK boleh (random() bukan CSPRNG di session-level; GoTrue pakai `gen_random_bytes`). Pakai pola yang SUDAH dipakai di repo ini (lihat `claim_role_session`: `encode(extensions.gen_random_bytes(32),'hex')` lalu turunkan 6 digit angka: `substr(encode(extensions.gen_random_bytes(8),'hex'),1,6)` lalu `&` tidak valid utk hex string — cara final: 

```sql
v_otp := lpad(
  (('x' || substr(md5(encode(extensions.gen_random_bytes(16),'hex')),1,6))::bit(24)::bigint % 1000000)::int::text, 6, '0');
```

`md5()` tersedia (pgcrypto `extensions` tidak wajib). Ini CSPRNG-derived (input 128-bit random). Simpan `encode(extensions.digest(v_otp,'sha256'),'hex')`. RETURN `jsonb_build_object('ok',true,'request_id', v_req)` TANPA otp.

- `crew_confirm_pairing(p_request_id uuid, p_otp text)`: lock row `for update`; status pending & belum expired & uid cocok & attempts<5 else error (`NOT_FOUND|EXPIRED|TOO_MANY_ATTEMPTS|NOT_PENDING`); cocok hash → `approved`, upsert `crew_accounts` (insert…on conflict (auth_uid) do update set restaurant_id, full_name, email, status='aktif', paired_at, active_device_hash=null), `paired_by = NULL` dulu; audit `write_admin_audit('system', null, null, 'crew.pairing.approve', 'crew', v_uid, p_restaurant_id, 'ok', null, '{}')` — signature `write_admin_audit` sesuai `20260909020000` (cek parameter aktual saat implementasi, salin dari call-site `staff-access`). Return `{ok:true}`.
- Manager side (pola auth token = salin CTE validasi dari `get_manager_snapshot`, `20260904113000_manager_reads.sql:5-47`):
  - `get_crew_pairing_requests(p_manager_token text)` → jsonb array pending resto-scope: `id, email, full_name, otp (dari kolom terenkripsi plaintext? TIDAK)`. **Keputusan:** OTP harus bisa ditampilkan manager tapi disimpan hashed → tambah kolom `otp_plaintext text` TIDAK boleh (DB bocor = pairing bocor). Solusi: OTP di-*derive* bukan disimpan? Tidak mungkin utk ditampilkan. **Revisi desain (terima ke spec §4.2 nanti):** kolom `otp_encrypted text` di-encrypt dg pgp? Tanpa KMS tambahan: simpan `otp_hash` UTUK verifikasi; manager list butuh nilai OTP → simpan OTP terenkripsi dengan AES-GCM memakai key = kolom `qr_export` sudah pakai `QR_EXPORT_ENCRYPTION_KEY` — pola sudah ada! Lihat `src/lib/*qr*export* encryption` di server code; implementasi: RPC men-return `otp_encrypted` dan server fn Manager mendekripsi dengan env `QR_EXPORT_ENCRYPTION_KEY` (rename semantik: `APP_ENCRYPTION_KEY`? JANGAN rename env produksi — pakai key yang sama via server fn yang sama). DB tetap tanpa plaintext.
  - `reject_crew_pairing_request(p_manager_token text, p_request_id uuid)` → status rejected (hanya resto scope manager).
- Grant semua ke `authenticated`, revoke service_role utk yg harus begitu (manager reads pola lama: revoke public/anon/service_role).
- [ ] **Step 4: Update migration Task 3?** TIDAK — kolom otp_encrypted digabung di migration Task 4 sendiri (ALTER di atas CREATE? lebih bersih: pindahkan `otp_hash` → tetap + tambah `otp_encrypted text not null` di CREATE migration Task 3 SEBELUM merge — lakukan sekarang: edit file migration Task 3 karena belum pernah di-apply ke production (branch lokal). Tambah check `otp_encrypted ~ '^[a-f0-9]{64}$'` (ciphertext hex, format sama) + test kolom.
- [ ] **Step 5: Test PASS + verify + commit** `feat(db): crew pairing lifecycle RPCs`

### Task 5: Migration claim shift baru + revoke jalur lama (cutover RPC)

**Files:**
- Create: `supabase/migrations/20260913120000_crew_shift_claim.sql`
- Test: `tests/db/point-3-shift.test.ts`

- [ ] **Step 1: Test gagal** — matriks:
  - `crew_shift_claim(p_role, p_checked_in_at, p_device_token)` dg JWT uid:
    - pairing aktif → sesi terbit: `crew_role_sessions` row (auth_uid, display_name DARI pairing bukan argumen, restaurant_id DARI pairing), `role_session_tokens` valid (9h, code_version), return `{session, session_token}` bentuk sama dgn claim lama.
    - device BERBEDA → `active_device_hash` dirotasi; token role-session perangkat LAMA mati (select pakai token lama → `INVALID_SESSION` di RPC operasi lama `set_table_occupied_kasir` — tes end-to-end pakai helper sha256).
    - device SAMA (hash cocok) → tidak menendang diri sendiri; sesi baru tetap boleh (check-in kedua shift lain).
    - uid tanpa pairing → `NOT_PAIRED`; status nonaktif → `ACCOUNT_DISABLED`; role invalid → `INVALID_ROLE`; checked_in_at null → `INVALID_CHECKED_IN_AT`; device_token < 16 char → `INVALID_DEVICE`.
  - `get_crew_accounts(p_manager_token)` → daftar crew resto (email full-mask? tampilkan email penuh ke manager — keputusan pemilik? AMAN: manager udah lihat email saat request. → email penuh, status, paired_at, nama, active_device boolean).
  - `reset_crew_account(p_manager_token, p_auth_uid)` → status nonaktif + `active_device_hash=null` + hapus role_session_tokens milik uid tsb + revoke semua? (token = hapus baris; sesi = tidak perlu, token cukup) + audit `crew.account.reset`. Email bisa pairing ulang (test: request_pairing lg sukses setelah reset).
  - `end_active_crew_sessions(p_manager_token, p_auth_uid)` → hapus tokens uid (force logout tanpa reset) [untuk Poin 5, 8 baris doang, sekalian].
- [ ] **Step 2: FAIL.**
- [ ] **Step 3: Migration:**

```sql
create or replace function public.crew_shift_claim(
  p_role text, p_checked_in_at timestamptz, p_device_token text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_acc public.crew_accounts%rowtype;
  v_rest public.restaurants%rowtype;
  v_device_hash text := encode(extensions.digest(p_device_token, 'sha256'), 'hex');
  v_token text := encode(extensions.gen_random_bytes(32), 'hex');
  v_session public.crew_role_sessions;
begin
  if v_uid is null then raise exception 'UNAUTHORIZED'; end if;
  if p_device_token is null or char_length(p_device_token) < 16
  then raise exception 'INVALID_DEVICE'; end if;
  if p_role not in ('ss','kasir','satgas','clear_up') then raise exception 'INVALID_ROLE'; end if;
  if p_checked_in_at is null then raise exception 'INVALID_CHECKED_IN_AT'; end if;

  select * into v_acc from public.crew_accounts where auth_uid = v_uid
    for update;  -- serialisasi device rotation per akun
  if v_acc.auth_uid is null then raise exception 'NOT_PAIRED'; end if;
  if v_acc.status <> 'aktif' then raise exception 'ACCOUNT_DISABLED'; end if;
  select * into v_rest from public.restaurants where id = v_acc.restaurant_id and is_active;
  if not found then raise exception 'ACCOUNT_DISABLED'; end if;

  if v_acc.active_device_hash is not null and v_acc.active_device_hash <> v_device_hash then
    delete from public.role_session_tokens
     where restaurant_id = v_acc.restaurant_id
       and role_session_id in (select id from public.crew_role_sessions
                               where auth_uid = v_uid);
  end if;

  update public.crew_accounts
     set active_device_hash = v_device_hash, updated_at = now()
   where auth_uid = v_uid;

  insert into public.crew_role_sessions
    (restaurant_id, role, display_name, checked_in_at, auth_uid)
  values (v_acc.restaurant_id, p_role, v_acc.full_name, p_checked_in_at, v_uid)
  returning * into v_session;

  insert into public.role_session_tokens
    (token_hash, restaurant_id, role_session_id, role, expires_at, code_version)
  values (
    encode(extensions.digest(v_token, 'sha256'), 'hex'),
    v_acc.restaurant_id, v_session.id, p_role,
    now() + interval '9 hours', v_rest.code_version
  );
  return jsonb_build_object('session', to_jsonb(v_session), 'session_token', v_token);
end $$;
revoke all on function public.crew_shift_claim(text, timestamptz, text)
  from public, anon, authenticated, service_role;
grant execute on function public.crew_shift_claim(text, timestamptz, text) to authenticated;
```

  + `get_crew_accounts` / `reset_crew_account` / `end_active_crew_sessions` (pola token manager + audit, salin CTE Task 4).
  + CUT OVER lama: `drop function if exists public.claim_role_session(uuid,text,text,text,timestamptz,text);` — **HANYA bila Task 5 Step 0 audit memanggil:** `rg -n "claimRoleSession|claim_role_session" src tests` semua konsumen ikut dihapus/diganti (Task 7–9 menuntaskan UI; untuk urutan commit ini, drop dilakukan di Task 9 supaya main tak pernah patah — catat: migration file TETAP satu ini tapi merge Task 9 sebagai syarat). Keputusan implementasi: pisahkan drop ke `20260913130000_crew_legacy_cutover.sql` dibuat pada Task 9.
  + `crew_me` RPC (dipakai state-machine bootstrap & server fn): return `{paired, status, restaurant_name, full_name}` utk uid (authenticated):

```sql
create or replace function public.crew_me() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_build_object(
    'paired', true, 'status', a.status, 'full_name', a.full_name,
    'restaurant_name', r.display_name, 'restaurant_id', a.restaurant_id,
    'device_current', (a.active_device_hash = encode(extensions.digest(p_device_token,'sha256'),'hex'))
  ), jsonb_build_object('paired', false))
  from public.crew_accounts a join public.restaurants r on r.id = a.restaurant_id
  where a.auth_uid = auth.uid();
$$;
```
  (arg device token → jadikan parameter: `crew_me(p_device_token text)`. device_current = heuristik UI buat mutusin tendang / langsung check-in.)
- [ ] **Step 4: PASS + verify + commit** `feat(db): crew shift claim with device pin + manager crew admin RPCs`

---

## Phase C — Server fns & carrier

### Task 6: `src/lib/crew-auth.server.ts` (wrapper server fns)

**Files:**
- Create: `src/lib/crew-auth.server.ts`
- Test: `tests/point-3-crew-auth-server.test.ts`

- [ ] **Step 1: Test gagal** (pola mock rpc = `tests/role-session-server.test.ts`): mapping setiap error DB → code UI + pesan ID; `crewClaimShiftCore` mengirim args NAMED (`rpcNamed`); validator zod: role enum, checkedInAt iso, deviceToken min16, email z.string().email().
- [ ] **Step 2: FAIL.**
- [ ] **Step 3: Implement** — 7 `createServerFn` tipis (accessToken → `getAnonAuthedSupabaseClient`; TIDAK ada service-role utk jalur crew): `crewValidateCode`, `crewRequestPairing`, `crewConfirmPairing`, `crewClaimShift`, `crewMe`, + `crewAccountList`/`crewAccountReset`/`crewPairingList`/`crewPairingReject`/`crewSessionsEnd` (pakai manager token arg, tetap client-carry JWT — sama seperti `get_manager_snapshot` dipanggil: cek dulu bagaimana manager dashboard saat ini memanggil RPC authenticated-grant: `src/lib/manager-dashboard.server.ts` — IKUTI pola call-site itu, jangan bikin pola baru).
- [ ] **Step 4: PASS + commit** `feat(server): crew auth server functions`

### Task 7: Carrier staff bayangan + browser session storage

**Files:**
- Create: `src/lib/staff-carrier.server.ts`, `src/lib/browser-auth.ts`
- Test: `tests/point-3-staff-carrier.test.ts` (mock `createClient` service + browser client)

- [ ] **Step 1: Test gagal:** `ensureStaffCarrier({staffKind:'manager', accountId})` → (a) belum ada auth_user_id → createUser(email `<staff_id>+m@<domain internal? lihat Step 3 domain>`) simpan; (b) rotate password tiap panggil; (c) return `{email, password}`; (d) verifikasi kredensial staff sendiri BUKAN tanggung jawab fn ini (call-site `managerLogin` yang sudah ada yang validasi).
- [ ] **Step 2: FAIL.**
- [ ] **Step 3: Implement.** Email carrier: `shadow+<kind>-<account-uuid>@lihatmeja.com` (domain verified, tidak pernah dikirim email — email_confirm true). Gunakan service client `auth.admin.*`. `browser-auth.ts`: satu-satunya pembuat client browser (createClient localStorage persist), eksport `getCrewSessionState()`, `requestCrewOtp(email)`, `verifyCrewOtp(email, token)`, `signOutCrew()`, `staffSignInCarrier(email,password)`. Hapus `supabase-browser.ts` lama: `ensureAnonAccessToken` dipindah ke browser-auth sbg `refreshCarrierToken()` TANPA `signInAnonymously` (hanya getSession refresh). Call-site `getLiveAccessToken`: role routes & manager & AM → ganti import.
- [ ] **Step 4: Test guard anti-anon:** `tests/point-3-anon-guard.test.ts` — `fs` read semua file `src/**`, assert tidak ada string `signInAnonymously`. PASS.
- [ ] **Step 5: PASS + verify + commit** `feat(auth): shadow carrier for staff, crew browser session wrapper; ban signInAnonymously`

---

## Phase D — UI

### Task 8: CrewLoginFlow state machine

**Files:**
- Create: `src/routes/crew/index.tsx` (atau komponen `src/components/CrewLoginFlow.tsx` + mounting sesuai struktur rute yang ada — LIHAT: `src/routes/index.tsx` saat ini me-mount RoleLoginFlow di mana)
- Delete: bagian crew `src/components/RoleLoginFlow.tsx`
- Test: `tests/point-3-crew-login-flow.test.tsx`

- [ ] **Step 1: Test gagal** (jsdom; mock `@/lib/browser-auth` + server fns): transisi per spec §3.2: bootstrap→(paired?checkin:identify); identify otp salah→pesan generik; verify → belum paired → resto; kode salah → error; kode benar → **tampil `display_name` + ceklis**; LANJUTKAN → pairing + tombol request ulang setelah expired; OTP manager benar → checkin; device lain aktif → layar kick (teks §7); checkin: 4 role + jam (reuse markup lama) → `crewClaimShift(deviceToken localStorage uuid)`.
- [ ] **Step 2: FAIL** → **Step 3: Implement** (komponen fokus satu state machine + sub-form kecil; device token: `crypto.randomUUID()` localStorage key `lm.device.v1`). Markup check-in: salin dari `RoleLoginFlow.tsx:250-509` sesuaikan. **Step 4: PASS + commit** `feat(ui): crew email-account login flow`

### Task 9: Homepage 2 tombol + legacy cutover total

**Files:**
- Modify: `src/routes/index.tsx`
- Create: `supabase/migrations/20260913130000_crew_legacy_cutover.sql`
- Modify: `src/lib/restaurants.server.ts`, `src/lib/role-session.server.ts` (hapus jalur lama)

- [ ] **Step 1: Test gagal** — homepage render dua entry (button `CREW`, `MANAGER`), tidak ada input kode lagi; `tests` lama yang mock claim lama di-update.
- [ ] **Step 2: Implement UI** → **Step 3: Audit consumers** `rg -n "loginToRestaurant|verifyRestaurantPin|claimRoleSession|claim_role_session" src tests` → hapus yang crew-only. **Bila `login_to_restaurant_atomic` dipakai non-crew (cek manual: ESB/QR?) → JANGAN drop RPC-nya**, hanya hapus call-site crew. Cutover SQL: drop `claim_role_session`, drop `verify_restaurant_pin` bila tanpa konsumen lain (grep DB juga: `rg claim_role_session supabase/migrations/20260913*` tak ada referensi) + `update public.crew_role_sessions set auth_uid = auth_uid` (no-op; sesi lama diakhiri: `delete from public.role_session_tokens` = hard revoke semua sesi crew).
- [ ] **Step 4: verify (semua test lama legacy dihapus/di-update) + commit** `feat!: hard cutover crew login to account flow`

### Task 10: Dashboard Manager — kartu "Permintaan Crew" + daftar crew/reset

**Files:**
- Modify: `src/routes/manager/index.tsx` (+ komponen baru `src/components/manager/CrewPairingCard.tsx`, `CrewAccountsCard.tsx`)
- Test: `tests/point-3-manager-pairing-ui.test.tsx`

- [ ] **Step 1: Test gagal** — kartu merender request (email, nama, OTP 6 digit besar, countdown, Tolak); OTP dari server fn sudah terdekripsi (server fn `crewPairingList` mendekripsi `otp_encrypted` pakai key env yang sama dgn QR export — LIHAT `src/lib/qr*` utk nama konstanta persis). Tombol reset memanggil server fn dengan manager token (pola kartu crew aktif lama `get_manager_active_crew`).
- [ ] **Step 2: FAIL → Step 3: Implement → Step 4: PASS + commit** `feat(ui): manager pairing-requests + crew accounts cards`

---

## Phase E — Ops & selesai

### Task 11: Runbook

- [ ] Buat `docs/operations/point-3-crew-login-rollout.md`: urutan eksak = (1) config GoTrue: Email ON OTP-only + template ID + `noreply@lihatmeja.com` + SMTP Resend (smtp.resend.com:465; API key sama dgn RESEND_API_KEY) — matikan provider lain; (2) migration apply pakai playbook Poin 2 (backup→restore-check→apply `--single-transaction` + repair); (3) deploy; (4) smoke list (register baru HP fresh; 2 device kick; reset; manager OTP expire); (5) rollback = restore backup + redeploy build lama. Commit.

### Task 12: Review loop & PR

- [ ] `npm run verify` hijau → push branch → PR (sumber: worktree ini) → minta TASKLET re-review (user yang jalanin) → merge → eksekusi runbook BERSAMA user (config dashboard manual oleh user) → update roadmap Poin 3 + evidence doc + memo Poin 5 (§10 spec).

---

## Self-review plan vs spec (sudah dijalankan saat penulisan)

- §3.1 → Task 1, 11. §3.2 → Task 8. §3.3 → Task 7 (+ call-site Task 9 manager/AM page check). §3.4 → Task 10. §4.1/4.2 → Task 3 (+otp_encrypted di Task 4 Step 4 — **revisi: pindahkan CREATE kolom ke Task 3 sejak awal**). §4.3 → Task 4–5. §4.4 → Task 3, 9. §5 → tersebar (guard test Task 7; device pin Task 5; server-derived resto Task 5). §6 → Task 7 Step 4 + Task 9 Step 3 + Task 11 (audit SA console: tambahkan grep `getSupabaseBrowserClient` di routes super-admin). §7 → Task 8 tests mapping pesan. §8 → task-task DB/JS tests + smoke Task 11. §9 → Task 12.
- Risiko §12 #5 (logout & auth persist): keputusan final — **logout role-session TIDAK menghapus sesi Supabase email**; "Keluar akun" (hapus auth) tersedia di layar kick/profile crew.
