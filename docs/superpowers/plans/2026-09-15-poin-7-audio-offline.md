# Poin 7 — Audio Tahan Offline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SS tetap bunyi setelah reload offline dari cache terakhir, dengan cek-versi otomatis + background sync saat online.

**Architecture:** Snapshot manifest kecil di localStorage (`lm.audio.manifest.v1`) yang ditulis hanya pasca-sync sukses; SyncDialog menjadi penentu mode (first-ever blocking / online-sync / offline-fallback) dan melaporkan versi server lewat callback baru; `index.tsx` menjalankan background sync saat versi basi, menampilkan pill progres + status umur di dropdown Profil; playback (sudah cache-first via pool) tidak disentuh.

**Tech Stack:** React/TanStack Start, Cache Storage + localStorage, sonner (sudah ter-mount global), lucide-react, Vitest + Testing Library (jsdom) + source-scan guards (pola repo).

**Spec:** `docs/superpowers/specs/2026-09-15-poin-7-audio-offline-design.md`.

**Catatan kejujuran (deviasi/superesi terhadap spec):**
1. Spec §4 awal (Q2) menjanjikan "banner jelas Mode offline" di layar utama; instruksi pemilik berikutnya (Q3) memindahkan SEMUA teks status ke dropdown Profil agar layar utama steril. Yang menang = instruksi terbaru: TIDAK ada tambahan permanen di layar utama selain pill sync sementara. Mode offline diketahui via Profil + aksi sambung-ulang di sana.
2. `onSynced(audioIds)` TIDAK diubah signature-nya (dikunci scan-test) — info versi/offline lewat callback baru yang opsional.

**Aturan kerja (mengikat):**
- TDD ketat RED→GREEN; shell PowerShell prefix node seperti biasa.
- Verifikasi lokal TERTARGET saja (`npx vitest run <file>`, `npm run typecheck` ±1 mnt, `npx eslint <file...>`). DILARANG `npm run verify`/full suite/`eslint .` (gate = CI).
- Commit lokal per task di branch `poin-7`. **JANGAN push/PR sebelum perintah pemilik.** Tidak ada migration; tidak ada perubahan package/lock/config/CI.
- Secret tidak pernah dicetak. Sesi/auth/realtime tidak disentuh.
- Copy UI memakai teks persis di plan.

**File map:**
- Create: `src/lib/audio-manifest-store.ts`, `tests/point-7-audio-manifest-store.test.ts`, `tests/point-7-sync-offline.test.tsx`, `tests/point-7-build-guards.test.ts`
- Modify: `src/components/SyncDialog.tsx`, `src/routes/index.tsx`, `tests/sync-dialog.test.ts` (adaptasi needle minimal), `tests/soundboard-sync-wiring.test.ts` (adaptasi needle minimal)
- Docs (ikut commit, push bareng PR nanti perintah pemilik): `docs/operations/evidence/production-point-6-1-crew-password-2026-09-15.md` (sudah tertulis lokal, untracked — di-add saat Task 4)

---

### Task 1: Modul murni `audio-manifest-store.ts`

**Files:**
- Create: `src/lib/audio-manifest-store.ts`
- Test: `tests/point-7-audio-manifest-store.test.ts`

Modul tanpa DOM/network: snapshot localStorage + keputusan startup + format umur kompak.

- [ ] **Step 1.1: Tulis test yang gagal**

