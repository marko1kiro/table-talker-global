// ROUND 3 failing-first tests (R3-A/B/C). DB-level evidence lives in
// tests/db/staff-access.integration.test.ts; these exercise the extracted
// cores with injected deps — real logic, no regex-over-source.
import { describe, expect, it } from "vitest";
import { superAdminLoginCore } from "../src/lib/auth";
import { loginStaffCore, type StaffLoginDeps } from "../src/lib/staff-login.server";
import { StaffEmailConfigError, staffAppOrigin } from "../src/lib/staff-email.server";

type RpcRes = { data: unknown; error: { message: string } | null };
const ok = (data: unknown): RpcRes => ({ data, error: null });
const err = (message: string): RpcRes => ({ data: null, error: { message } });

// R6-C: the reservation the real route wires into every staff login.
const RESV = "0d0d0d0d-0d0d-4d0d-8d0d-0d0d0d0d0d0d";

const managerCred = {
  id: "m1",
  password_hash: "salt:hash",
  status: "aktif",
  full_name: "M",
  restaurant_id: "r1",
  restaurant_display_name: "Resto",
  restaurant_code: "R1",
};

describe("R3-C: AM login accounting reflects a USABLE session", () => {
  const amCred = {
    id: "am-1",
    staff_id: "am.satu",
    password_hash: "salt:hash",
    status: "aktif",
    full_name: "AM",
    staff_id_lower: undefined,
    password_changed_at: null,
  } as Record<string, unknown>;

  function amDeps(overrides: {
    rpc?: (fn: string) => RpcRes;
    updateSession?: (u: unknown) => Promise<void>;
    report?: StaffLoginDeps["report"];
    verify?: (password: string, stored: string) => Promise<boolean>;
  }) {
    const reports: boolean[] = [];
    return {
      reports,
      deps: {
        rpc: async (fn: string) =>
          overrides.rpc
            ? overrides.rpc(fn)
            : fn === "get_manager_credential"
              ? err("no manager")
              : fn === "get_area_manager_credential"
                ? ok(amCred)
                : fn === "create_staff_session"
                  ? ok("amtok")
                  : ok(null),
        verify: overrides.verify ?? (async () => true),
        report:
          overrides.report ??
          (async (v: boolean) => {
            reports.push(v);
            // R4-C: an authoritative completion returns a success verdict.
            return v ? "SUCCEEDED" : "FAILED";
          }),
        rateLimitReservationId: RESV,
        updateSession: overrides.updateSession ?? (async () => undefined),
      },
    };
  }

  it("full success reports exactly one true, AFTER the cookie write", async () => {
    const order: string[] = [];
    const { deps } = amDeps({
      updateSession: async () => {
        order.push("cookie");
      },
      report: async (v) => {
        order.push(`report:${v}`);
        return v ? "SUCCEEDED" : "FAILED";
      },
    });
    const r = await loginStaffCore("am.satu", "pw", deps);
    expect(r.ok).toBe(true);
    expect(order).toEqual(["cookie", "report:true"]);
  });

  it("cookie write failure: session revoked and the durable failure outcome is banked (R6-C)", async () => {
    const revoked: string[] = [];
    const { reports, deps } = amDeps({
      updateSession: async () => {
        throw new Error("cookie write failed");
      },
    });
    const withRevoke = {
      ...deps,
      revokeStaffSessionByToken: async (kind: string, token: string) => {
        revoked.push(`${kind}:${token}`);
      },
    };
    const r = await loginStaffCore("am.satu", "pw", withRevoke);
    expect(r.ok).toBe(false);
    // R6-C: the cookie-write failure banks a durable FAILURE outcome so a
    // late success reporter can never contradict the DB.
    expect(reports).toEqual([false]);
    expect(revoked).toEqual(["area_manager:amtok"]);
  });

  it("wrong password, inactive account, and session-mint failure each report exactly one false", async () => {
    for (const broken of ["wrongpw", "inactive", "mintfail"] as const) {
      const { reports, deps } = amDeps({
        rpc: (fn) => {
          if (fn === "get_area_manager_credential") {
            if (broken === "inactive") return ok({ ...amCred, status: "nonaktif" });
            return ok(amCred);
          }
          if (fn === "create_staff_session" && broken === "mintfail") return err("boom");
          return broken === "wrongpw"
            ? fn === "get_manager_credential"
              ? err("x")
              : err("x")
            : ok(null);
        },
        verify: async () => broken !== "wrongpw",
      });
      const r = await loginStaffCore("am.satu", "pw", deps);
      expect(r.ok, broken).toBe(false);
      expect(reports, broken).toEqual([false]);
    }
  });

  it("a throwing reporter FAILS THE LOGIN CLOSED (R4-C): no usable session survives", async () => {
    const revoked: string[] = [];
    const { deps } = amDeps({
      report: async () => {
        throw new Error("rate limiter down");
      },
    });
    // Success path with an unconfirmable completion: the just-minted session
    // is revoked and the attempt returns the generic failure.
    const okResult = await loginStaffCore("am.satu", "pw", {
      ...deps,
      revokeStaffSessionByToken: async (kind, token) => {
        revoked.push(`${kind}:${token}`);
      },
    });
    expect(okResult.ok).toBe(false);
    expect(revoked).toEqual(["area_manager:amtok"]);
    const failResult = await loginStaffCore("ghost", "pw", {
      ...deps,
      rpc: async () => err("invalid credentials"),
    });
    expect(failResult.ok).toBe(false);
  });
});

