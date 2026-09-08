import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  changeStaffPasswordCore,
  readBootstrapStateCore,
} from "../src/lib/super-admin-auth.server";
import {
  normalizeStaffId,
  staffIdIsValid,
  emailIsValid,
  staffPasswordIsValid,
} from "../src/lib/staff-identity.server";

const schema = readFileSync(
  new URL("../supabase/migrations/20260909010000_staff_identity_schema.sql", import.meta.url),
  "utf8",
);
const rpcs = readFileSync(
  new URL("../supabase/migrations/20260909020000_staff_access_rpcs.sql", import.meta.url),
  "utf8",
);

function fakeHash(pw: string) {
  return `hash(${pw})`;
}

describe("staff ID normalization", () => {
  it("case-insensitive canonical form", () => {
    expect(normalizeStaffId("  BuDi.O_1 ")).toBe("budi.o_1");
    // uppercase input is valid once normalized (the registry compares lower)
    expect(staffIdIsValid("  BUDI _1 ".trim())).toBe(false);
    expect(staffIdIsValid(normalizeStaffId("  BUDI_1 "))).toBe(true);
    expect(staffIdIsValid("budi")).toBe(true);
    expect(staffIdIsValid("ab")).toBe(false);
    expect(staffIdIsValid("a".repeat(33))).toBe(false);
    expect(staffIdIsValid("budi space")).toBe(false);
  });
  it("email + password rules", () => {
    expect(emailIsValid(" Admin@XDIRGA.LABS ")).toBe(true);
    expect(emailIsValid("nope")).toBe(false);
    expect(staffPasswordIsValid("1234567")).toBe(false);
    expect(staffPasswordIsValid("12345678")).toBe(true);
  });
});

describe("bootstrap gate reader", () => {
  it("maps DB state; missing/failed read is null (fail closed)", async () => {
    expect(
      await readBootstrapStateCore(async () => ({
        data: { open: true, individual_count: 0, active_count: 0 },
        error: null,
      })),
    ).toEqual({ open: true, individualCount: 0, activeCount: 0 });
    expect(await readBootstrapStateCore(async () => ({ data: null, error: null }))).toBeNull();
    expect(
      await readBootstrapStateCore(async () => ({ data: null, error: { message: "x" } })),
    ).toBeNull();
  });
});

describe("changeStaffPasswordCore", () => {
  const cred = { password_hash: "hash(lama)", status: "aktif" };
  const rpcWith = (calls: string[], credData: unknown) => async (fn: string) => {
    calls.push(fn);
    if (
      fn === "get_super_admin_credential_by_id" ||
      fn === "get_area_manager_credential_by_id" ||
      fn === "get_manager_credential_by_id"
    ) {
      return { data: credData, error: null };
    }
    return { data: null, error: null };
  };
  it("rejects weak new password before any RPC", async () => {
    const calls: string[] = [];
    const r = await changeStaffPasswordCore("super_admin", "a1", "lama", "short", {
      rpc: async (fn) => {
        calls.push(fn);
        return { data: cred, error: null };
      },
      verify: async () => true,
    });
    expect(r).toEqual({ ok: false, code: "WEAK_PASSWORD" });
    expect(calls).toEqual([]);
  });
  it("rejects wrong old password", async () => {
    const r = await changeStaffPasswordCore("area_manager", "a1", "wrong", "barubaru1", {
      rpc: rpcWith((() => [])(), cred),
      verify: async () => false,
    });
    expect(r).toEqual({ ok: false, code: "INVALID_CREDENTIALS" });
  });
  it("rejects non-active account", async () => {
    const r = await changeStaffPasswordCore("super_admin", "a1", "lama", "barubaru1", {
      rpc: rpcWith((() => [])(), { ...cred, status: "nonaktif" }),
      verify: async () => true,
    });
    expect(r).toEqual({ ok: false, code: "INVALID_CREDENTIALS" });
  });
  it("verifies old then sets new hash and revokes sessions via the RPC", async () => {
    const calls: string[] = [];
    let setParams: Record<string, unknown> | undefined;
    const r = await changeStaffPasswordCore("super_admin", "a1", "lama", "barubaru1", {
      rpc: async (fn, params) => {
        calls.push(fn);
        if (fn === "set_staff_password") {
          setParams = params;
          return { data: null, error: null };
        }
        return { data: cred, error: null };
      },
      verify: async (pw, stored) => stored === fakeHash(pw) || stored === "hash(lama)",
    });
    expect(r.ok).toBe(true);
    expect(calls).toEqual(["get_super_admin_credential_by_id", "set_staff_password"]);
    expect(setParams).toMatchObject({
      p_kind: "super_admin",
      p_account_id: "a1",
      p_password_hash: setParams?.p_password_hash,
    });
    expect(String(setParams?.p_password_hash)).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/);
  });
});