```ts
// Poin 7 Task 1: manifest snapshot store — pure, no DOM, no network.
// localStorage is stubbed per-test (real jsdom storage would leak between files).
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  clearAudioSnapshot,
  decideAudioStartup,
  formatAudioAge,
  loadAudioSnapshot,
  saveAudioSnapshot,
  type AudioSnapshot,
} from "@/lib/audio-manifest-store";

const snap = (over: Partial<AudioSnapshot> = {}): AudioSnapshot => ({
  restaurantId: "resto-1",
  catalogVersion: 12,
  fetchedAt: 1_000_000,
  items: [{ audioId: "table:1", hash: "h1", size: 100 }],
  ...over,
});

function memStorage(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

describe("snapshot round-trip", () => {
  test("save then load returns the same snapshot", () => {
    const s = memStorage();
    saveAudioSnapshot(snap(), { storage: s as Storage });
    expect(loadAudioSnapshot("resto-1", { storage: s as Storage })).toEqual(snap());
  });

  test("load ignores other restaurants", () => {
    const s = memStorage();
    saveAudioSnapshot(snap(), { storage: s as Storage });
    expect(loadAudioSnapshot("resto-2", { storage: s as Storage })).toBeNull();
  });

  test("corrupt JSON / wrong shape / empty items => null (fail-safe to first-ever)", () => {
    const s = memStorage({
      "lm.audio.manifest.v1:resto-1": "bukan-json{{{",
    });
    expect(loadAudioSnapshot("resto-1", { storage: s as Storage })).toBeNull();
    const s2 = memStorage();
    saveAudioSnapshot(snap({ items: [] }), { storage: s2 as Storage });
    expect(loadAudioSnapshot("resto-1", { storage: s2 as Storage })).toBeNull();
  });

  test("storage throwing (private mode) never throws", () => {
    const bad = {
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("denied"); },
      removeItem: () => { throw new Error("denied"); },
    };
    expect(() => saveAudioSnapshot(snap(), { storage: bad as unknown as Storage })).not.toThrow();
    expect(loadAudioSnapshot("resto-1", { storage: bad as unknown as Storage })).toBeNull();
    expect(() => clearAudioSnapshot("resto-1", { storage: bad as unknown as Storage })).not.toThrow();
  });

  test("clear removes only that restaurant", () => {
    const s = memStorage();
    saveAudioSnapshot(snap(), { storage: s as Storage });
    saveAudioSnapshot(snap({ restaurantId: "resto-2" }), { storage: s as Storage });
    clearAudioSnapshot("resto-1", { storage: s as Storage });
    expect(loadAudioSnapshot("resto-1", { storage: s as Storage })).toBeNull();
    expect(loadAudioSnapshot("resto-2", { storage: s as Storage })).not.toBeNull();
  });
});

describe("decideAudioStartup", () => {
  test("no snapshot => first-ever (blocking allowed)", () => {
    expect(decideAudioStartup({ snapshot: null, fetched: null })).toBe("first-ever");
  });

  test("fetch failed + snapshot => offline", () => {
    expect(decideAudioStartup({ snapshot: snap(), fetched: null })).toBe("offline");
  });

  test("same version => current", () => {
    expect(decideAudioStartup({ snapshot: snap(), fetched: { version: 12 } })).toBe("current");
  });

  test("different version => stale", () => {
    expect(decideAudioStartup({ snapshot: snap(), fetched: { version: 13 } })).toBe("stale");
  });
});

describe("formatAudioAge", () => {
  const now = 10_000_000;
  test("compact Indonesian, single line, no wrapping words", () => {
    expect(formatAudioAge(now - 10_000, now)).toBe("baru saja");
    expect(formatAudioAge(now - 5 * 60_000, now)).toBe("5 mnt");
    expect(formatAudioAge(now - 2 * 3_600_000, now)).toBe("2 jam");
    expect(formatAudioAge(now - 3 * 86_400_000, now)).toBe("3 hr");
    expect(formatAudioAge(now + 60_000, now)).toBe("baru saja");
  });
});
```

- [ ] **Step 1.2: Jalankan, pastikan GAGAL**

Run: `npx vitest run tests/point-7-audio-manifest-store.test.ts`
Expected: FAIL — modul belum ada (import error).

- [ ] **Step 1.3: Implementasi `src/lib/audio-manifest-store.ts`**

