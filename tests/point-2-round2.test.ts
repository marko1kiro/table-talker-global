// Behaviour proofs for the Poin 2 ROUND 2 review fixes at the Node layer
// (the DB integration suite proves the RPC side). Real logic with injected
// deps — no regex-over-source except the explicit route contracts.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readRpcVerdict } from "../src/lib/rpc-contract.server";
import { staffAppOrigin, StaffEmailConfigError } from "../src/lib/staff-email.server";
import { superAdminLoginCore } from "../src/lib/auth";
import { loginStaffCore } from "../src/lib/staff-login.server";
import { amStatusCore } from "../src/lib/area-manager.server";
import {
  bootstrapCreateSuperAdminCore,
  renameStaffProfileCore,
  requestSuperAdminRecoveryCore,
} from "../src/lib/super-admin-auth.server";

type RpcRes = { data: unknown; error: { message: string } | null };
const ok = (data: unknown): RpcRes => ({ data, error: null });

describe("jsonb verdict contract reader (review B8 call-site mapping)", () => {
  it("maps transport error, malformed payload, ok:false code, and ok:true id", () => {
    expect(readRpcVerdict(null, { message: "boom" })).toEqual({ ok: false, code: "UNAVAILABLE" });
    expect(readRpcVerdict("not-an-object", null)).toEqual({ ok: false, code: "UNAVAILABLE" });
    expect(readRpcVerdict({ ok: false, error: "LAST_ACTIVE_SUPER_ADMIN" }, null)).toEqual({
      ok: false,
      code: "LAST_ACTIVE_SUPER_ADMIN",
    });
    expect(readRpcVerdict({ ok: true, id: "u1" }, null)).toEqual({ ok: true, id: "u1" });
  });
});

describe("magic-link origin is absolute HTTPS, fail-closed (review B7)", () => {
  const saved = { ...process.env };
  function restore() {
    process.env = { ...saved };
  }
  it("production accepts a valid https origin", () => {
    process.env.NODE_ENV = "production";
    process.env.STAFF_EMAIL_APP_URL = "https://app.lime.test/";
    expect(staffAppOrigin()).toBe("https://app.lime.test");
    restore();
  });
  it("production rejects a configured http origin", () => {
    process.env.NODE_ENV = "production";
    process.env.STAFF_EMAIL_APP_URL = "http://app.lime.test";
    expect(() => staffAppOrigin()).toThrow(StaffEmailConfigError);
    restore();
  });
  it("rejects malformed or relative configured values", () => {
    process.env.NODE_ENV = "production";
    for (const bad of ["app.example.com/x", "/relative/path", "://nope", "javascript:alert(1)"]) {
      process.env.STAFF_EMAIL_APP_URL = bad;
      expect(() => staffAppOrigin(), bad).toThrow(StaffEmailConfigError);
    }
    restore();
  });
  it("production NEVER falls back to the request origin (review R3-B)", () => {
    delete process.env.STAFF_EMAIL_APP_URL;
    process.env.NODE_ENV = "production";
    expect(() => staffAppOrigin("https://req.lime.test")).toThrow(StaffEmailConfigError);
    expect(() => staffAppOrigin("http://insecure.lime.test")).toThrow(StaffEmailConfigError);
    process.env.NODE_ENV = "development";
    expect(staffAppOrigin("http://localhost:3000")).toBe("http://localhost:3000");
    restore();
  });
  it("no origin at all fails closed", () => {
    delete process.env.STAFF_EMAIL_APP_URL;
    process.env.NODE_ENV = "development";
    expect(() => staffAppOrigin("")).toThrow(StaffEmailConfigError);
    restore();
  });
  it("a link-config failure aborts BEFORE email and before any persistence", async () => {
    let emailed = false;
    let rpcCalled = false;
    const result = await bootstrapCreateSuperAdminCore(
      { staffId: "sa.ori", fullName: "SA Ori", email: "ori@x.test" },
      {
        linkFor: () => {
          throw new StaffEmailConfigError("bad origin");
        },
        sendEmail: async () => {
          emailed = true;
          return { ok: true };
        },
        rpc: async () => {
          rpcCalled = true;
          return ok(null);
        },
      },
    );
    expect(result).toEqual({ ok: false, code: "EMAIL_CONFIG_INVALID" });
    expect(emailed).toBe(false);
    expect(rpcCalled).toBe(false);
  });
  it("recovery aborts before persisting a token when origin config is broken", async () => {
    let tokenCreated = false;
    const delivered = await requestSuperAdminRecoveryCore("sa@x.test", {
      rpc: async () => {
        tokenCreated = true;
        return ok(null);
      },
      sendEmail: async () => ({ ok: true }),
      linkFor: () => {
        throw new StaffEmailConfigError("bad origin");
      },
      transportConfigured: () => true,
      lookupAccount: async () => ({ id: "acc", staffId: "sa" }),
    });
    expect(delivered).toBe(false);
    expect(tokenCreated).toBe(false);
  });
  it("recovery treats an RPC verdict failure (ok:false) as NOT delivered", async () => {
    const delivered = await requestSuperAdminRecoveryCore("sa@x.test", {
      rpc: async () => ok({ ok: false, error: "NOPE" }),
      sendEmail: async () => ({ ok: true }),
      linkFor: () => "https://app.lime.test/r",
      transportConfigured: () => true,
      lookupAccount: async () => ({ id: "acc", staffId: "sa" }),
    });
    expect(delivered).toBe(false);
  });
});

