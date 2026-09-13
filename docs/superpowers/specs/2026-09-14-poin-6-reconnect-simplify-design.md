# Desain Poin 6 — Reconnect Jujur, Rampingkan Fitur, Turun Transport

**Tanggal:** 14 September 2026 (pilot trial CKRBUL dimulai hari ini)
**Status:** MENUNGGU REVIEW PEMILIK
**Pemilik keputusan:** Marko (XDIRGA LABS)
**Roadmap:** MASTER-ROADMAP.md poin 6 (High) — menyerap pertanyaan kapasitas 9-resto.
**Supersedes none.** Bukan penggantian desain Poin 2/3/5; menyentuh sisanya hanya sebagai penyusutan.

---

## 1. Konteks & keputusan pemilik

1. Bedah 14 Sep menemukan 6 lubang reconnect (L1-L6): status channel dipalsukan timer 5 dtk, nol listener `online`, broadcast tak pernah di-replay, subscribe status diabaikan, `setAuth` tanpa `onAuthStateChange`, nol test skenario putus-nyambung. Operasi 24 jam bikin ini pasti kejadian tiap malam.
2. Hitungan bottom-up 9 resto 24 jam (asumsi pemilik: SS8/SATGAS4/KASIR6/CU10/MGR6 orang per resto per hari, semua shift; QR pelanggan 600-2500 scan/hari): polling 12 dtk lewat server function = **20-40 juta invokasi Vercel/bulan** (±$75-120/bln total infra). Audit transport baris kode: snapshot okupansi, instruksi, dan flush SS semuanya `createServerFn` padahal isinya RPC terautentikasi pass-through.
3. Keputusan pemilik (14 Sep, final):
   - **Fitur instruksi Manager→crew DIHAPUS TOTAL.** Kanal instruksi dunia nyata = grup WhatsApp resto. (Bukan keputusan biaya — keputusan YAGNI.)
   - Versi murah Poin 6: TIDAK ada tabel notice baru, TIDAK ada replay log notifikasi. Bell/log "selama halaman terbuka" tetap.
   - **T4 (QR static) dan T5 (payload delta) DITUNDA** — deferred, bukan batal; diangkat lagi hanya kalau monitoring produksi minta.
   - Target biaya akhir: **±$25-45/bulan** (Supabase Pro $25 + Vercel Pro ±$20 dengan penggunaan nyaris nol + Resend $0), semua layar tetap live.

## 2. Aset yang WAJIB tetap utuh (hard constraint)

QR table token + export batch, 9 master restoran, manifest/katalog/file audio, `crew_accounts`, `crew_role_sessions`, `role_session_tokens` hidup, `manager_accounts`, `area_manager_accounts`, registry staff, super admin, schema `realtime`. Migration hanya boleh menyentuh: `public.manager_instructions`, `public.instruction_receipts`, dan RPC RPC instruksi (daftar di §3.1). Wajib bukti pre-count/post-count semua aset di atas di evidence doc (preseden Poin 1/2/3).

## 3. Scope

### 3.1 Seksi 1 — Hapus total fitur instruksi (pola Poin 1: UI + server + DB + tombstone)

- UI/hook: tab "KIRIM INSTRUKSI" (`manager/index.tsx` messages menu + channel `mgr-instr` + broadcast `instruction`), `use-pending-instructions` beserta pemakaiannya di kasir/satgas/clear-up, komponen banner instruksi.
- Server fn: `crew-instructions.server.ts`, `manager-instructions.server.ts`; call-site `ack`/`reply`/`active crew for messaging` yang hanya dipakai fitur ini.
- DB (migration tunggal, additive-safe): drop function `send_manager_instruction`, `get_pending_instructions`, `ack_instruction`, `reply_instruction`, `get_instruction_thread`, `cleanup_expired_instructions`, `get_manager_active_crew` (hanya jika terbukti tak dipakai fitur lain — verifikasi grep saat implementasi), + cron job `cleanup-expired-instructions-daily` (hapus via `cron.unschedule` di migration), drop table `manager_instructions`, `instruction_receipts`. Migration pembuatnya DITINGGAL apa adanya (file historis); migration baru mencatat alasan (tombstone pattern Poin 1).
- Test lama fitur ini DIHAPUS bersamaan (bukan di-skip/ditumpulkan hijau palsu). Kontrak test yang menyebut nama fitur (mis. route manager scan "KIRIM INSTRUKSI") diperbarui.
- **Nol dampak sesi:** tabel/RPC ini tidak dipakai jalur auth/claim shift; crew yang masih memegang tab instruksi lama cukup melihat layar tanpa banner setelah reload.

### 3.2 Seksi 2 — Inti reconnect (permukaan yang tersisa: okupansi + bell + dashboard manager)

- **Status jujur:** hapus timer force-SUBSCRIBED 5 dtk di `use-table-occupancy-realtime.ts`. Banner koneksi = proyeksi langsung state channel (`SUBSCRIBING/SUBSCRIBED/TIMED_OUT/CHANNEL_ERROR/CLOSED`) + flag offline.
- **`useOnlineRecovery` (modul murni + hook tipis, TDD penuh):** dengar `window` `online`/`offline` + `visibilitychange` (hanya untuk jeda, bukan reconnect — kontrak lama dipertahankan). Saat pulih: satu refetch langsung + perintah resubscribe; backoff eksponensial 1→2→4→… sampai cap 60 dtk, reset setelah SUBSCRIBED. Tidak ada timer saat sehat (idle = nol biaya).
- **Auth→socket:** `onAuthStateChange` di klien browser memanggil `realtime.setAuth(token)`; hilangkan ketergantungan setAuth ad-hoc sekali-pakai di hook (tetap boleh ada sebagai belt-and-braces).
- Bell/notice tetap in-memory, tanpa replay (keputusan §1.3).

