import { ANNOUNCEMENT_CATALOG, type AnnouncementId, type AudioId } from "./remote-audio-domain";

export { TABLE_COUNT } from "./remote-audio-domain";

export const ANNOUNCEMENT_IDS = ANNOUNCEMENT_CATALOG.map(
  ({ id }) => id,
) as readonly AnnouncementId[];

export function getBundledAudioUrl(_audioId: AudioId): string | null {
  return null;
}

export function getUnlockAudioUrl(): string | null {
  return "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";
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
