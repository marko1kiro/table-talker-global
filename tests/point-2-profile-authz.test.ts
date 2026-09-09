// R4-E (round 4 review): route/server authorization evidence for the profile
// endpoints. The REAL createServerFn handlers execute with mocked session
// gates: the actor ALWAYS comes from the server session (never client input),
// unauthenticated/stale sessions are refused, and the durable RPC verdict
// codes map 1:1 to the UI contract.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type SessionShape = {
  data: {
    superAdmin?: boolean;
    superAdminAccountId?: string;
    areaManagerAccountId?: string;
    areaManagerSessionToken?: string;
  };
};
const holder = globalThis as {
  __requireSuperAdmin?: (() => Promise<SessionShape>) | undefined;
  __requireAreaManager?: (() => Promise<SessionShape>) | undefined;
};
const rpcCalls: Array<{ fn: string; params: Record<string, unknown> }> = [];
let rpcVerdict: { data: unknown; error: { message: string } | null } = {
  data: { ok: true },
  error: null,
};

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    const builder = {
      validator: () => builder,
      handler: (h: unknown) => h,
    };
    return builder;
  },
}));
vi.mock("../src/lib/auth.server", () => ({
  requireSuperAdmin: () =>
    (
      globalThis as {
        __requireSuperAdmin?: (() => Promise<unknown>) | undefined;
      }
    ).__requireSuperAdmin?.(),
  requireAreaManager: () =>
    (
      globalThis as {
        __requireAreaManager?: (() => Promise<unknown>) | undefined;
      }
    ).__requireAreaManager?.(),
  clearAuthSession: async () => undefined,
}));
vi.mock("../src/lib/remote-audio.server", () => ({
  getServiceClient: () => ({
    rpc: async (fn: string, params: Record<string, unknown>) => {
      rpcCalls.push({ fn, params });
      return rpcVerdict;
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            single: async () => ({ data: { id: "am-uuid-1", staff_id: "am.satu" }, error: null }),
          }),
        }),
      }),
    }),
  }),
}));

import { amRenameManager, updateOwnAmProfile } from "../src/lib/area-manager.server";
import { saRenameStaff, updateOwnSuperAdminProfile } from "../src/lib/super-admin-auth.server";
import { saRenameManager } from "../src/lib/admin-managers.server";

const amSession: SessionShape = {
  data: { areaManagerAccountId: "am-uuid-1", areaManagerSessionToken: "tok" },
};
const saSession: SessionShape = {
  data: { superAdmin: true, superAdminAccountId: "sa-uuid-1" },
};
const saLegacySession: SessionShape = { data: { superAdmin: true } };

describe("R4-E: AM profile endpoints derive the actor from the SESSION", () => {
  beforeEach(() => {
    rpcCalls.length = 0;
    rpcVerdict = { data: { ok: true }, error: null };
    holder.__requireSuperAdmin = async () => saSession;
    holder.__requireAreaManager = async () => amSession;
  });
  afterEach(() => {
    holder.__requireSuperAdmin = undefined;
    holder.__requireAreaManager = undefined;
  });

  it("amRenameManager passes the session actor id, never a client-provided one", async () => {
    const handler = amRenameManager as unknown as (args: { data: unknown }) => Promise<{
      ok: boolean;
      code?: string;
    }>;
    const r = await handler({
      data: { managerId: "mgr-uuid", fullName: "Nama Baru" },
    });
    expect(r).toEqual({ ok: true });
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]?.fn).toBe("update_staff_profile");
    expect(rpcCalls[0]?.params.p_actor_id).toBe("am-uuid-1");
    expect(rpcCalls[0]?.params.p_actor_kind).toBe("area_manager");
  });

  it("STALE AM session (gate rejects) is refused before any RPC fires", async () => {
    holder.__requireAreaManager = async () => {
      throw new Error("UNAUTHORIZED");
    };
    const handler = amRenameManager as unknown as (args: { data: unknown }) => Promise<{
      ok: boolean;
      code?: string;
    }>;
    await expect(handler({ data: { managerId: "mgr", fullName: "X" } })).rejects.toThrow(
      "UNAUTHORIZED",
    );
    expect(rpcCalls).toHaveLength(0);
  });

  it("updateOwnAmProfile targets ONLY the session's own account", async () => {
    const handler = updateOwnAmProfile as unknown as (args: { data: unknown }) => Promise<{
      ok: boolean;
      code?: string;
    }>;
    await handler({ data: { fullName: "Nama Sendiri" } });
    expect(rpcCalls[0]?.params.p_target_id).toBe("am-uuid-1");
    expect(rpcCalls[0]?.params.p_target_kind).toBe("area_manager");
  });

  it("durable RPC denial codes map 1:1 (INVALID_NAME, NOT_FOUND, NOT_AUTHORIZED)", async () => {
    const handler = amRenameManager as unknown as (args: { data: unknown }) => Promise<{
      ok: boolean;
      code?: string;
    }>;
    for (const code of ["INVALID_NAME", "NOT_FOUND", "NOT_AUTHORIZED", "INVALID_TARGET"]) {
      rpcVerdict = { data: { ok: false, error: code }, error: null };
      const r = await handler({ data: { managerId: "mgr", fullName: "X" } });
      expect(r, code).toEqual({ ok: false, code });
    }
  });
});

describe("R4-E: Super Admin profile endpoints require an INDIVIDUAL session", () => {
  beforeEach(() => {
    rpcCalls.length = 0;
    rpcVerdict = { data: { ok: true }, error: null };
    holder.__requireSuperAdmin = async () => saSession;
    holder.__requireAreaManager = async () => amSession;
  });
  afterEach(() => {
    holder.__requireSuperAdmin = undefined;
    holder.__requireAreaManager = undefined;
  });

  it("legacy shared-password session can NEVER rename: INDIVIDUAL_REQUIRED, zero RPCs", async () => {
    holder.__requireSuperAdmin = async () => saLegacySession;
    const handler = saRenameStaff as unknown as (args: { data: unknown }) => Promise<{
      ok: boolean;
      code?: string;
    }>;
    const r = await handler({
      data: { targetKind: "manager", targetId: "mgr-uuid", fullName: "X" },
    });
    expect(r).toEqual({ ok: false, code: "INDIVIDUAL_REQUIRED" });
    expect(rpcCalls).toHaveLength(0);
  });

  it("updateOwnSuperAdminProfile under a legacy session is refused the same way", async () => {
    holder.__requireSuperAdmin = async () => saLegacySession;
    const handler = updateOwnSuperAdminProfile as unknown as (args: { data: unknown }) => Promise<{
      ok: boolean;
      code?: string;
    }>;
    const r = await handler({ data: { fullName: "X" } });
    expect(r).toEqual({ ok: false, code: "INDIVIDUAL_REQUIRED" });
  });

  it("individual SA rename passes the session actor and maps verdict codes", async () => {
    const handler = saRenameManager as unknown as (args: { data: unknown }) => Promise<{
      ok: boolean;
      code?: string;
    }>;
    await handler({ data: { managerId: "mgr-uuid", fullName: "Baru" } });
    expect(rpcCalls[0]?.params.p_actor_id).toBe("sa-uuid-1");
    expect(rpcCalls[0]?.params.p_actor_kind).toBe("super_admin");
    rpcVerdict = { data: { ok: false, error: "INVALID_TARGET" }, error: null };
    const denied = await handler({ data: { managerId: "mgr-uuid", fullName: "Baru" } });
    expect(denied).toEqual({ ok: false, code: "INVALID_TARGET" });
  });
});