### 3.3 Seksi 3 — Kapasitas: turun transport + event-driven sejati

- **Read-only pindah ke browser langsung** (browser→supabase-js `.rpc()` dengan JWT crew/manager yang SUDAH ada di browser + session token; TIDAK ada service key di klien; RLS/definer tidak berubah): snapshot okupansi (`get_manager_snapshot` read path untuk 4 permukaan grid) dan flush telemetri SS (`report_crew_events` sudah menerima tenant token dari browser — pindahkan panggilan rpc langsung). Mutasi stateful (duduk/kosong/claim/ack pairing/login) TETAP lewat server fn seperti sekarang.
- **Event-driven sejati:** saat `SUBSCRIBED`, tidak ada interval 12 dtk; yang ada heartbeat refetch 120 dtk (jaring revisi) + refetch instan per broadcast invalidate (rate-limit 1 dtk tetap). Fallback 12 dtk HANYA aktif saat status != SUBSCRIBED atau flag offline. Worst-case staleness: sehat ≈ 120 dtk (karena broadcast <1 dtk menangani perubahan nyata), sakit = 12 dtk.
- **T3 config (runbook, nol kode):** perpanjang `GOTRUE_JWT_EXP`/idle refresh via prosedur Management API yang sama seperti insiden 429 (flatten, reload ~45 dtk, bukti GET balik). Hanya memengaruhi token BARU; sesi hidup tidak disentuh.
- Residual yang diterima sadar: koneksi realtime 24 jam tetap bergantung retry internal supabase-js; kita hanya menambah jaring jujur di atasnya.

### 3.4 Seksi 4 — Verifikasi & rollout

1. TDD per task (subagent fresh + review dua tahap + audit independen leader; AGENTS.md).
2. Kontrak test baru yang WAJIB ada: status tidak pernah SUBSCRIBED tanpa callback asli; `online` memicu tepat satu refetch+resubscribe; backoff monotik dengan cap; interval 12 dtk hanya saat tidak sehat; heartbeat 120 dtk saat sehat; read path browser-panggil-RPC benar (mock transport); penghapusan fitur (grep-lock: tidak ada lagi import `crew-instructions.server`/`use-pending-instructions`).
3. CI = gerbang penuh (Poin 4): verify + db-reset replay di checkout bersih.
4. Rollout production berurutan, di jendela sepi (malam after-trial-day atau pergantian shift): (a) backup DB (pola Poin 3: dump terenkripsi + restore-check) → (b) apply migration drop instruksi → postflight aset lengkap → (c) deploy app → (d) smoke: crew login berjalan terus (cek `role_session_tokens` lama tetap hidup), banner koneksi jujur, `online` pulih fresh ≤12 dtk.
5. **Field test perangkat nyata (runbook manual, pemilik):** cabut router resto 2 menit saat tab SS/kasir terbuka → banner merah jujur → colok kembali → tanpa menyentuh tab, data fresh ≤12 dtk dan bell hidup lagi. Ini penutup DONE Poin 6 (preseden Poin 3 §4).
6. Evidence doc: `docs/operations/evidence/production-point-6-<date>.md` (SHA, run CI, pre/post-count, config diff, tangkapan biaya before/after dari Usage page).

## 4. Out of scope (disepakati pemilik 14 Sep)

T4 QR static; T5 delta payload; notice-log tahan-putus; blacklist G1 (sudah ditolak); perubahan hierarki Poin 2; re-migrasi pairing Poin 3; rate-limit Kode Resto+PIN (Poin 9); idempotensi QR (Poin 8); audio offline (Poin 7); telemetry SS penuh (Poin 10).

## 5. Risiko & mitigasi

| Risiko | Mitigasi |
|---|---|
| Tab crew lama (bundle pra-deploy) memanggil server fn yang dihapus → error 404 senyap | Fetch instruksi sudah try/catch swallow di semua hook; deploy di jendela sepi; reload shift berikutnya bersih. Tidak ada jalur auth yang dihapus. |
| Drop RPC kena pemakai tak terduga | grep call-site wajib (test kontrak scan) + PostgREST log cek 24 jam sebelum deploy (Edge/`api` logs query by path). |
| Event-driven = perubahan perilaku terkontrak test lama | Kontrak ditulis ulang lewat TDD, bukan dilonggarkan diam-diam. |
| T3 memanjangkan umur token = tablet ditinggal lebih lama tetap terautentikasi | Jendela aksi tetap dikunci role session 9 jam + device pin + `Cabut sesi` manager. Dicatat di runbook keamanan. |
| Sesi crew hidup kena deploy | Larangan keras: tidak ada rotasi kredensial/invalidasi sesi di scope ini; verifikasi post-deploy `role_session_tokens` pre sama. |

## 6. Angka target (untuk review, bukan SLA)

Vercel invokasi 20-40jt/bln → **±1-1,5jt** (mutasi+SSR+login saja). Egress Supabase tetap ±90-150GB (<250 Pro). Realtime messages ±3,5jt (<5jt). Email OTP ±1,2-1,5k/bln setelah T3 (<3rb Resend free). Tagihan **$25-45/bulan ≈ Rp410-740rb** — semua fitur yang tersisa utuh, instruksi manusia lewat WA.