```ts
// Poin 7: last-known-good manifest snapshot. localStorage only (tiny, sync
// read at boot), written ONLY after a fully hash-verified sync. Corrupt or
// empty snapshots read as absent so the flow falls back to first-ever sync.

export type AudioSnapshotItem = { audioId: string; hash: string; size: number };

export type AudioSnapshot = {
  restaurantId: string;
  catalogVersion: number;
  fetchedAt: number;
  items: AudioSnapshotItem[];
};

export type StoreDeps = { storage?: Pick<Storage, "getItem" | "setItem" | "removeItem"> };

const KEY_PREFIX = "lm.audio.manifest.v1:";

function keyFor(restaurantId: string): string {
  return `${KEY_PREFIX}${restaurantId}`;
}

function storageOf(deps: StoreDeps): Pick<Storage, "getItem" | "setItem" | "removeItem"> | null {
  if (deps.storage) return deps.storage;
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

function isSnapshot(value: unknown): value is AudioSnapshot {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.restaurantId !== "string" || v.restaurantId.length === 0) return false;
  if (typeof v.catalogVersion !== "number" || !Number.isFinite(v.catalogVersion)) return false;
  if (typeof v.fetchedAt !== "number" || !Number.isFinite(v.fetchedAt)) return false;
  if (!Array.isArray(v.items) || v.items.length === 0) return false;
  return v.items.every(
    (it) =>
      typeof it === "object" &&
      it !== null &&
      typeof (it as Record<string, unknown>).audioId === "string" &&
      typeof (it as Record<string, unknown>).hash === "string" &&
      typeof (it as Record<string, unknown>).size === "number",
  );
}

export function saveAudioSnapshot(snapshot: AudioSnapshot, deps: StoreDeps = {}): void {
  const storage = storageOf(deps);
  if (!storage) return;
  try {
    storage.setItem(keyFor(snapshot.restaurantId), JSON.stringify(snapshot));
  } catch {
    // Private mode / quota: offline fallback simply unavailable. Never throw.
  }
}

export function loadAudioSnapshot(restaurantId: string, deps: StoreDeps = {}): AudioSnapshot | null {
  const storage = storageOf(deps);
  if (!storage) return null;
  try {
    const raw = storage.getItem(keyFor(restaurantId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isSnapshot(parsed) || parsed.restaurantId !== restaurantId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearAudioSnapshot(restaurantId: string, deps: StoreDeps = {}): void {
  const storage = storageOf(deps);
  if (!storage) return;
  try {
    storage.removeItem(keyFor(restaurantId));
  } catch {
    // Never throw on cleanup paths (logout must always succeed).
  }
}

export type StartupDecision = "first-ever" | "offline" | "current" | "stale";

export function decideAudioStartup(args: {
  snapshot: AudioSnapshot | null;
  fetched: { version: number } | null;
}): StartupDecision {
  if (!args.snapshot) return "first-ever";
  if (!args.fetched) return "offline";
  return args.fetched.version === args.snapshot.catalogVersion ? "current" : "stale";
}

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

// Compact single-line age for the Profile dropdown (owner rule: responsive,
// never force long text). All outputs are one short token pair.
export function formatAudioAge(fetchedAt: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - fetchedAt);
  if (diff < MINUTE) return "baru saja";
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} mnt`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)} jam`;
  return `${Math.floor(diff / DAY)} hr`;
}
```

- [ ] **Step 1.4: GREEN + typecheck + commit**

Run: `npx vitest run tests/point-7-audio-manifest-store.test.ts` → 11/11 pass.
Run: `npm run typecheck` → 0. `npx eslint src/lib/audio-manifest-store.ts tests/point-7-audio-manifest-store.test.ts` → 0.
`git add src/lib/audio-manifest-store.ts tests/point-7-audio-manifest-store.test.ts && git commit -m "feat(poin-7): snapshot manifest store + keputusan startup + umur kompak"`

---

### Task 2: SyncDialog — penentu mode (offline-fallback + lapor versi)

**Files:**
- Modify: `src/components/SyncDialog.tsx`
- Test: `tests/point-7-sync-offline.test.tsx` (baru, jsdom runtime)
- Modify test: `tests/sync-dialog.test.ts` (adaptasi needle minimal — JANGAN hapus pin perilaku)

Perubahan: (a) panggilan manifest dibungkus timeout ±8 dtk; (b) gagal ambil manifest + ada `fallbackSnapshot` → mode offline: lapor SYNC_OFFLINE (telemetri dipertahankan), panggil `onOfflineReady(snapshot)` lalu `onSynced(ids snapshot)`; tanpa snapshot → error seperti sekarang; (c) manifest sukses → panggil `onManifestFresh({ version, items })` SELALU (sebelum/sesudah sync — pilih: segera setelah manifest diterima, agar parent bisa mulai background-sync paralel); (d) sync sukses penuh → parent yang menulis snapshot (bukan dialog) — dialog tetap murni UI + fetch.

- [ ] **Step 2.1: Tulis test jsdom yang gagal**

