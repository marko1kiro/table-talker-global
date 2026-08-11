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

export function commandStatus(
  command: { status: "sent" | "played" | "failed" | "expired"; expires_at: string },
  now: number,
) {
  return command.status === "sent" && Date.parse(command.expires_at) <= now
    ? "expired"
    : command.status;
}
