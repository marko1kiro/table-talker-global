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