describe("Super Admin login accounting + cross-role cleanup (reviews B9/A4)", () => {
  const cred = { id: "sa-1", status: "aktif", password_hash: "salt:hash" };
  const base = {
    verify: async (_pw: string, stored: string) => stored === "salt:hash",
    legacyPassword: "legacy-secret",
  };
  it("individual: report(true) only after credentials, session mint, AND cookie all succeeded", async () => {
    const reports: boolean[] = [];
    const updates: Record<string, unknown>[] = [];
    const result = await superAdminLoginCore(
      { mode: "individual", staffId: "Sa.Utama", password: "x" },
      {
        ...base,
        rpc: async (fn) => {
          if (fn === "get_super_admin_credential") return ok(cred);
          if (fn === "create_staff_session") return ok("tok-1");
          return ok(null);
        },
        report: async (v) => {
          reports.push(v);
          return true;
        },
        updateSession: async (u) => {
          updates.push(u as Record<string, unknown>);
        },
      },
    );
    expect(result.ok).toBe(true);
    expect(reports).toEqual([true]);
    // A4: the SA login strips every other staff role from the cookie.
    expect(updates[0]).toMatchObject({
      superAdmin: true,
      superAdminAccountId: "sa-1",
      superAdminSessionToken: "tok-1",
    });
    expect(
      "areaManagerAccountId" in updates[0] && updates[0].areaManagerAccountId === undefined,
    ).toBe(true);
    expect("areaManagerSessionToken" in updates[0]).toBe(true);
  });
  it("individual: a session-mint failure is reported as FAILURE, never success", async () => {
    const reports: boolean[] = [];
    const result = await superAdminLoginCore(
      { mode: "individual", staffId: "sa.utama", password: "x" },
      {
        ...base,
        rpc: async (fn) => {
          if (fn === "get_super_admin_credential") return ok(cred);
          return { data: null, error: { message: "ACCOUNT_NOT_ACTIVE" } };
        },
        report: async (v) => {
          reports.push(v);
          return true;
        },
        updateSession: async () => undefined,
      },
    );
    expect(result.ok).toBe(false);
    expect(reports).toEqual([false]);
  });
  it("individual: a cookie-write failure is reported as FAILURE", async () => {
    const reports: boolean[] = [];
    const result = await superAdminLoginCore(
      { mode: "individual", staffId: "sa.utama", password: "x" },
      {
        ...base,
        rpc: async (fn) =>
          fn === "get_super_admin_credential"
            ? ok(cred)
            : fn === "create_staff_session"
              ? ok("tok")
              : ok(null),
        report: async (v) => {
          reports.push(v);
          return true;
        },
        updateSession: async () => {
          throw new Error("cookie write failed");
        },
      },
    );
    expect(result.ok).toBe(false);
    expect(reports).toEqual([false]);
  });
  it("legacy: success requires an OPEN bootstrap gate and reports only after state is set", async () => {
    const reports: boolean[] = [];
    const closed = await superAdminLoginCore(
      { mode: "legacy", password: "legacy-secret" },
      {
        ...base,
        rpc: async () => ok({ open: false, active_count: 1 }),
        report: async (v) => {
          reports.push(v);
          return true;
        },
        updateSession: async () => undefined,
      },
    );
    expect(closed.ok).toBe(false);
    expect(reports).toEqual([false]);
    const opened = await superAdminLoginCore(
      { mode: "legacy", password: "legacy-secret" },
      {
        ...base,
        rpc: async () => ok({ open: true, active_count: 0 }),
        report: async (v) => {
          reports.push(v);
          return true;
        },
        updateSession: async () => undefined,
      },
    );
    expect(opened.ok).toBe(true);
    expect(reports).toEqual([false, true]);
  });
  it("legacy: a wrong shared password never reaches the gate RPC", async () => {
    let rpcCalls = 0;
    const reports: boolean[] = [];
    const result = await superAdminLoginCore(
      { mode: "legacy", password: "nope" },
      {
        ...base,
        rpc: async () => {
          rpcCalls += 1;
          return ok({ open: true, active_count: 0 });
        },
        report: async (v) => {
          reports.push(v);
          return true;
        },
        updateSession: async () => undefined,
      },
    );
    expect(result.ok).toBe(false);
    expect(rpcCalls).toBe(0);
    expect(reports).toEqual([false]);
  });
});

