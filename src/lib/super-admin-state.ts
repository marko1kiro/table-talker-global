export type RemotePlayState = {
  offline: boolean;
  targetSessionId: string;
  audioId: string;
  pending: boolean;
};

export function canPlayRemoteAudio({
  offline,
  targetSessionId,
  audioId,
  pending,
}: RemotePlayState) {
  return !offline && Boolean(targetSessionId) && Boolean(audioId) && !pending;
}

export function reconcileRemoteSelection(
  targetSessionId: string,
  audioId: string,
  sessions: readonly { id: string; eligible: boolean; audioReady: boolean }[],
  catalogIds: readonly string[],
) {
  return {
    targetSessionId: sessions.some(
      (session) => session.id === targetSessionId && session.eligible && session.audioReady,
    )
      ? targetSessionId
      : "",
    audioId: catalogIds.includes(audioId) ? audioId : "",
  };
}

export function commandStatus(
  command: { status: "sent" | "played" | "failed" | "expired"; expires_at: string },
  now: number,
) {
  return command.status === "sent" && Date.parse(command.expires_at) <= now
    ? "expired"
    : command.status;
}
