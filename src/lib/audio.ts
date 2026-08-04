/**
 * Katalog audio statis.
 *
 * Semua MP3 ikut di-bundle ke dalam deployment lewat pipeline aset Vite, jadi
 * pemutaran audio TIDAK memanggil API atau storage eksternal sama sekali:
 * 0 request ke penyedia storage, 0 kuota yang bisa habis.
 *
 * Vite memberi nama file ber-hash konten (mis. `1-a1b2c3d4.mp3`), sehingga file
 * aman di-cache selamanya oleh browser/CDN dan URL-nya otomatis berganti begitu
 * audionya diperbarui — tidak ada risiko staf mendengar audio versi lama.
 *
 * Cara memperbarui audio: ganti file di `src/assets/audio/**` lalu deploy ulang.
 */

export const TABLE_COUNT = 70;

export type AnnouncementId =
  | "seating"
  | "outside-food"
  | "no-smoking"
  | "larangan-gabung-meja"
  | "jam-buka-resto";

export const ANNOUNCEMENT_IDS = [
  "seating",
  "outside-food",
  "no-smoking",
  "larangan-gabung-meja",
  "jam-buka-resto",
] as const;

const tableModules = import.meta.glob<string>("../assets/audio/tables/*.mp3", {
  eager: true,
  query: "?url",
  import: "default",
});

const announcementModules = import.meta.glob<string>("../assets/audio/announcements/*.mp3", {
  eager: true,
  query: "?url",
  import: "default",
});

/** Ambil nama file tanpa direktori dan tanpa ekstensi `.mp3`. */
function fileStem(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  return base.replace(/\.mp3$/i, "");
}

/** Peta nomor meja -> URL audio yang sudah ikut di-bundle. */
export const tableAudioUrls: ReadonlyMap<number, string> = (() => {
  const map = new Map<number, string>();
  for (const [path, url] of Object.entries(tableModules)) {
    const tableNumber = Number.parseInt(fileStem(path), 10);
    if (Number.isInteger(tableNumber) && tableNumber >= 1 && tableNumber <= TABLE_COUNT) {
      map.set(tableNumber, url);
    }
  }
  return map;
})();

/** Peta id pengumuman -> URL audio. `null` kalau filenya belum ada di repo. */
export const announcementAudioUrls: Readonly<Record<AnnouncementId, string | null>> = (() => {
  const result: Record<AnnouncementId, string | null> = {
    seating: null,
    "outside-food": null,
    "no-smoking": null,
    "larangan-gabung-meja": null,
    "jam-buka-resto": null,
  };
  const valid = new Set<string>(ANNOUNCEMENT_IDS);
  for (const [path, url] of Object.entries(announcementModules)) {
    const stem = fileStem(path);
    if (valid.has(stem)) result[stem as AnnouncementId] = url;
  }
  return result;
})();

/** Nomor meja yang audionya tersedia. Dihitung dari file nyata, bukan diasumsikan 70. */
export const readyTables: ReadonlySet<number> = new Set(
  [...tableAudioUrls.keys()].sort((a, b) => a - b),
);

export function getTableAudioUrl(tableNumber: number): string | null {
  return tableAudioUrls.get(tableNumber) ?? null;
}
