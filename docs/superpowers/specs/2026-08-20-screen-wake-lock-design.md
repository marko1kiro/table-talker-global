# Screen Wake Lock Auto-on — Design

**Tanggal:** 2026-08-20
**Status:** Disetujui
**Pemilik:** miracle1min

## Tujuan

Mencegah layar perangkat crew mati/sleep selama app dibuka di halaman soundboard, tanpa crew perlu membaca atau mengatur apa pun. Wake lock aktif otomatis dan diam-diam.

## Context

Restoran: crew membuka halaman soundboard untuk mendengar panggilan remote. Saat layar mati (sleep), audio tetap bisa bunyi beberapa OS tapi ada risiko: audio playback tidak berjalan andal saat tab hidden, dan tuntutan memanggil meja secara fisik saat layar gelap tidak efektif. Fitur ini memastikan layar tetap menyala selama halaman soundboard aktif di browser.

Gunakan **Screen Wake Lock API** native (`navigator.wakeLock.request("screen")`) — tersedia di Chrome/Edge/Samsung Internet desktop & mobile pada secure context (HTTPS), auto-granted tanpa prompt permission. Tidak butuh dependency baru. Firefox tidak support API ini; unsupported browser = silent no-op (wakelock tidak aktif, tanpa UI error).

## Scope

### Termasuk

- Wake lock aktif otomatis saat halaman soundboard (route `/`) di-mount, setelah crew identity ter-hydrate.
- Auto re-acquire saat halaman kembali visible dari hidden (browser auto-release saat tab hidden).
- Release saat halaman unmount (navigasi keluar route `/`).
- Silent no-op saat browser tidak mendukung.

### Tidak termasuk (YAGNI)

- Toggle/persetujuan interaktif di UI — crew tidak boleh baca apa-apa.
- Wake lock di halaman super admin.
- Persistensi preferensi (auto-selalu nyala).
- Fallback non-Wake-Lock (mis. no-sleep polyfill) — out of scope.

## Pendekatan yang Dipilih

Dari opsi (1) Wake Lock hook + auto re-acquire, (2) + banner status kecil, (3) + persist user pref — user pilih **opsi 1**, hanya untuk crew. Banner dan persist dibuang agar UI tetap "biasa saja".

## Architecture

### Komponen Baru: `src/lib/screen-wake-lock.ts` + `src/hooks/use-screen-wake-lock.ts`

Split pure logic (lib) dari React binding (hook) — pola sama seperti `supabase-browser.ts` + `use-remote-crew.ts`.

**Lib `screen-wake-lock.ts`** (pure, semua testable tanpa jsdom):

- `requestScreenWakeLock()` → wrapper `navigator.wakeLock.request("screen")`; return `null` saat `navigator.wakeLock` undefined; promise reject di-catch jadi `null` (silent).
- `releaseScreenWakeLock(sentinel)` → `void sentinel.release()`; safe no-op kalau sentinel falsy.
- `visibleWakeLockState({ active, sentinelActive, visibility })` → pure decision function:

```ts
type WakeLockInput = {
  active: boolean;         // enabled by host (identityHydrated)
  sentinelActive: boolean; // sentinel already requested
  visibility: string;      // "visible" | "hidden"
};
```

 Returns salah satu action: `"request"` / `"release"` / `"none"`. Logic:

- `!active` dan sentinelActive → `"release"`.
- `active`, `!sentinelActive`, visibility `"visible"` → `"request"`.
- selain itu → `"none"`.

Membuat decision murni & satu source of truth, whole logic tested tanpa React. Request duplikat (race visibilitychange saat in-flight) tidak masuk dalam decision — `wakeLock.request()` saat sudah aktif hanya resolve tambahan, harmless.

**Hook `use-screen-wake-lock.ts`** (thin binding):

- `useScreenWakeLock(enabled: boolean)`.
- Ref sentinel; `useEffect` subscribe `enabled` + satu `visibilitychange` listener.
- Tiap kali effect re-run atau visibility berubah → jalankan decision function, eksekusi action (`request` catch silent, `release`).
- Cleanup unmount: release sentinel, hapus listener.

### Integrasi: `src/routes/index.tsx`

- Tidak ada perubahan UI.
- Panggil hook di `SoundboardPage`:

```tsx
useScreenWakeLock(identityHydrated);
```

- `SoundboardPage` di-mount hanya setelah `auth.dashboard` true (lihat `SoundboardRoute`). Jadi wake lock tidak pernah aktif sebelum login crew.
- `identityHydrated` di-set true di `useEffect` mount (jalur sama dengan read session identity). `enabled` false→true → decision → request. Tidak mengganggu alur `CrewIdentityDialog`.

## Data Flow

1. Crew buka `/` → `SoundboardRoute` → auth OK → `SoundboardPage` mount.
2. `identityHydrated` false awalnya, lalu true setelah `useEffect` hydrate identity.
3. Hook menerima `enabled=true` → `navigator.wakeLock.request("screen")` → sentinel aktif. Browser menahan layar nyala selama tab visible.
4. Crew pindah tab → browser auto-release sentinel (per spek). Tab kembali → `visibilitychange` visible → sentinel sudah release, hook re-request.
5. Crew close tab/navigasi keluar → cleanup → `sentinel.release()`.
6. Browser tanpa support → `navigator.wakeLock` undefined → tidak ada request, hijau tanpa error.

## Error Handling

- `request()` reject: ditangkap dan di-ignore. Tidak ada UI error, tidak ada crash. Ini termasuk kasus permission denied (tidak terjadi di browser yang support karena auto-granted), tab hidden saat request, dll.
- `sentinel.addEventListener("release", ...)`: **dipakai**, agar re-request ulang andal. Browser auto-release sentinel saat tab hidden (per spek Wake Lock). Tanpa listener, sentinelRef tetap non-null setelah auto-release → saat kembali visible decision melihat "sudah ada sentinel" → tidak re-request → layar bisa tidur. Listener set sentinelRef null saat release; visibilitychange selanjutnya memicu re-request.
- Guard `sentinel !== null` mencegah request berulang; request result juga ditolak saat `document.visibilityState !== "visible"` (request in-flight yang resolve setelah tab hidden tidak boleh menyimpan sentinel stale).

## Testing

File baru: `tests/screen-wake-lock.test.ts`

- **Pure `visibleWakeLockState`** (gate kecil unit):
  1. active, tidak request → `"request"`.
  2. active + sudah request → `"none"` (tanpa re-request).
  3. hidden + sudah request → `"none"`.
  4. hidden + tidak request → `"none"` (tidak request saat tab hidden).
  5. `!active` + sentinel → `"release"`.
  6. `!active` + tidak ada sentinel → `"none"`.

- **`requestScreenWakeLock`** (stub `globalThis.navigator.wakeLock` via `vi.stubGlobal`):
  1. wakeLock support → panggil `request("screen")`; return sentinel.
  2. wakeLock undefined → return null, tidak throw.
  3. request reject → return null, tidak throw.

- **Koneksi hook → lib**: pola test existing (mis. `tests/supabase-browser.test.ts`) — hook adalah thin binding; jika renderHook/jsdom tidak tersedia (env test saat ini vitest tanpa jsdom/environment), uji hanya pure decision + request wrapper. Hook logic sendiri tipis, tidak memerlukan test tersendiri.

## References

- Prior feature terkait: crew session continuity (`docs/superpowers/specs/2026-08-15-crew-session-continuity-design.md`).
- MDN Screen Wake Lock API: `https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API` (referensi behavior auto-release saat visibility hidden).