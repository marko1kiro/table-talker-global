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

import {
  ANNOUNCEMENT_CATALOG,
  TABLE_AUDIO_IDS,
  TABLE_COUNT,
  getCatalogMetadata,
  type AnnouncementId,
  type AudioId,
} from "./remote-audio-domain";

export { TABLE_COUNT } from "./remote-audio-domain";

export const ANNOUNCEMENT_IDS = ANNOUNCEMENT_CATALOG.map(
  ({ id }) => id,
) as readonly AnnouncementId[];

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
  const result = Object.fromEntries(ANNOUNCEMENT_CATALOG.map(({ id }) => [id, null])) as Record<
    AnnouncementId,
    string | null
  >;
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

export type CatalogAudio = { id: AudioId; label: string; url: string };

export const bundledAudioCatalog: readonly CatalogAudio[] = [
  ...ANNOUNCEMENT_CATALOG.flatMap((announcement) => {
    const url = announcementAudioUrls[announcement.id];
    return url
      ? [{ id: `announcement:${announcement.id}` as AudioId, label: announcement.label, url }]
      : [];
  }),
  ...TABLE_AUDIO_IDS.flatMap((id) => {
    const tableNumber = Number(id.slice("table:".length));
    const url = tableAudioUrls.get(tableNumber);
    const metadata = getCatalogMetadata(id);
    return url && metadata ? [{ ...metadata, url }] : [];
  }),
];

export function getTableAudioUrl(tableNumber: number): string | null {
  return tableAudioUrls.get(tableNumber) ?? null;
}

export function getBundledAudioUrl(audioId: AudioId): string | null {
  return bundledAudioCatalog.find((audio) => audio.id === audioId)?.url ?? null;
}

export function getUnlockAudioUrl(): string | null {
  return bundledAudioCatalog[0]?.url ?? null;
}

type PlaybackAudio = Pick<
  HTMLAudioElement,
  | "muted"
  | "volume"
  | "currentTime"
  | "src"
  | "play"
  | "pause"
  | "addEventListener"
  | "removeEventListener"
>;

function abortError() {
  return Object.assign(new Error("Audio playback aborted."), { name: "AbortError" });
}

export function createPlaybackGeneration() {
  let current = 0;
  return {
    next: () => ++current,
    isCurrent: (token: number) => token === current,
  };
}

export function runIfPlaybackCurrent(
  generation: ReturnType<typeof createPlaybackGeneration>,
  token: number,
  effect: () => void,
) {
  if (generation.isCurrent(token)) effect();
}

export function createAudioPlaybackController(
  audio: PlaybackAudio,
  onPlaybackEnded?: (token: number) => void,
) {
  let settle: ((error?: Error) => void) | null = null;
  let cleanup: (() => void) | null = null;
  let endedListener: (() => void) | null = null;
  const stop = () => {
    cleanup?.();
    cleanup = null;
    if (endedListener) audio.removeEventListener("ended", endedListener);
    endedListener = null;
    const pending = settle;
    settle = null;
    audio.pause();
    audio.currentTime = 0;
    audio.src = "";
    pending?.(abortError());
  };
  return {
    stop,
    play(url: string, token: number) {
      stop();
      audio.src = url;
      return new Promise<void>((resolve, reject) => {
        const onEnded = () => {
          endedListener = null;
          stop();
          onPlaybackEnded?.(token);
        };
        const finish = (error?: Error) => {
          cleanup?.();
          cleanup = null;
          settle = null;
          if (error) reject(error);
          else resolve();
        };
        const onPlaying = () => finish();
        const onError = () => {
          finish(new Error("Audio playback error"));
          stop();
        };
        cleanup = () => {
          audio.removeEventListener("playing", onPlaying);
          audio.removeEventListener("error", onError);
        };
        endedListener = onEnded;
        settle = finish;
        audio.addEventListener("playing", onPlaying, { once: true });
        audio.addEventListener("error", onError, { once: true });
        audio.addEventListener("ended", onEnded, { once: true });
        void audio
          .play()
          .catch((error) =>
            finish(error instanceof Error ? error : new Error("Audio playback error")),
          );
      });
    },
  };
}

export async function unlockBundledAudio(
  audio: PlaybackAudio,
  url: string | null,
): Promise<boolean> {
  if (!url) return false;
  const muted = audio.muted;
  const volume = audio.volume;
  audio.src = url;
  audio.muted = true;
  audio.volume = 0;
  const playback = audio.play();
  try {
    await playback;
    return true;
  } catch {
    return false;
  } finally {
    audio.pause();
    audio.currentTime = 0;
    audio.src = "";
    audio.muted = muted;
    audio.volume = volume;
  }
}
