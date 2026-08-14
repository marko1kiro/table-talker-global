import type { AnnouncementId, AudioId } from "./remote-audio-domain";

export function announcementPlaybackId(announcementId: AnnouncementId | string): AudioId {
  return `announcement:${announcementId}` as AudioId;
}

export function announcementPlaybackStatus(
  audioId: AudioId,
  playing: AudioId | number | null,
  loading: AudioId | number | null,
  paused: AudioId | number | null,
) {
  if (playing === audioId) return "playing";
  if (loading === audioId) return "loading";
  return paused === audioId ? "paused" : "idle";
}