describe("R3-A: role switches revoke the PREVIOUS server sessions", () => {
  it("AM login revokes the cookie-held SA/AM bearer tokens BEFORE minting the new session", async () => {
    const calls: string[] = [];
    let minted = false;
    const r = await loginStaffCore("am.satu", "pw", {
      rpc: async (fn) =>
        fn === "get_manager_credential"
          ? err("no manager")
          : fn === "get_area_manager_credential"
            ? ok({
                id: "am-1",
                staff_id: "am.satu",
                password_hash: "salt:hash",
                status: "aktif",
                full_name: "AM",
                password_changed_at: null,
              })
            : fn === "create_staff_session"
              ? ((minted = true), ok("amtok"))
              : ok(null),
      verify: async () => true,
      report: async () => "SUCCEEDED",
      updateSession: async () => undefined,
      cookieStaffTokens: async () => ({ superAdminToken: "old-sa", areaManagerToken: null }),
      revokeStaffSessionByToken: async (kind, token) => {
        calls.push(`${kind}:${token}`);
      },
      revokeManagerSessionByToken: async (token) => {
        calls.push(`manager:${token}`);
      },
      managerTokenToRevoke: "old-mgr",
    });
    expect(r.ok).toBe(true);
    // old credentials revoked, and the old manager token too
    expect(calls).toEqual(["super_admin:old-sa", "manager:old-mgr"]);
    expect(minted).toBe(true);
  });

  it("a failed OLD-session revocation aborts the switch: no new session is minted", async () => {
    let minted = false;
    const reports: boolean[] = [];
    const r = await loginStaffCore("am.satu", "pw", {
      rpc: async (fn) =>
        fn === "get_manager_credential"
          ? err("no manager")
          : fn === "get_area_manager_credential"
            ? ok({
                id: "am-1",
                staff_id: "am.satu",
                password_hash: "salt:hash",
                status: "aktif",
                full_name: "AM",
                password_changed_at: null,
              })
            : fn === "create_staff_session"
              ? ((minted = true), ok("amtok"))
              : ok(null),
      verify: async () => true,
      report: async (v) => {
        reports.push(v);
        return "FAILED";
      },
      cookieStaffTokens: async () => ({ superAdminToken: "old-sa", areaManagerToken: null }),
      revokeStaffSessionByToken: async () => {
        throw new Error("revocation failed");
      },
    });
    expect(r.ok).toBe(false);
    expect(reports).toEqual([false]);
    expect(minted).toBe(false);
  });

  it("Manager login revokes cookie-held staff sessions and compensates on old-revocation failure", async () => {
    const revoked: string[] = [];
    const r = await loginStaffCore("mgr", "pw", {
      rpc: async (fn) =>
        fn === "get_manager_credential"
          ? ok(managerCred)
          : fn === "create_manager_session_pending"
            ? ok("mtok")
            : err("x"),
      verify: async () => true,
      report: async () => "SUCCEEDED",
      updateSession: async () => undefined,
      rateLimitReservationId: RESV,
      cookieStaffTokens: async () => ({ superAdminToken: "old-sa", areaManagerToken: "old-am" }),
      revokeStaffSessionByToken: async (kind, token) => {
        revoked.push(`${kind}:${token}`);
      },
      revokeManagerSessionByToken: async (token) => {
        revoked.push(`manager:${token}`);
        throw new Error("old manager revoke failed");
      },
      managerTokenToRevoke: "old-mgr",
      clearSession: async () => undefined,
    });
    // old-revocation failed -> the switch fails closed. The freshly minted
    // PENDING session (R6-A) is never delivered to the browser: it is unusable
    // by construction and dies via its 60s TTL — no revocation needed for it.
    expect(r.ok).toBe(false);
    expect(revoked).toEqual(["manager:old-mgr"]);
  });

  it("Super Admin individual login revokes the old AM/manager credentials before minting", async () => {
    const calls: string[] = [];
    const r = await superAdminLoginCore(
      { mode: "individual", staffId: "sa.utama", password: "x" },
      {
        rpc: async (fn) =>
          fn === "get_super_admin_credential"
            ? ok({ id: "sa-1", status: "aktif", password_hash: "salt:hash" })
            : fn === "create_staff_session"
              ? ok("tok-1")
              : ok(null),
        verify: async () => true,
        legacyPassword: "",
        report: async () => true,
        updateSession: async () => undefined,
        cookieStaffTokens: async () => ({ superAdminToken: "old-sa", areaManagerToken: "old-am" }),
        revokeStaffSessionByToken: async (kind, token) => {
          calls.push(`${kind}:${token}`);
        },
        revokeManagerSessionByToken: async (token) => {
          calls.push(`manager:${token}`);
        },
        managerTokenToRevoke: "old-mgr",
      },
    );
    expect(r.ok).toBe(true);
    expect(calls).toEqual(["super_admin:old-sa", "area_manager:old-am", "manager:old-mgr"]);
  });

  it("Super Admin login compensates when the cookie write fails after the session mint", async () => {
    const revoked: string[] = [];
    const reports: boolean[] = [];
    const r = await superAdminLoginCore(
      { mode: "individual", staffId: "sa.utama", password: "x" },
      {
        rpc: async (fn) =>
          fn === "get_super_admin_credential"
            ? ok({ id: "sa-1", status: "aktif", password_hash: "salt:hash" })
            : fn === "create_staff_session"
              ? ok("tok-1")
              : ok(null),
        verify: async () => true,
        legacyPassword: "",
        report: async (v) => {
          reports.push(v);
        },
        updateSession: async () => {
          throw new Error("cookie write failed");
        },
        revokeStaffSessionByToken: async (kind, token) => {
          revoked.push(`${kind}:${token}`);
        },
      },
    );
    expect(r.ok).toBe(false);
    expect(reports).toEqual([false]);
    expect(revoked).toEqual(["super_admin:tok-1"]);
  });
});

