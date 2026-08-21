import { createClient } from "@supabase/supabase-js";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSuperAdmin } from "./auth.server";
import {
  ANNOUNCEMENT_CATALOG,
  TABLE_COUNT,
  classifyCrewSession,
  getCatalogMetadata,
  sessionIsEligible,
} from "./remote-audio-domain";
import { CREW_MESSAGE_MAX_LENGTH } from "./crew-message-domain";

type CrewSessionRow = {
  id: string;
  display_name: string;
  device_description: string;
  audio_ready: boolean;
  visibility_state: "visible" | "hidden";
  connection_state: "connecting" | "connected" | "disconnected";
  last_seen: string;
};

type RemoteCommandRow = {
  id: string;
  target_session_id: string;
  audio_id: string;
  actor: string;
  created_at: string;
  expires_at: string;
  status: "sent" | "played" | "failed" | "expired";
  acknowledged_at: string | null;
  failure_reason: string | null;
};

const uuid = z.string().uuid();
export const commandInputSchema = z.object({
  targetSessionId: z.string(),
  audioId: z.string(),
});
const catalogIds = [
  ...Array.from({ length: TABLE_COUNT }, (_, index) => `table:${index + 1}`),
  ...ANNOUNCEMENT_CATALOG.map((announcement) => `announcement:${announcement.id}`),
];
const catalog = catalogIds.flatMap((id) => {
  const metadata = getCatalogMetadata(id);
  return metadata ? [metadata] : [];
});
const crewSessionColumns =
  "id,display_name,device_description,audio_ready,visibility_state,connection_state,last_seen";
const remoteCommandColumns =
  "id,target_session_id,audio_id,actor,created_at,expires_at,status,acknowledged_at,failure_reason";

export function getServiceClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return typeof url === "string" && url && typeof key === "string" && key
    ? createClient(url, key)
    : null;
}

export function validateCommandRequest(
  input: { targetSessionId: string; audioId: string },
  availableCatalogIds: readonly string[],
): { error: string } | { targetSessionId: string; audioId: string } {
  if (!uuid.safeParse(input.targetSessionId).success) return { error: "Target crew tidak valid." };
  if (!availableCatalogIds.includes(input.audioId)) return { error: "Audio tidak tersedia." };
  return input;
}

function offline() {
  return { offline: true as const, message: "Realtime offline" };
}

function withSnapshotState(sessions: CrewSessionRow[], now: number) {
  return sessions.flatMap((session) => {
    const state = classifyCrewSession(
      {
        connectionState: session.connection_state,
        visibilityState: session.visibility_state,
        lastSeen: session.last_seen,
      },
      now,
    );
    if (state === "expired") return [];
    return [
      {
        ...session,
        state,
        eligible:
          state === "online" &&
          sessionIsEligible(
            {
              audioReady: session.audio_ready,
              connectionState: session.connection_state,
              visibilityState: session.visibility_state,
              lastSeen: session.last_seen,
            },
            now,
          ),
      },
    ];
  });
}

export const getRemoteAdminSnapshot = createServerFn({ method: "GET" }).handler(async () => {
  await requireSuperAdmin();
  const client = getServiceClient();
  if (!client) return offline();

  try {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const [sessionsResult, commandsResult] = await Promise.all([
      client.from("crew_sessions").select(crewSessionColumns),
      client.from("remote_commands").select(remoteCommandColumns).gte("created_at", since),
    ]);
    if (sessionsResult.error || commandsResult.error) return offline();

    const now = Date.now();
    const sessions = (sessionsResult.data ?? []) as CrewSessionRow[];
    const commands = (commandsResult.data ?? []) as RemoteCommandRow[];
    return {
      offline: false as const,
      sessions: withSnapshotState(sessions, now),
      commands: commands.map((command) => ({
        ...command,
        status:
          command.status === "sent" && Date.parse(command.expires_at) <= now
            ? "expired"
            : command.status,
      })),
      catalog,
    };
  } catch {
    return offline();
  }
});

export const sendRemoteCommand = createServerFn({ method: "POST" })
  .validator(commandInputSchema)
  .handler(async ({ data }) => {
    await requireSuperAdmin();
    const client = getServiceClient();
    if (!client) return offline();

    try {
      const request = validateCommandRequest(data, catalogIds);
      if ("error" in request) return request;

      const { error } = await client.rpc("create_remote_command", {
        p_target_session_id: request.targetSessionId,
        p_audio_id: request.audioId,
        p_actor: "super-admin",
      });
      if (error?.message.includes("TARGET_NOT_ELIGIBLE")) {
        return { error: "Crew tidak sedang siap menerima audio." };
      }
      return error ? offline() : { ok: true as const };
    } catch {
      return offline();
    }
  });

const crewMessageSchema = z.object({
  targetSessionId: z.string().uuid(),
  message: z.string().min(1).max(CREW_MESSAGE_MAX_LENGTH),
});

export const sendCrewMessage = createServerFn({ method: "POST" })
  .validator(crewMessageSchema)
  .handler(async ({ data }) => {
    await requireSuperAdmin();
    const client = getServiceClient();
    if (!client) return offline();
    try {
      const { error } = await client.rpc("create_crew_message", {
        p_target_session_id: data.targetSessionId,
        p_message: data.message,
        p_expires_in_seconds: 5,
      });
      if (error?.message.includes("MESSAGE_TOO_LONG")) {
        return { error: "Pesan maksimal 200 karakter." };
      }
      return error ? offline() : { ok: true as const };
    } catch {
      return offline();
    }
  });
