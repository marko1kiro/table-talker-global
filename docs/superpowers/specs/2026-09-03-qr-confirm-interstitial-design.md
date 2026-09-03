# QR Scan Confirmation Interstitial (Opsi D) — Desain

Tanggal: 2026-09-03
Status: disetujui user (studi kasus: pindah meja sebelum/sesudah pesan, salah
tap TIDAK, HP diemin, teman scan ulang, pesan di kasir, pesan lalu pindah)

## Latar

Scan QR meja saat ini langsung `302` ke halaman pesan ESB. Pelanggan yang
pindah meja sebelum memesan menyisakan meja lama "Terisi" selamanya (ghost
occupancy) hingga crew membersihkan manual. Opsi D menyisipkan halaman
konfirmasi antara scan dan halaman pesan: keputusan pelanggan menjadi sinyal
pembersihan yang aman, tanpa tracking pelanggan dan tanpa mengubah arah gagal
yang aman.

## Keputusan studi kasus (mengikat)

1. Status "Terisi" tetap ditandai **saat scan**, bukan saat YA — fail-safe:
   worst case tetap "nyangkut terisi sampai crew bersihkan", bukan
   "kosong-salah → makanan tertukar".
2. Tombol **TIDAK mengosongkan meja** hanya jika semua terpenuhi: scan masih
   scan terbaru di meja itu (tidak ada `qr_scan_events` lebih baru untuk
   restaurant+table setelah `processed_at` scan ini), dalam jendela 10 menit
   dari `created_at`, status meja "Terisi" dengan `occupied_source='qr_scan'`,
   dan scan berstatus `processed` (belum terminal). Gagal validasi = no-op.
3. Timeout / HP diemin / pesan di kasir: **tidak** mengosongkan apa pun;
   crew tetap backstop; alur kasir independen.
4. Pesanan yang sudah dibuat terikat ke meja di ESB — pindah meja setelah
   pesan = penyelesaian manusia (di luar scope; D mengurangi frekuensinya).
5. Scan ulang = pemulihan universal (salah tap TIDAK / HP diemin → scan ulang
   → dialog muncul lagi → YA). Catatan jujur: debounce scan 30 detik
   (per-IP-hash, `resolve_and_enqueue_qr_scan`) membuat rescan instan
   setelah TIDAK tidak memproses occupancy ulang — halaman tetap tayang,
   meja tetap "Kosong" hingga 30 detik lewat atau crew menandai. Pre-existing
   quirk debounce, dampak rendah.

## Alur baru

```
GET /q/{token}
  → resolve token + enqueue + proses scan (occupancy "Terisi", outbox
    durabel — TIDAK berubah, termasuk debounce + fail-open)
  → respons 200 HTML halaman konfirmasi (bukan 302):
      - "MEJA {n}" besar
      - "Anda akan memesan di Meja Nomor {n}. Mohon untuk tidak berpindah
        Meja agar makanan tidak tertukar dengan pesanan lainnya."
      - YA: <a href="{ESB url}"> "YA, SAYA MAU PESAN" — besar (min-h-20
        / 80px, teks 2xl+, full-width, kuning kontras tinggi)
      - TIDAK: <form method="post" action="/q/decline"> + hidden scan_id
        + tombol "Saya pindah meja" (sekunder, min-h-12)
POST /q/decline (scan_id)
  → validasi aturan → kosongkan meja + bump revision + realtime broadcast +
    tandai scan terminal (CUSTOMER_DECLINED) → halaman teks besar:
    "Meja dibatalkan. Silakan scan QR di meja baru ya, Kak." (redaksi final
    disetujui user)
  → validasi gagal / sudah terminal → halaman sama (idempoten, no-op)
```

YA = `<a href>` murni: tanpa panggilan server tambahan, navigasi langsung
ke ESB — latency identik hari ini. Halaman: HTML statis + inline CSS tanpa
JS, `Cache-Control: no-store`, CSP dengan `form-action 'self'` (form TIDAK
same-origin) + `X-Content-Type-Options: nosniff`. Pemrosesan scan tetap
best-effort sebelum respons (fail-open + retry pg_cron) — kontrak M-03 utuh.

## Perubahan teknis

1. **Migrasi baru (satu):** `decline_qr_scan(p_scan_id uuid) returns boolean`
   — security definer, `search_path = public`, grant hanya `service_role`
   (revoke public/anon/authenticated). Validasi berurutan; gagal = return
   false tanpa perubahan. Valid → update `table_occupancy_state` ke 'kosong'
   (occupied_at/source null) + `bump_table_occupancy_revision` +
   `realtime.send(jsonb, 'invalidate', topic, true)` + update
   `pending_qr_scans` ke terminal/CUSTOMER_DECLINED → true.
2. **`dynamic-qr.server.ts`:** path sukses kirim HTML interstitial (pola
   `invalidQrResponse`); URL ESB tetap dibangun sama, dipakai sebagai `href`
   tombol YA; helper halaman TIDAK dengan redaksi final.
3. **Route baru:** `src/routes/q/decline.ts` (POST form scan_id) — validasi
   format UUID, panggil RPC via service client, respons HTML ringan.

## Test

- 3 asersi kontrak 302 → 200 interstitial (dynamic-qr-interceptor,
  qr-interceptor-durable-outbox) — perubahan disengaja; asersi tambahan:
  nomor meja di halaman, `href` ESB benar, form TIDAK + scan_id, ukuran
  tombol YA, `no-store`, `form-action 'self'`.
- Test baru `tests/qr-decline.test.ts`: kontrak migrasi (grants, validasi),
  halaman TIDAK (redaksi eksak disetujui), idempoten, guard scan-terbaru &
  occupied_source.
- Legacy wrapper `handleQrInterceptorRequest` (302) tidak disentuh — bukan
  jalur live.
- `npm run verify` → push → CI migrations replay (migrasi baru) → apply
  migrasi baru saja ke target → read-back grants/fungsi → Vercel READY →
  probe interstitial live.

## Sengaja tidak diubah

Status marking saat scan, outbox M-03, pg_cron, debounce 30 detik, halaman
gangguan, alur kasir, privasi (tanpa cookie/tracking), format URL ESB,
legacy interceptor wrapper.
