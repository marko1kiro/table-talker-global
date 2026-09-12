// ROUND 6 R6-B: structured revocation verdicts replace the boolean RPC.
// The DB returns REVOKED | ALREADY_INACTIVE | KIND_MISMATCH | UNKNOWN_TOKEN.
// Wrappers accept REVOKED/ALREADY_INACTIVE only; junk, mismatch, malformed
// payloads and transport errors always throw (fail closed).
import { afterEach, describe, expect, it, vi } from "vitest";

type RpcRes = { data: unknown; error: { message: string } | null };
let rpcResponse: RpcRes = { data: { verdict: "REVOKED" }, error: null };
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

const verdict = (v: string): RpcRes => ({ data: { verdict: v }, error: null });

describe("R6-B: structured revocation verdicts", () => {
  afterEach(() => {
    rpcResponse = verdict("REVOKED");
    rpcCalls = [];
  });

  // --- REVOKED: live session, row deleted now ---

  it("staff: REVOKED -> ok (mandatory mode included)", async () => {
    await expect(
      revokeStaffSessionByToken("area_manager", "tok", { requireRevoked: true }),
    ).resolves.toBeUndefined();
    expect(rpcCalls[0]?.fn).toBe("revoke_staff_session_by_token");
  });

  it("manager: REVOKED -> ok", async () => {
    await expect(revokeManagerSessionByToken("tok")).resolves.toBeUndefined();
    expect(rpcCalls[0]?.fn).toBe("revoke_manager_session_by_token");
  });

  // --- ALREADY_INACTIVE: tombstone-proven, idempotent logout OK ---

  it("staff: ALREADY_INACTIVE -> idempotent OK for logout", async () => {
    rpcResponse = verdict("ALREADY_INACTIVE");
    await expect(revokeStaffSessionByToken("area_manager", "tok")).resolves.toBeUndefined();
  });

  it("staff: ALREADY_INACTIVE on mandatory switch THROWS (REVOKE_NOT_REVOKED)", async () => {
    rpcResponse = verdict("ALREADY_INACTIVE");
    await expect(
      revokeStaffSessionByToken("area_manager", "tok", { requireRevoked: true }),
    ).rejects.toThrow("REVOKE_NOT_REVOKED");
  });

  it("manager: ALREADY_INACTIVE -> idempotent OK", async () => {
    rpcResponse = verdict("ALREADY_INACTIVE");
    await expect(revokeManagerSessionByToken("tok")).resolves.toBeUndefined();
  });

  // --- KIND_MISMATCH: token belongs to a different namespace ---

  it("staff: KIND_MISMATCH throws in idempotent mode", async () => {
    rpcResponse = verdict("KIND_MISMATCH");
    await expect(revokeStaffSessionByToken("super_admin", "tok")).rejects.toThrow("KIND_MISMATCH");
  });

  it("manager: KIND_MISMATCH throws in mandatory mode", async () => {
    rpcResponse = verdict("KIND_MISMATCH");
    await expect(revokeManagerSessionByToken("staff-kind-token")).rejects.toThrow("KIND_MISMATCH");
  });

  // --- UNKNOWN_TOKEN: junk/never-issued is NEVER inactive ---

  it("staff: UNKNOWN_TOKEN throws (never treated as inactive)", async () => {
    rpcResponse = verdict("UNKNOWN_TOKEN");
    await expect(revokeStaffSessionByToken("area_manager", "junk")).rejects.toThrow(
      "UNKNOWN_TOKEN",
    );
  });

  it("manager: UNKNOWN_TOKEN throws (never treated as inactive)", async () => {
    rpcResponse = verdict("UNKNOWN_TOKEN");
    await expect(revokeManagerSessionByToken("junk")).rejects.toThrow("UNKNOWN_TOKEN");
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

  // --- MALFORMED: verdict missing or not in the set -> throws ---

  it("staff: malformed response (null/object/string) throws REVOKE_MALFORMED", async () => {
    for (const bad of [null, undefined, { revoked: true }, "true", { verdict: 42 }]) {
      rpcResponse = { data: bad, error: null };
      await expect(revokeStaffSessionByToken("super_admin", "tok")).rejects.toThrow(
        "REVOKE_MALFORMED",
      );
    }
  });

  it("manager: malformed response throws REVOKE_MALFORMED", async () => {
    rpcResponse = { data: { ok: true }, error: null };
    await expect(revokeManagerSessionByToken("tok")).rejects.toThrow("REVOKE_MALFORMED");
  });

  // --- IfLive variants ---

  it("IfLive: REVOKED and ALREADY_INACTIVE proceed", async () => {
    await expect(revokeStaffSessionByTokenIfLive("area_manager", "tok")).resolves.toBeUndefined();
    rpcResponse = verdict("ALREADY_INACTIVE");
    await expect(revokeManagerSessionByTokenIfLive("tok")).resolves.toBeUndefined();
  });

  it("IfLive: KIND_MISMATCH and UNKNOWN_TOKEN throw (no silent skip)", async () => {
    rpcResponse = verdict("KIND_MISMATCH");
    await expect(revokeStaffSessionByTokenIfLive("area_manager", "tok")).rejects.toThrow(
      "KIND_MISMATCH",
    );
    rpcResponse = verdict("UNKNOWN_TOKEN");
    await expect(revokeManagerSessionByTokenIfLive("tok")).rejects.toThrow("UNKNOWN_TOKEN");
  });

  it("IfLive: RPC error throws (fail-open blocked)", async () => {
    rpcResponse = { data: null, error: { message: "timeout" } };
    await expect(revokeStaffSessionByTokenIfLive("area_manager", "tok")).rejects.toThrow(
      "REVOKE_FAILED",
    );
    await expect(revokeManagerSessionByTokenIfLive("tok")).rejects.toThrow("REVOKE_FAILED");
  });
});
