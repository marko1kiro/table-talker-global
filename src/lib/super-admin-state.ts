export type RemoteSelectionState = {
  offline: boolean;
  targetSessionId: string;
  pending: boolean;
};

export function canSelectRemoteAudio({ offline, targetSessionId, pending }: RemoteSelectionState) {
  return !offline && Boolean(targetSessionId) && !pending;
}

export function reconcileRemoteSelection(
  targetSessionId: string,
  sessions: readonly { id: string; eligible: boolean; audioReady: boolean }[],
) {
  return sessions.some(
    (session) => session.id === targetSessionId && session.eligible && session.audioReady,
  )
    ? targetSessionId
    : "";
}

export function commandStatus(
  command: { status: "sent" | "played" | "failed" | "expired"; expires_at: string },
  now: number,
) {
  return command.status === "sent" && Date.parse(command.expires_at) <= now
    ? "expired"
    : command.status;
}