describe("staff login clears other roles in a shared browser (review A4)", () => {
  const managerCred = {
    id: "m1",
    password_hash: "salt:hash",
    status: "aktif",
    full_name: "M",
    restaurant_id: "r1",
    restaurant_display_name: "Resto",
    restaurant_code: "R1",
  };
  it("a manager login wipes the previous Super Admin / AM cookie session", async () => {
    let cleared = 0;
    const r = await loginStaffCore("mgr", "pw", {
      rpc: async (fn) => {
        if (fn === "get_manager_credential") return ok(managerCred);
        if (fn === "create_manager_session_pending") return ok(true);
        return { data: null, error: { message: "no am" } };
      },
      verify: async () => true,
      report: async () => "SUCCEEDED",
      rateLimitReservationId: "0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b",
      clearSession: async () => {
        cleared += 1;
      },
    });
    expect(r.ok).toBe(true);
    expect(cleared).toBe(1);
  });
  it("an AM login strips every Super Admin field from the cookie update", async () => {
    const amCred = {
      id: "am-1",
      staff_id: "am.satu",
      password_hash: "salt:hash",
      status: "aktif",
      full_name: "AM",
      password_changed_at: null,
    };
    let update: Record<string, unknown> | null = null;
    const r = await loginStaffCore("am.satu", "pw", {
      rpc: async (fn) => {
        if (fn === "get_manager_credential") return { data: null, error: { message: "x" } };
        if (fn === "get_area_manager_credential") return ok(amCred);
        if (fn === "create_staff_session") return ok("amtok");
        return ok(null);
      },
      verify: async () => true,
      report: async () => "SUCCEEDED",
      updateSession: async (u) => {
        update = u as Record<string, unknown>;
      },
    });
    expect(r.ok).toBe(true);
    expect(update).not.toBeNull();
    expect(update!.areaManagerAccountId).toBe("am-1");
    for (const key of [
      "superAdmin",
      "superAdminAccountId",
      "superAdminSessionToken",
      "superAdminReauthenticatedAt",
      "dashboard",
    ]) {
      expect(key in update!, key).toBe(true);
      expect(update![key], key).toBeUndefined();
    }
  });
});

describe("AM dashboard status is session-authoritative (review C12)", () => {
  it("reports logged-out when the bearer token no longer lives in staff_sessions", async () => {
    const r = await amStatusCore({
      accountId: "am-1",
      sessionToken: "revoked-token",
      sessionAccount: async () => null,
      fetchAccount: async () => ({
        staff_id: "am.satu",
        full_name: "AM",
        password_changed_at: null,
      }),
    });
    expect(r).toEqual({ authenticated: false });
  });
  it("reports logged-out when the token maps to a DIFFERENT account", async () => {
    const r = await amStatusCore({
      accountId: "am-1",
      sessionToken: "tok",
      sessionAccount: async () => "am-other",
      fetchAccount: async () => ({
        staff_id: "am.satu",
        full_name: "AM",
        password_changed_at: null,
      }),
    });
    expect(r).toEqual({ authenticated: false });
  });
  it("authenticates only when token, account, and status all agree", async () => {
    const r = await amStatusCore({
      accountId: "am-1",
      sessionToken: "tok",
      sessionAccount: async () => "am-1",
      fetchAccount: async () => ({
        staff_id: "am.satu",
        full_name: "AM Satu",
        password_changed_at: null,
      }),
    });
    expect(r).toEqual({
      authenticated: true,
      fullName: "AM Satu",
      staffId: "am.satu",
      mustRemindPassword: true,
    });
  });
});

describe("Super Admin renames other staff profiles (review C13)", () => {
  it("maps the durable jsonb verdict to UI codes without throwing", async () => {
    const good = await renameStaffProfileCore(
      {
        actorId: "sa-1",
        targetKind: "area_manager",
        targetId: "am-1",
        fullName: "AM Baru",
      },
      { rpc: async () => ok({ ok: true }) },
    );
    expect(good).toEqual({ ok: true });
    const denied = await renameStaffProfileCore(
      { actorId: "ghost", targetKind: "super_admin", targetId: "sa-9", fullName: "Hijack" },
      { rpc: async () => ok({ ok: false, error: "NOT_AUTHORIZED" }) },
    );
    expect(denied).toEqual({ ok: false, code: "NOT_AUTHORIZED" });
    const missing = await renameStaffProfileCore(
      { actorId: "sa-1", targetKind: "manager", targetId: "m-9", fullName: "Ghost" },
      { rpc: async () => ok({ ok: false, error: "NOT_FOUND" }) },
    );
    expect(missing).toEqual({ ok: false, code: "NOT_FOUND" });
  });
});

describe("recovery route consumes the emailed link (review C11)", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../src/routes/super-admin/recovery.tsx", import.meta.url)),
    "utf8",
  );
  it("validates search params and prefills the reset stage from the link", () => {
    expect(source).toContain("validateSearch");
    expect(source).toContain("staff_id");
    expect(source).toContain("token");
    expect(source).toContain("useSearch");
    // The reset stage must open automatically when both link values exist.
    expect(source).toMatch(/search\.staff_id[\s\S]{0,120}search\.token[\s\S]{0,120}"reset"/);
  });
  it("never logs or persists the token beyond component state", () => {
    expect(source).not.toMatch(/console\.(log|info|debug|warn)\([^)]*token/i);
    expect(source).not.toMatch(/localStorage|sessionStorage/);
  });
});
