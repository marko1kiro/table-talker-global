// ROUND 5 R5-B: atomic revoke verdict replaces fail-open probe-then-revoke.
// One RPC returns REVOKED | ALREADY_INACTIVE | KIND_MISMATCH | ERROR.
// Mandatory switch only proceeds on REVOKED or ALREADY_INACTIVE.
import { afterEach, describe, expect, it, vi } from "vitest";

type RpcRes = { data: unknown; error: { message: string } | null };
let rpcResponse: RpcRes = { data: true, error: null };
let rpcCalls: Array<{ fn: string; params: Record<string, unknown> }> = [];

vi.mock("../src/lib/remote-audio.server", () => ({
  getServiceClient: () => ({
    rpc: async (fn: string, params: Record<string, unknown>): Promise<RpcRes> => {
      rpcCalls.push({ fn, params });
      return rpcResponse;
    },
  }),
}));

import {
  revokeStaffSessionByTokenIfLive,
  revokeManagerSessionByTokenIfLive,
  revokeStaffSessionByToken,
  revokeManagerSessionByToken,
} from "../src/lib/auth.server";

describe("R5-B: atomic revoke verdict replaces fail-open probe", () => {
  afterEach(() => {
    rpcResponse = { data: true, error: null };
    rpcCalls = [];
  });

  // --- revoke_staff_session_by_token: known-live session -> REVOKED ---

  it("staff: data:true -> session provably revoked (REVOKED)", async () => {
    await expect(
      revokeStaffSessionByToken("area_manager", "tok", { requireRevoked: true }),
    ).resolves.toBeUndefined();
    expect(rpcCalls[0]?.fn).toBe("revoke_staff_session_by_token");
  });

  // --- Already inactive: idempotent success ---

  it("staff: data:false -> already inactive (idempotent OK for logout)", async () => {
    rpcResponse = { data: false, error: null };
    await expect(revokeStaffSessionByToken("area_manager", "tok")).resolves.toBeUndefined();
  });

  it("staff: false on mandatory switch THROWS (REVOKE_NOT_REVOKED)", async () => {
    rpcResponse = { data: false, error: null };
    await expect(
      revokeStaffSessionByToken("area_manager", "tok", { requireRevoked: true }),
    ).rejects.toThrow("REVOKE_NOT_REVOKED");
  });

  // --- KIND_MISMATCH: token belongs to different role ---

  it("staff: false with wrong kind is treated as not-revoked in mandatory mode", async () => {
    // The RPC receives a staff token in the manager namespace → matches nothing → false
    rpcResponse = { data: false, error: null };
    await expect(
      revokeManagerSessionByToken("staff-kind-token", { requireRevoked: true }),
    ).rejects.toThrow("REVOKE_NOT_REVOKED");
  });

  // --- ERROR: transport/RPC error -> throws in both modes ---

  it("staff: RPC error throws (REVOKE_FAILED) in mandatory mode", async () => {
    rpcResponse = { data: null, error: { message: "db down" } };
    await expect(
      revokeStaffSessionByToken("super_admin", "tok", { requireRevoked: true }),
    ).rejects.toThrow("REVOKE_FAILED");
  });

  it("staff: RPC error throws (REVOKE_FAILED) in idempotent mode", async () => {
    rpcResponse = { data: null, error: { message: "db down" } };
    await expect(revokeStaffSessionByToken("super_admin", "tok")).rejects.toThrow("REVOKE_FAILED");
  });

  // --- MALFORMED: response not boolean -> throws ---

  it("staff: malformed response (null/object/string) throws REVOKE_MALFORMED", async () => {
    for (const bad of [null, undefined, { revoked: true }, "true"]) {
      rpcResponse = { data: bad, error: null };
      await expect(revokeStaffSessionByToken("super_admin", "tok")).rejects.toThrow(
        "REVOKE_MALFORMED",
      );
    }
  });

  // --- Manager revoke ---

  it("manager: data:true -> revoked", async () => {
    await expect(revokeManagerSessionByToken("tok")).resolves.toBeUndefined();
    expect(rpcCalls[0]?.fn).toBe("revoke_manager_session_by_token");
  });

  it("manager: data:false -> already inactive (idempotent OK)", async () => {
    rpcResponse = { data: false, error: null };
    await expect(revokeManagerSessionByToken("tok")).resolves.toBeUndefined();
  });

  it("manager: false on mandatory switch THROWS", async () => {
    rpcResponse = { data: false, error: null };
    await expect(revokeManagerSessionByToken("tok", { requireRevoked: true })).rejects.toThrow(
      "REVOKE_NOT_REVOKED",
    );
  });

  it("manager: RPC error throws (REVOKE_FAILED)", async () => {
    rpcResponse = { data: null, error: { message: "rpc down" } };
    await expect(revokeManagerSessionByToken("tok")).rejects.toThrow("REVOKE_FAILED");
  });

  it("manager: malformed response throws REVOKE_MALFORMED", async () => {
    rpcResponse = { data: { ok: true }, error: null };
    await expect(revokeManagerSessionByToken("tok")).rejects.toThrow("REVOKE_MALFORMED");
  });

  // --- FAIL-OPEN prevention: the probe-then-revoke pattern is eliminated ---

  it("unknown/error verdict never treated as inactive (fail-open blocked)", async () => {
    // In the OLD code, staffSessionAccount returning null on RPC error would
    // make staffSessionTokenLive return false, and the wrapper would skip
    // revocation — fail-open. Now: RPC error -> REVOKE_FAILED -> throws.
    rpcResponse = { data: null, error: { message: "timeout" } };
    await expect(revokeStaffSessionByTokenIfLive("area_manager", "tok")).rejects.toThrow(
      "REVOKE_FAILED",
    );
  });

  it("manager: probe failure on IfLive throws (no silent skip)", async () => {
    rpcResponse = { data: null, error: { message: "unavailable" } };
    await expect(revokeManagerSessionByTokenIfLive("tok")).rejects.toThrow("REVOKE_FAILED");
  });
});
