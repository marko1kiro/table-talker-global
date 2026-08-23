import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getServiceClient } from "./remote-audio.server";

const crewAccessSchema = z.object({
  tenantToken: z.string(),
  crewSessionToken: z.string(),
  crewSessionId: z.string().uuid(),
});

async function verifyCrewAccess(data: z.infer<typeof crewAccessSchema>) {
  const client = getServiceClient();
  if (!client) return { ok: false as const };
  try {
    const { verifyActiveTenantSession, verifyCrewSessionToken } = await import(
      /* @vite-ignore */ "./tenant-session.server"
    );
    const tenant = await verifyActiveTenantSession(client, data.tenantToken);
    if (!tenant) return { ok: false as const };
    const crew = await verifyCrewSessionToken(client, data.crewSessionToken, tenant.restaurantId);
    if (!crew || crew.crewSessionId !== data.crewSessionId) return { ok: false as const };
    return { ok: true as const };
  } catch {
    return { ok: false as const };
  }
}

export const validateCrewAccess = createServerFn({ method: "POST" })
  .validator(crewAccessSchema)
  .handler(async ({ data }) => verifyCrewAccess(data));