`tests/point-7-sync-offline.test.tsx` — ikuti pola mock module seperti `tests/point-6-1-crew-login-flow.test.tsx` (`vi.mock("@/lib/restaurants.server")`, `vi.mock("@/lib/audio-sync")`), DOM-property assertions (TANPA jest-dom matchers — policy repo):

```tsx
// @vitest-environment jsdom
// Poin 7 Task 2: SyncDialog decides the mode. Offline + snapshot => calls
// onOfflineReady + onSynced(snapshot ids) WITHOUT blocking; offline WITHOUT
// snapshot => legacy error; manifest ok => reports version via onManifestFresh.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

const getRestaurantManifest = vi.fn();
const syncManifest = vi.fn();

vi.mock("@/lib/restaurants.server", () => ({
  getRestaurantManifest: (a: unknown) => getRestaurantManifest(a),
}));
vi.mock("@/lib/audio-sync", () => ({
  createSyncRunGate: () => {
    let n = 0;
    return { start: () => ++n, isCurrent: (id: number) => id === n, cancel: () => ++n };
  },
  syncManifest: (...a: unknown[]) => syncManifest(...a),
}));
vi.mock("@/lib/error-capture", () => ({ captureError: vi.fn(() => Promise.resolve()) }));

import { SyncDialog } from "../src/components/SyncDialog";

const SNAP = {
  restaurantId: "resto-1",
  catalogVersion: 12,
  fetchedAt: 1_000_000,
  items: [{ audioId: "table:1", hash: "h1", size: 10 }],
};

const MANIFEST = {
  ok: true as const,
  version: 12,
  manifest: [
    { audioId: "table:1", contentHash: "h1", byteSize: 10, label: "Meja 1", downloadUrl: "u", downloadGrant: "g" },
  ],
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  getRestaurantManifest.mockReset();
  syncManifest.mockReset();
});

describe("offline fallback", () => {
  it("fetch gagal + ada snapshot => onOfflineReady + onSynced ids snapshot, tanpa error", async () => {
    getRestaurantManifest.mockRejectedValue(new TypeError("offline"));
    const onOfflineReady = vi.fn();
    const onSynced = vi.fn();
    const onManifestFresh = vi.fn();
    render(
      <SyncDialog
        restaurantId="resto-1"
        tenantToken="tok"
        fallbackSnapshot={SNAP}
        onOfflineReady={onOfflineReady}
        onManifestFresh={onManifestFresh}
        onSynced={onSynced}
        onSessionInvalid={vi.fn()}
        manifestTimeoutMs={0}
      />,
    );
    await waitFor(() => expect(onOfflineReady).toHaveBeenCalledWith(SNAP));
    expect(onSynced).toHaveBeenCalledWith(["table:1"]);
    expect(syncManifest).not.toHaveBeenCalled();
    expect(screen.queryByText("Sinkronisasi Gagal")).toBeNull();
    expect(onManifestFresh).not.toHaveBeenCalled();
  });

  it("fetch gagal + TANPA snapshot => error lama (blocking first-ever dipertahankan)", async () => {
    getRestaurantManifest.mockRejectedValue(new TypeError("offline"));
    const onOfflineReady = vi.fn();
    const onSynced = vi.fn();
    render(
      <SyncDialog
        restaurantId="resto-1"
        tenantToken="tok"
        onOfflineReady={onOfflineReady}
        onSynced={onSynced}
        onSessionInvalid={vi.fn()}
        manifestTimeoutMs={0}
      />,
    );
    await waitFor(() => expect(screen.queryByText("Sinkronisasi Gagal")).not.toBeNull());
    expect(onOfflineReady).not.toHaveBeenCalled();
    expect(onSynced).not.toHaveBeenCalled();
  });

  it("manifest ok => lapor versi via onManifestFresh lalu sync normal", async () => {
    getRestaurantManifest.mockResolvedValue(MANIFEST);
    syncManifest.mockResolvedValue({ ok: true, cachedCount: 1, downloadedCount: 0, failedIds: [] });
    const onManifestFresh = vi.fn();
    const onSynced = vi.fn();
    render(
      <SyncDialog
        restaurantId="resto-1"
        tenantToken="tok"
        onManifestFresh={onManifestFresh}
        onSynced={onSynced}
        onSessionInvalid={vi.fn()}
        manifestTimeoutMs={0}
      />,
    );
    await waitFor(() =>
      expect(onManifestFresh).toHaveBeenCalledWith({ version: 12, items: MANIFEST.manifest }),
    );
    await waitFor(() => expect(onSynced).toHaveBeenCalledWith(["table:1"]));
  });
});
```

