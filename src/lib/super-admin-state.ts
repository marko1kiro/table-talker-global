import type { AudioId } from "./remote-audio-domain";

export type RemoteTarget = {
  id: string;
  state: "online" | "recent";
  eligible: boolean;
  audioReady: boolean;
};

export type RemoteSelectionState = {
  offline: boolean;
  target: RemoteTarget | undefined;
  pending: boolean;
};

export function getSelectedRemoteTarget(
  targetSessionId: string,
  sessions: readonly RemoteTarget[],
): RemoteTarget | undefined {
  return sessions.find(
    (session) =>
      session.id === targetSessionId &&
      session.state === "online" &&
      session.eligible &&
      session.audioReady,
  );
}

export function canSelectRemoteAudio({ offline, target, pending }: RemoteSelectionState) {
  return !offline && Boolean(target) && !pending;
}

export function remoteCommandRequest(target: RemoteTarget | undefined, audioId: AudioId) {
  return target && { targetSessionId: target.id, audioId };
}

export function reconcileRemoteSelection(
  targetSessionId: string,
  sessions: readonly RemoteTarget[],
) {
  return getSelectedRemoteTarget(targetSessionId, sessions) ? targetSessionId : "";
}

export function commandStatus(
  command: { status: "sent" | "played" | "failed" | "expired"; expires_at: string },
  now: number,
) {
  return command.status === "sent" && Date.parse(command.expires_at) <= now
    ? "expired"
    : command.status;
}
