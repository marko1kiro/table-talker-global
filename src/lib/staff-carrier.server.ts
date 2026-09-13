// Poin 3 Task 7 (spec §3.3): the Manager/AM browser JWT carrier. The staff
// login itself stays fully on the Poin 2 rails -- this fn only ACCEPTS the
// session bearer those rails already minted, verified through the same
// server-side path the dashboards trust (manager: get_manager_id_by_token on
// manager_sessions, with a manager_pending_sessions fallback because the
// handoff mints the carrier while the bearer is still PENDING; area_manager:
// get_staff_session, the exact helper behind amStatusCore). A never-active
// or expired bearer can therefore never obtain a carrier.
//
// The carrier itself is a shadow GoTrue user (auth_user_id on the account
// row, added by the Poin 3 schema migration) with a rotating password:
// create-once, rotate on EVERY call. updateUserById revokes all previous
// carrier sessions in GoTrue, so the returned {carrierEmail, carrierPassword}
// is only usable by the browser that just asked, for one login window.
// Passwords/tokens are never logged anywhere in this module.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const GENERIC = "Terjadi kesalahan. Coba lagi.";

export const STAFF_KINDS = ["manager", "area_manager"] as const;
export type StaffKind = (typeof STAFF_KINDS)[number];

export type EnsureStaffCarrierResult =
  | { ok: true; carrierEmail: string; carrierPassword: string }
  | { ok: false; code: "INVALID_SESSION" | "UNAVAILABLE"; message: string };

export type StaffCarrierDeps = {
  /** Maps the Poin 2 staff bearer to its account id, or null when invalid. */
  verifySession: (kind: StaffKind, sessionToken: string) => Promise<string | null>;
  readAccount: (
    kind: StaffKind,
    accountId: string,
  ) => Promise<{ status: string; auth_user_id: string | null } | null>;
  storeAuthUserId: (kind: StaffKind, accountId: string, authUserId: string) => Promise<void>;
  createCarrierUser: (input: {
    email: string;
    password: string;
    appMetadata: { kind: StaffKind; account_id: string };
  }) => Promise<string | null>;
  setCarrierPassword: (authUserId: string, password: string) => Promise<boolean>;
  newHex64: () => string;
};

export const CARRIER_EMAIL_DOMAIN = "lihatmeja.com";

export function carrierEmailFor(kind: StaffKind, accountId: string): string {
  const prefix = kind === "manager" ? "m" : "am";
  return `shadow+${prefix}-${accountId}@${CARRIER_EMAIL_DOMAIN}`;
}