Catatan executor: `manifestTimeoutMs?: number` default `8000` adalah prop seam baru (pola `sessionRetryMs` Poin 6.1); test mengisi `0`. Timeout diimplementasikan sebagai `Promise.race` antara `getRestaurantManifest(...)` dan penolakan setelah timeout — JANGAN AbortController ke server fn (tidak didukung pola repo).

- [ ] **Step 2.2: Jalankan, pastikan GAGAL dengan alasan benar**

Run: `npx vitest run tests/point-7-sync-offline.test.tsx`
Expected: FAIL — `fallbackSnapshot`/`onOfflineReady`/`onManifestFresh`/`manifestTimeoutMs` bukan props (TypeScript/jsx error atau props diabaikan → timeout/assertion gagal).

- [ ] **Step 2.3: Implementasi di `src/components/SyncDialog.tsx`**

Perubahan minimal, jaga SEMUA state/markup/copy yang ada:
1. Props baru (semua opsional kecuali yang sudah ada): `fallbackSnapshot?: AudioSnapshot | null`, `onOfflineReady?: (snapshot: AudioSnapshot) => void`, `onManifestFresh?: (info: { version: number; items: ManifestItem[] }) => void`, `manifestTimeoutMs?: number` default `8000`. Import type `AudioSnapshot` dari `@/lib/audio-manifest-store`, `ManifestItem` type yang sudah dipakai file ini (cek import type dari restaurants.server — `ManifestItem` diimpor? file ini memakai `res.manifest` tanpa annotasi; tambahkan `import type { ManifestItem } from "@/lib/restaurants.server"` HANYA jika type itu diekspor — verifikasi dulu, kalau tidak ada gunakan `Parameters` infer atau definisikan lokal minimal `{ audioId: string }[]`… JUJUR: cek ekspornya; jangan mengarang).
2. Bungkus `getRestaurantManifest({ data })` dalam race timeout; timeout → perlakukan SAMA seperti catch (network gagal).
3. Setelah manifest OK (sebelum sync): `onManifestFresh?.({ version: res.version, items: res.manifest })` — `version` SUDAH ada di respons (`restaurants.server.ts:74`); JANGAN ubah server.
4. Blok `catch` + cabang `isOfflineResult`: hitung DULU `decideAudioStartup({ snapshot: fallbackSnapshot ?? null, fetched: null })` (import dari store Task 1 — fungsi ini WAJIB dipakai di sini, bukan logika duplikat) → hasil `"offline"` → `reportSyncError("SYNC_OFFLINE", ...)` (dipertahankan), `onOfflineReady(fallbackSnapshot)`, `onSynced(ids snapshot)`; state dialog biarkan selesai diam-diam (parent meng-unmount via audioSynced) — TIDAK tampilkan error. Hasil `"first-ever"` (tanpa snapshot) → perilaku lama persis.
5. Header komentar: tambah paragraf Poin 7 (penentu mode; offline-fallback; pelapor versi).

- [ ] **Step 2.4: Adaptasi `tests/sync-dialog.test.ts` (scan) — minimal**

File ini mem-pin struktur sekarang. Yang BOLEH berubah: test yang mengasumsikan fetch SELALU langsung (tidak ada yang seperti itu — semuanya pin teks/state, aman). Verifikasi tiap needle masih hijau; jika ada yang merah KARENA perubahanmu (mis. teks baru), adaptasi needle-nya dengan JUSTIFIKASI di laporan (bukan hapus). Perkiraan: nol perubahan — tapi BUKTIKAN dengan run.

- [ ] **Step 2.5: GREEN + typecheck + commit**

Run: `npx vitest run tests/point-7-sync-offline.test.tsx tests/sync-dialog.test.ts tests/audio-sync.test.ts` → semua hijau (laporkan per-file).
Run: `npm run typecheck` → 0. `npx eslint src/components/SyncDialog.tsx tests/point-7-sync-offline.test.tsx tests/sync-dialog.test.ts` → 0.
`git add src/components/SyncDialog.tsx tests/point-7-sync-offline.test.tsx tests/sync-dialog.test.ts && git commit -m "feat(poin-7): SyncDialog penentu mode — offline-fallback snapshot + lapor versi"`