describe("point-2 schema invariants", () => {
  it("single global case-insensitive staff-ID registry, permanent", () => {
    expect(schema).toMatch(/create table public\.staff_id_registry/i);
    expect(schema).toMatch(
      /staff_id text primary key check \(staff_id ~ '\^\[a-z0-9\._-\]\{3,32\}\$'\)/i,
    );
    expect(schema).toMatch(
      /account_kind text not null check \(account_kind in \('super_admin','area_manager','manager'\)\)/i,
    );
  });
  it("manager self-registration RPC is dropped", () => {
    expect(schema).toMatch(
      /drop function if exists public\.register_manager\(text, text, text, text\)/i,
    );
  });
  it("bootstrap gate row exists and is only in this migration", () => {
    expect(schema).toMatch(/insert into public\.system_settings \(key, value\)/i);
    expect(schema).toMatch(/'super_admin_bootstrap', '\{"open": true\}'::jsonb/i);
  });
  it("reset requests allow exactly one pending per account", () => {
    expect(schema).toMatch(/create unique index manager_reset_requests_one_pending_idx/i);
    expect(schema).toMatch(/create unique index am_reset_requests_one_pending_idx/i);
    expect(schema).toMatch(/where status = 'pending'/i);
  });
  it("audit log is append-only even for service_role", () => {
    expect(schema).toMatch(/revoke update, delete on public\.admin_audit_log from service_role/i);
  });
  it("candidate passwords are stored only as scrypt verifier hashes (text), never plaintext", () => {
    expect(schema).toMatch(/candidate_hash text not null/i);
    // Approver list RPCs never project candidate_hash into their results.
    const listPending = rpcs.slice(
      rpcs.indexOf("list_pending_manager_resets"),
      rpcs.indexOf("list_pending_am_resets"),
    );
    expect(listPending).not.toMatch(/candidate_hash/i);
  });
});

describe("point-2 RPC invariants", () => {
  it("every privileged function pins search_path", () => {
    const fnCount = (rpcs.match(/create or replace function public\./g) ?? []).length;
    const pinCount = (rpcs.match(/set search_path = public/g) ?? []).length;
    expect(fnCount).toBeGreaterThan(30);
    // normalize_staff_id / staff_id_is_valid are pure helpers with no
    // catalog access; every security-definer function pins the path.
    expect(pinCount).toBe(fnCount - 2);
    expect(rpcs).toMatch(/language sql\nstable\nas \$\$ select lower\(trim\(p_raw\)\)/i);
  });
  it("privileged functions are service_role only", () => {
    // No grant to anon/authenticated for the new staff functions.
    expect(rpcs).not.toMatch(
      /grant execute on function [^(]*\b(staff|super_admin|area_manager|manager|admin|am_|assign|revoke|claim|accept|bootstrap|resend|cancel|consume|decide|submit|list_am|list_managers|list_pending|list_restaurants|actor_can|write_admin_audit|update_staff|create_manager|create_area|create_super|get_)[^;]*to (anon|authenticated)/i,
    );
  });
  it("first decision wins on manager reset approvals", () => {
    expect(rpcs).toMatch(
      /update public\.manager_reset_requests[\s\S]*?where id = p_request_id and status = 'pending'/i,
    );
    expect(rpcs).toMatch(
      /update public\.am_reset_requests[\s\S]*?where id = p_request_id and status = 'pending'/i,
    );
  });
  it("Super Admin cannot approve Manager resets", () => {
    expect(rpcs).toMatch(
      /if p_decider_kind <> 'area_manager' then raise exception 'NOT_AUTHORIZED'/i,
    );
  });
  it("last active AM / last active Super Admin guards raise", () => {
    expect(rpcs).toMatch(/raise exception 'LAST_ACTIVE_AREA_MANAGER'/i);
    expect(rpcs).toMatch(/raise exception 'LAST_ACTIVE_SUPER_ADMIN'/i);
    // guards appear in: assignment revoke, AM deactivation, and their audit
    // reasons — the exception must be raised from BOTH revoke and deactivate
    // paths (>= 2 raise sites for the AM guard).
    expect((rpcs.match(/raise exception 'LAST_ACTIVE_AREA_MANAGER'/gi) ?? []).length).toBe(2);
    expect((rpcs.match(/last active area manager/gi) ?? []).length).toBeGreaterThanOrEqual(2);
  });
  it("invitation tokens are verified server-side as sha256 and expire", () => {
    expect(rpcs).toMatch(
      /invitation_token_hash = encode\(extensions\.digest\(p_token, 'sha256'\), 'hex'\)/i,
    );
    expect(rpcs).toMatch(/invitation_expires_at <= now\(\)/i);
  });
  it("bootstrap cannot be reopened: accept closes the gate one-way", () => {
    expect(rpcs).toMatch(/set value = '\{"open": false\}'::jsonb/i);
    expect(rpcs).toMatch(/where key = 'super_admin_bootstrap' and value->>'open' = 'true'/i);
    expect(rpcs).not.toMatch(/'\{"open": true\}'::jsonb/i);
  });
  it("session revocation covers all devices on deactivation and password change", () => {
    expect(rpcs).toMatch(/delete from public\.staff_sessions/i);
    expect(rpcs).toMatch(/delete from public\.manager_sessions/i);
    // set_staff_password revokes before returning
    const setPw = rpcs.slice(
      rpcs.indexOf("set_staff_password"),
      rpcs.indexOf("Area Manager: assignments"),
    );
    expect(setPw).toMatch(/perform public\.revoke_staff_sessions\(p_kind, p_account_id\)/i);
    expect(setPw).toMatch(/perform public\.revoke_manager_sessions\(p_account_id\)/i);
  });
});