// WebCrypto so the bundler never sees node:crypto through a UI import edge.
function defaultNewHex64(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function ensureStaffCarrierCore(
  data: { staffKind: StaffKind; sessionToken: string },
  deps: StaffCarrierDeps,
): Promise<EnsureStaffCarrierResult> {
  try {
    const accountId = await deps.verifySession(data.staffKind, data.sessionToken);
    if (!accountId) return { ok: false, code: "INVALID_SESSION", message: GENERIC };
    const account = await deps.readAccount(data.staffKind, accountId);
    if (!account || account.status !== "aktif") {
      return { ok: false, code: "INVALID_SESSION", message: GENERIC };
    }
    const carrierEmail = carrierEmailFor(data.staffKind, accountId);
    let authUserId = account.auth_user_id;
    if (!authUserId) {
      const created = await deps.createCarrierUser({
        email: carrierEmail,
        password: deps.newHex64(),
        appMetadata: { kind: data.staffKind, account_id: accountId },
      });
      if (!created) return { ok: false, code: "UNAVAILABLE", message: GENERIC };
      await deps.storeAuthUserId(data.staffKind, accountId, created);
      authUserId = created;
    }
    const carrierPassword = deps.newHex64();
    if (!(await deps.setCarrierPassword(authUserId, carrierPassword))) {
      return { ok: false, code: "UNAVAILABLE", message: GENERIC };
    }
    return { ok: true, carrierEmail, carrierPassword };
  } catch {
    return { ok: false, code: "UNAVAILABLE", message: GENERIC };
  }
}

export const ensureStaffCarrierInputSchema = z.object({
  staffKind: z.enum(STAFF_KINDS),
  sessionToken: z.string().min(16).max(512),
});

type ServiceClient = Parameters<typeof buildCarrierDeps>[0];

// Exported for wiring tests: fake-client injection without a real service.
export function buildCarrierDeps(client: {
  rpc: (
    fn: string,
    params: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  from: (table: string) => {
    select: (cols: string) => {
      eq: (
        col: string,
        val: unknown,
      ) => {
        gt: (
          col: string,
          val: unknown,
        ) => { maybeSingle: () => PromiseLike<{ data: unknown; error: unknown }> };
        maybeSingle: () => PromiseLike<{ data: unknown; error: unknown }>;
      };
    };
    update: (payload: Record<string, unknown>) => {
      eq: (col: string, val: unknown) => PromiseLike<{ data: null; error: unknown }>;
    };
  };
  auth: {
    admin: {
      createUser: (
        credentials: Record<string, unknown>,
      ) => PromiseLike<{ data: { user?: { id: string } | null } | null; error: unknown }>;
      updateUserById: (
        uid: string,
        attributes: Record<string, unknown>,
      ) => PromiseLike<{ error: unknown }>;
    };
  };
}): StaffCarrierDeps {
  const ACCOUNT_TABLE: Record<StaffKind, string> = {
    manager: "manager_accounts",
    area_manager: "area_manager_accounts",
  };
  return {
    async verifySession(kind, sessionToken) {
      if (kind === "manager") {
        const { data, error } = await client.rpc("get_manager_id_by_token", {
          p_token: sessionToken,
        });
        if (!error && typeof data === "string" && data) return data;
        // Poin 2 handoff: the bearer is PENDING while the login page mints
        // its carrier. Mirror manager_sessions' hash+expiry check directly.
        const { createHash } = await import("node:crypto");
        const tokenHash = createHash("sha256").update(sessionToken).digest("hex");
        const { data: pending } = await client
          .from("manager_pending_sessions")
          .select("manager_id")
          .eq("token_hash", tokenHash)
          .gt("expires_at", new Date().toISOString())
          .maybeSingle();
        const managerId = (pending as { manager_id?: unknown } | null)?.manager_id;
        return typeof managerId === "string" && managerId ? managerId : null;
      }
      const { data, error } = await client.rpc("get_staff_session", {
        p_kind: "area_manager",
        p_token: sessionToken,
      });
      if (error || typeof data !== "string" || !data) return null;
      return data;
    },
    async readAccount(kind, accountId) {
      const { data } = await client
        .from(ACCOUNT_TABLE[kind])
        .select("status, auth_user_id")
        .eq("id", accountId)
        .maybeSingle();
      return (data as { status: string; auth_user_id: string | null } | null) ?? null;
    },
    async storeAuthUserId(kind, accountId, authUserId) {
      const { error } = await client
        .from(ACCOUNT_TABLE[kind])
        .update({ auth_user_id: authUserId })
        .eq("id", accountId);
      if (error) throw new Error("carrier binding failed");
    },
    async createCarrierUser({ email, password, appMetadata }) {
      const { data, error } = await client.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        app_metadata: appMetadata,
      });
      if (error) return null;
      return data?.user?.id ?? null;
    },
    async setCarrierPassword(authUserId, password) {
      const { error } = await client.auth.admin.updateUserById(authUserId, { password });
      return !error;
    },
    newHex64: defaultNewHex64,
  };
}

export const ensureStaffCarrier = createServerFn({ method: "POST" })
  .validator(ensureStaffCarrierInputSchema)
  .handler(async ({ data }): Promise<EnsureStaffCarrierResult> => {
    const { getServiceClient } = await import("./remote-audio.server");
    const client = getServiceClient();
    if (!client) return { ok: false, code: "UNAVAILABLE", message: GENERIC };
    return ensureStaffCarrierCore(data, buildCarrierDeps(client as unknown as ServiceClient));
  });