---

### Task 3: Wiring SS di `index.tsx` — background sync + Profil + re-probe

**Files:**
- Modify: `src/routes/index.tsx`
- Modify test: `tests/soundboard-sync-wiring.test.ts` (adaptasi needle)

Keadaan yang ditangani (matriks Task 2 + store Task 1):
- first-ever + fetch ok → SyncDialog blocking normal (tidak berubah); sukses → **tulis snapshot** → onSynced seperti sekarang.
- fetch ok + versi SAMA snapshot → tulis snapshot (refresh fetchedAt) → jalan normal, tanpa sync ulang yang terlihat (syncManifest delta tetap jalan di dalam dialog seperti sekarang — TIDAK diubah).
- fetch ok + versi BEDA → SyncDialog sync normal (blocking kali ini saja, karena dialog sudah terbuka — JUJUR: memindahkan sync-pertama-kali-stale ke background butuh dialog non-modal baru; scope dipangkas sadar: dialog yang sudah terbuka menyelesaikan sync-nya, pill hanya untuk sync ULANG berikutnya) → sukses → tulis snapshot baru + toast "Audio diperbarui" HANYA jika versi berubah (bukan tiap login).
- fetch gagal + snapshot → onOfflineReady → `audioSynced=true` + mode offline (badge umur di Profil; tombol sambung-ulang).
- Background sync berikutnya (saat sudah synced): `online` event + tombol Profil "Coba sambung lagi" → cek versi ringan → beda → `syncManifest` langsung (bukan dialog) + pill progres → sukses → snapshot + toast; gagal → pill jadi tombol retry yang gagal saja.

- [ ] **Step 3.1: Tulis test scan + runtime secukupnya**

Scope uji realistis untuk route (route penuh terlalu berat di jsdom): 
(a) Perluas `tests/soundboard-sync-wiring.test.ts` dengan needle perilaku baru (semua `toContain`, pola file ini): SyncDialog menerima `fallbackSnapshot` + `onOfflineReady` + `onManifestFresh`; snapshot ditulis saat sync sukses (`saveAudioSnapshot`); snapshot dihapus saat logout/invalidate (`clearAudioSnapshot`); pill progres dirender (`Sync audio`); Profil menerima extras status audio; listener `online` terpasang. Tulis dulu SEMUA needle baru ini → RUN → FAIL (bukti RED).
(b) Satu test runtime jsdom KECIL untuk helper yang diekstrak: jika executor mengekstrak fungsi murni (mis. `shouldBackgroundSync(snapshotVersion, fetchedVersion)` atau builder pill-label), wajibkan unit test-nya; jika tidak ada ekstraksi, langkah ini dilewati dengan ALASAN tertulis di laporan (bukan placeholder — keputusan sadar).

- [ ] **Step 3.2: Implementasi di `src/routes/index.tsx`**