describe("R3-B: production magic links REQUIRE an explicit https app URL", () => {
  const saved = { ...process.env };
  function restore() {
    process.env = { ...saved };
  }
  it("production + configured valid https origin proceeds", () => {
    process.env.NODE_ENV = "production";
    process.env.STAFF_EMAIL_APP_URL = "https://app.lime.test/";
    expect(staffAppOrigin()).toBe("https://app.lime.test");
    restore();
  });
  it("production + EMPTY config must NOT fall back to the request origin", () => {
    delete process.env.STAFF_EMAIL_APP_URL;
    process.env.NODE_ENV = "production";
    expect(() => staffAppOrigin("https://req.lime.test")).toThrow(StaffEmailConfigError);
    restore();
  });
  it("production rejects relative, http, malformed, and credential-bearing values", () => {
    process.env.NODE_ENV = "production";
    for (const bad of [
      "app.example.com/x",
      "/relative/path",
      "://nope",
      "javascript:alert(1)",
      "http://app.lime.test",
      "https://user:pass@app.lime.test",
      "   ",
    ]) {
      process.env.STAFF_EMAIL_APP_URL = bad;
      expect(() => staffAppOrigin(), JSON.stringify(bad)).toThrow(StaffEmailConfigError);
    }
    restore();
  });
  it("dev keeps the request-origin fallback; empty explicit value still fails", () => {
    delete process.env.STAFF_EMAIL_APP_URL;
    process.env.NODE_ENV = "development";
    expect(staffAppOrigin("http://localhost:3000")).toBe("http://localhost:3000");
    expect(() => staffAppOrigin("")).toThrow(StaffEmailConfigError);
    restore();
  });
});
