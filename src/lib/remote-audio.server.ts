import { createClient } from "@supabase/supabase-js";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSuperAdmin } from "./auth.server";
import {
  ANNOUNCEMENT_CATALOG,
  COMMAND_TTL_MS,
  TABLE_COUNT,
  getCatalogMetadata,
  sessionIsEligible,
} from "./remote-audio-domain";

type CrewSessionRow = {
  id: string;
  display_name: string;
  device_description: string;
  audio_ready: boolean;
  visibility_state: "visible" | "hidden";
  connection_state: "connected" | "disconnected";
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

type EligibleSession = { id: string; eligible: boolean };

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

function getServiceClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return typeof url === "string" && url && typeof key === "string" && key
    ? createClient(url, key)
    : null;
}

export function validateCommandRequest(
  input: { targetSessionId: string; audioId: string },
  sessions: EligibleSession[],
  availableCatalogIds: readonly string[],
): { error: string } | { targetSessionId: string; audioId: string } {
  if (!uuid.safeParse(input.targetSessionId).success) return { error: "Target crew tidak valid." };
  if (!sessions.some((session) => session.id === input.targetSessionId && session.eligible)) {
    return { error: "Crew tidak sedang siap menerima audio." };
  }
  if (!availableCatalogIds.includes(input.audioId)) return { error: "Audio tidak tersedia." };
  return input;
}

function offline() {
  return { offline: true as const, message: "Realtime offline" };
}

export function buildCommandPayload(targetSessionId: string, audioId: string, now: number) {
  return {
    target_session_id: targetSessionId,
    audio_id: audioId,
    actor: "super-admin",
    created_at: new Date(now).toISOString(),
    expires_at: new Date(now + COMMAND_TTL_MS).toISOString(),
  };
}

function withEligibility(sessions: CrewSessionRow[], now: number) {
  return sessions.map((session) => ({
    ...session,
    eligible: sessionIsEligible(
      {
        audioReady: session.audio_ready,
        connectionState: session.connection_state,
        visibilityState: session.visibility_state,
        lastSeen: session.last_seen,
      },
      now,
    ),
  }));
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
      sessions: withEligibility(sessions, now),
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
      const sessionsResult = await client.from("crew_sessions").select(crewSessionColumns);
      if (sessionsResult.error) return offline();

      const request = validateCommandRequest(
        data,
        withEligibility((sessionsResult.data ?? []) as CrewSessionRow[], Date.now()),
        catalogIds,
      );
      if ("error" in request) return request;

      const { error } = await client
        .from("remote_commands")
        .insert(buildCommandPayload(request.targetSessionId, request.audioId, Date.now()));
      return error ? offline() : { ok: true as const };
    } catch {
      return offline();
    }
  });