1. State baru: `audioOffline: boolean`, `audioVersion: number | null`, `audioFetchedAt: number | null`, `bgSync: { current: number; total: number } | null`, `bgFailed: string[]`.
2. Helper `readSnapshot()` = `loadAudioSnapshot(restaurantId)`; berikan sebagai `fallbackSnapshot` ke SyncDialog.
3. `onManifestFresh({version, items})`: simpan `pendingFreshRef = {version, items}` (ref, bukan state — hindari render ganda).
4. `onSynced` existing DIPERTAHANKAN + tambah: tulis snapshot `{restaurantId, catalogVersion: pendingFreshRef.version ?? snapshot?.catalogVersion ?? 0, fetchedAt: Date.now(), items: ids→{audioId, hash:"", size:0}}`… BERHENTI — hash/size kosong merusak validasi store dan delta berikutnya. JUJUR: `onSynced` hanya menerima ids. Sumber hash/size yang benar = `pendingFreshRef.items` (manifest server penuh). Implementasi: snapshot ditulis dari `pendingFreshRef` (cocokkan ids yang sukses — sync sukses penuh = semua items; jika dialog melaporkan sukses, items = manifest penuh). Jika `pendingFreshRef` kosong (kasus offline), snapshot = fallback yang sudah ada (jangan tulis ulang dengan hash kosong). Tulis helper kecil `buildSnapshot(restaurantId, fresh, now)` di `audio-manifest-store.ts`?? ITU scope Task 1 yang sudah commit — tambahkan di Task 3 sebagai fungsi lokal index.tsx SAJA (terlokalisasi, tanpa ubah file Task 1): `function snapshotFromFresh(restaurantId, fresh: {version, items: {audioId, contentHash, byteSize}[]}, now)` → AudioSnapshot. Unit test kecil untuknya di test runtime (b).
5. `onOfflineReady(snapshot)`: `setAudioOffline(true)`, `setAudioVersion/ FetchedAt` dari snapshot, `setAvailableAudioIds(ids snapshot)`, `setAudioSynced(true)`.
6. Toast "Audio diperbarui" (sonner, sudah global): HANYA saat background-sync/stale-sync menaikkan versi (bandingkan versi sebelum vs sesudah), bukan tiap login sukses-versi-sama.
7. Pill: saat `bgSync` → render di baris judul SS (`mb-4 flex...`): `<span role="status">Sync audio {current}/{total}</span>`; saat `bgFailed.length` → tombol "X gagal — ketuk untuk ulangi" → sync ulang hanya ids gagal (pakai manifest terakhir yang diketahui — simpan `lastFreshRef`).
8. Background sync fn `runBackgroundSync(items)`: `syncManifest(restaurantId, items, progress=>setBgSync)` (import dari audio-sync; headers/grant? `syncManifest` butuh `downloadGrant` per item — items dari manifest server SUDAH bawa grant ✓; grant kedaluwarsa antar-sesi? JIKA grant terikat waktu, background-sync lintas sesi bisa 401 → failureReason http → pill retry; TERIMA sebagai batasan jujur, catat di laporan bila terbukti).
9. Tombol Profil "Coba sambung lagi" + baris status: Header menerima extras? VERIFIKASI: `Header.tsx` merender `ProfileMenu` — apakah meneruskan `extras`? Jika belum, tambah prop `profileExtras?: ReactNode` ke Header (perubahan kecil, terkonsentrasi) lalu teruskan ke `ProfileMenu extras`. Baris status: `<p className="truncate ...">v{version} · {formatAudioAge(...)}</p>` + offline variant `"Offline · {age}"`; tombol aksi `"Coba sambung lagi"` → `void recheckVersion()`.
10. `recheckVersion()`: ringan — panggil `getRestaurantManifest` (import sudah ada? index.tsx belum import — tambah import server fn; ini pola yang SAMA seperti komponen lain, bukan pelanggaran) → putuskan via `decideAudioStartup({ snapshot: readSnapshot(), fetched: ok ? { version } : null })` → `"stale"` → `runBackgroundSync(full items)`; `"offline"`/`"current"`/`"first-ever"` → diam total (jangan ganggu crew; pill/Profil tetap).
11. `useEffect online`: `window.addEventListener("online", handler)` → debounce 1 (ref timestamp, abaikan jika <30 dtk dari cek terakhir) → hanya jika `audioSynced && !bgSync` → `recheckVersion()`. Cleanup removeEventListener.
12. Logout + invalidate: tambah `clearAudioSnapshot(restaurantId)` di kedua jalur (cerminkan `clear()` pool yang sudah ada).
13. Komentar: tandai blok Poin 7 singkat.

- [ ] **Step 3.3: GREEN + typecheck + commit**

Run: `npx vitest run tests/soundboard-sync-wiring.test.ts tests/point-7-sync-offline.test.tsx tests/sync-dialog.test.ts` → hijau semua (counts).
`npm run typecheck` → 0. eslint file tersentuh → 0.
`git add src/routes/index.tsx tests/soundboard-sync-wiring.test.ts && git commit -m "feat(poin-7): wiring SS — background sync stale, Profil umur audio, re-probe online"`

---

### Task 4: Guards + evidence ikut-serta + siap PR (TANPA push)

**Files:**
- Create: `tests/point-7-build-guards.test.ts`
- (Docs ikut commit, push HANYA atas perintah pemilik): `docs/operations/evidence/production-point-6-1-crew-password-2026-09-15.md` (untracked — add), evidence Poin 7 ditulis di sini

- [ ] **Step 4.1: Tulis guards**

