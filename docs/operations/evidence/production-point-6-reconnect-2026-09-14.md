# Evidence Poin 6 — Reconnect Jujur, Rampingkan Instruksi, Read Browser-Direct

**Tanggal:** 14 September 2026 (hari-1 pilot CKRBUL) — merge ±17:45 WIB, deploy READY ±17:57 WIB, apply migration 17:50-18:00 WIB.
**Spec:** `docs/superpowers/specs/2026-09-14-poin-6-reconnect-simplify-design.md` · **Plan:** `docs/superpowers/plans/2026-09-14-poin-6-reconnect-simplify.md`
**Metodologi:** TDD per task (RED dilihat/direproduksi ulang scratch-checkout), reviewer spec → reviewer quality → audit independen leader (AGENTS). Gate = CI GitHub (Poin 4) — `npm run verify` lokal tidak menunggu penuh (Windows >30 menit; CI Linux ±2 menit 05 detik, command identik).

## 1. Commits & PR

| Item | Nilai |
|---|---|
| Branch | `poin-6-reconnect-simplify` (10 commit) |
| PR | #31 — https://github.com/marko1kiro/table-talker-global/pull/31 |
| Merge | squash → main `fb639dce632fbca54c102072dd257ac5c5a571d3` |
| CI verify | run `34834214671` success (10:39:44→10:40:55 UTC) + run kedua `34834283171`/job verify success |
| CI db-reset | run `34834283184` job `db-reset` success |
| Deploy production | `dpl` url `lihat-meja-bx6hebeo7-gacoan1.vercel.app` (alias https://lihatmeja.com) state **READY**, meta sha = `fb639dc…` ✔ |
| Smoke | `HEAD https://lihatmeja.com` → 200 |

Baris commit: `ed7e7ee` plan docs · `4602b9e`+`a22bb5a` S1 frontend+guard · `b85fe60` S1 migration tombstone · `4aa1ba7`+`7b2df4f` S2 reconnect core+pin cleanup · `f9aae33`+`f219387` S2 auth→socket sync+order-independent test · `e8990f3`+`e9912d3` S3 read browser-direct+kommentar.

## 2. Backup + restore-check (sebelum apply)

- `pg_dump --format=custom --no-owner --no-privileges` via Session Pooler 17:59 WIB: `LIME\backup\point6-pre-drop-20260914-1759.dump`, **1.480.786 byte**.
- SHA-256 plaintext: `C673420AD40F72D036D3AE14D7B19D48A57B4FE722B3ABF5EECAAD7B478E237C`
- Restore-check lokal `127.0.0.1:5499` DB buang `restore_check_p6`: **48/48 tabel public** pulih; row-count kunci = produksi (restaurants 9, crew_accounts 10, crew_role_sessions 123, live_tokens 29, manager_accounts 6, admin_audit_log 56, occupancy 64, instruksi 0/0). 9 error restore = hanya keluarga `pg_cron` (ekstensi tak ada di PG lokal — tidak memuat data publik; preseden diterima).
- Enkripsi `pgcrypt.js` (AES-256-GCM, passphrase `LIME\backup-passphrase.txt` — JANGAN hilang): `point6-pre-drop-20260914-1759.dump.enc` (1.480.838 B), SHA-256 `.enc` `9BD467C886CB64D4584073ED2E9BC209063C377A5DC8B5CC567264922FB13BB5`. **Roundtrip decrypt = hash identik.** Plaintext dump dihapus. DB check dibuang.
- Rollback posture: restore `.enc` ini = kondisi pre-drop persis (termasuk 2 tabel instruksi kosong + RPC-nya).

## 3. Apply migration produksi

- `20260914140000_drop_manager_instructions.sql` — byte-identik dengan file repo, via MCP `apply_migration` (name `drop_manager_instructions`). **Catatan jujur:** nama versi MCP tercatat sebagai `drop_manager_instructions`; file repo tetap sumber kebenaran replay CI.
- Pre-count produksi (sebelum apply): `manager_instructions` = **0**, `instruction_receipts` = **0** → **nol baris hilang**; live tokens 29; 9/10/123/6/2/13/56/64/2 (aset §2 spec).
- Log 24 jam (window 13 Sep 11:00 UTC → 14 Sep 10:50 UTC, ClickHouse `logs`): **0 panggilan** RPC instruksi/`active_crew` (postgres_logs + path query kosong; konsisten 0 baris sejak fitur lahir).
- Post-count: fungsi fitur tersisa 0/8, tabel tersisa 0, membership publication 0, **cron `cleanup-expired-instructions-daily` = 0 (unschedule via migration bekerja di production)**.
- Aset pasca: restaurants 9 ✔, crew_accounts 10 ✔, crew_role_sessions 130 (+7 baru = trafik pilot nyata, bukan hilangan), **live tokens 36 (29→36 naik — sesi hidup tidak ditendang; 0 invalidasi)**, audit 56 ✔, occupancy 65 (+1 trafik), pairings 14 (+1 trafik). Semua delta = penambahan wajar.

## 4. Perubahan perilaku app (ringkas)

- **Hapus instruksi:** tab manager "KIRIM INSTRUKSI", banner 3 layar crew, 5 modul src, 7 test file; grep-lock `point-6-instruction-removal`.
- **Reconnect jujur:** tanpa fabrikasi SUBSCRIBED; retry ladder 1→2→4…60 dtk saat error dan online; pulih `online` = resubscribe instan (tanpa refetch liar); polling sehat 120 dtk / sakit 12 dtk; `onAuthStateChange` → `realtime.setAuth` di singleton (rotasi token tidak lagi meninggalkan socket JWT basi). 28+13 test kontrak (shuffle-safe).
- **Browser-direct reads:** snapshot okupansi (kasir/satgas/clear-up) + snapshot manager via `client.rpc` (JWT user, RPC `grant to authenticated`); wrapper server-fn read dihapus; mutasi tetap server fn. Grep-lock `point-6-read-transport`. Vercel invokasi read 12-dtkan → nol saat socket sehat.
- **Dokumentasi deviasi vs spec** (juga di header plan): RPC flush `report_crew_events` tidak ada — SS flush (`ingestPlaybackEvents`, tulis multi-step service-role) TETAP server fn; `crew/manager-instructions.server.ts` tidak ada (nama sebenarnya di `src/lib/`); `manager-crew-groups.ts` dipertahankan (dipakai crew/stats).

## 5. Risiko residual (diterima sadar)

- Tab lama (bundle pra-deploy) yang masih terbuka: banner instruksi polling → server fn hilang → try/catch swallow; Manager kirim instruksi (kalau ada yang coba) = error biasa. Bersih total saat reload shift berikutnya. Durasi jendela migration→deploy ~15 menit.
- Realtime 24 jam tetap bergantung retry internal supabase-js di atas jaring baru (dokumentasi spec §3.3).
- SS flush + validasi akses (30 dtk) masih invokasi server — target invokasi akhir lebih dekat batas atas 1-1,5jt/bln; revisit kalau Usage page minta.

## 6. PENDING / handoff

- **T3 (umur token GoTrue / `jwt_exp`): BELUM dieksekusi** — kredensial Management API (PAT `sbp_…`) tidak tersimpan di mesin ini. Jalur: set env user `SUPABASE_ACCESS_TOKEN` lalu leader jalankan GET → PATCH flat (satu field umur token) → GET verify (runbook 429 Poin 3), ATAU pemilik ubah manual Dashboard. Nol urgensi: konektivitas malam sudah beres via Task 3+4.
- **Field test pemilik (penutup DONE, spec §3.4.5):** (1) buka tab SS/kasir, (2) cabut router resto ±2 menit → banner "Menunggu koneksi realtime" MUNCUL jujur (dulu tidak pernah), (3) colok lagi → TANPA menyentuh tab: data fresh ≤12 dtk lalu berhenti ke ritme 120 dtk saat socket sehat; bell hidup lagi. (4) biarkan semalaman → pagi tetap real-time. Laporkan hasil ke leader.

## 7. Verdict

S1 ✔ (code+DB production), S2 ✔ (unit-terkontrak), S3 ✔ (terpasang di production `fb639dc`). CI hijau penuh di PR #31; production READY; sesi crew utuh (29→36 live tokens, 0 invalidasi); aset §2 utuh dengan bukti pre/post. Status Poin 6 = **SELESAI IMPLEMENTASI — menunggu field test pemilik + T3 (PAT)**.