```ts
// Poin 7 S4: source-scan locks. Offline-first tanpa Service Worker, tanpa
// tabel baru, teks Profil ringkas 1 baris.
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const store = readFileSync("src/lib/audio-manifest-store.ts", "utf8");
const dialog = readFileSync("src/components/SyncDialog.tsx", "utf8");
const route = readFileSync("src/routes/index.tsx", "utf8");

describe("no service worker, no new tables", () => {
  test("tidak ada pendaftaran service worker untuk audio", () => {
    expect(`${store}${dialog}${route}`).not.toMatch(/serviceWorker|navigator\.serviceWorker/i);
  });
  test("tidak ada migration baru Poin 7", () => {
    const files = readFileSync("package.json", "utf8");
    expect(files).not.toMatch(/workbox|idb|localforage|dexie/i);
  });
});

describe("teks Profil ringkas", () => {
  test("format umur kompak dipakai di route", () => {
    expect(route).toContain("formatAudioAge");
  });
  test("baris status memakai truncate (1 baris, tanpa wrap)", () => {
    expect(route).toMatch(/truncate/);
  });
});

describe("mode offline jujur", () => {
  test("dialog melaporkan versi + menyediakan fallback offline", () => {
    expect(dialog).toContain("onManifestFresh");
    expect(dialog).toContain("onOfflineReady");
  });
  test("blocking hanya first-ever (offline + snapshot tidak error)", () => {
    expect(dialog).toContain("fallbackSnapshot");
  });
});
```

- [ ] **Step 4.2: Run → HARUS hijau** (mengunci Task 1–3; merah = regresi, perbaiki di task asal). Commit: `git add tests/point-7-build-guards.test.ts && git commit -m "test(poin-7): source-scan guards offline-tanpa-SW + teks Profil ringkas"`.

- [ ] **Step 4.3: Evidence Poin 6.1 ikut-serta (commit lokal, TANPA push)**

`git add docs/operations/evidence/production-point-6-1-crew-password-2026-09-15.md && git commit -m "docs(poin-6.1): evidence produksi ikut PR Poin 7 (hemat CI)"`. JANGAN push. JANGAN buat PR.

- [ ] **Step 4.4: Tulis evidence Poin 7 (DRAF LOKAL, tanpa push)**

Buat `docs/operations/evidence/production-point-7-audio-offline-2026-09-15.md` berisi: commit list (dari `git log --oneline origin/main..HEAD`), run CI (kosong — "menunggu PR atas perintah pemilik"), pre/post aset (TIDAK ADA migration → tulis eksplisit "nol perubahan DB"), prosedur field test (matikan WiFi → reload → bunyi + umur Profil; update katalog → auto-sync background; tombol sambung-ulang; sesi hidup utuh), rollback (revert deploy; snapshot lokal harmless). Commit lokal. TANPA push.

---

## Risiko yang diterima sadar

- Download grant (`X-Audio-Grant`) mungkin terikat waktu — background-sync lintas sesi bisa gagal `http`; desain gagal-jujur (pill retry), bukan silent. Kalau field test membuktikan grant pendek, tindak lanjut = refresh-grant, BUKAN bagian Poin ini.
- `syncManifest` delta mengandalkan hash cache — jika Cache Storage di-evict browser, verifikasi berikutnya mengunduh ulang penuh (benar, bukan bug).
- Snapshot localStorage per-restaurant: tablet ganti resto tanpa logout → snapshot resto lama tidak dipakai (key per-resto) — benar.
- iOS Safari: localStorage + Cache Storage + fetch cache-bust semua compliant; uji field wajib device asli.

## Checklist diri leader sebelum handoff eksekusi

- [ ] Spec §2 (snapshot) → Task 1; §3 (matriks) → Task 2+3; §4 (UX) → Task 3; §5 (rilis) → Task 4; §6 (tes) → semua task; §7 → eksplisit out.
- [ ] Tidak ada placeholder/TBD di plan.
- [ ] Nama konsisten: `audio-manifest-store.ts`, `fallbackSnapshot`, `onOfflineReady`, `onManifestFresh`, `manifestTimeoutMs`, `decideAudioStartup`, `formatAudioAge`, `lm.audio.manifest.v1`.
- [ ] Perintah bos "tanpa asking" = eksekusi Task 1→4 berurutan TANPA jeda lapor antar-task; "tanpa push/PR" = tidak ada remote write apa pun sampai izin.
