// Poin 6.1 S2: crewLoginMethodCore contract — quota first, verdict second,
// fail-closed everywhere. RPC injected, no network.
import { describe, expect, test, vi } from "vitest";
import { crewLoginMethodCore } from "@/lib/crew-auth.server";

const ok = (data: unknown) => Promise.resolve({ data, error: null });
const boom = (message: string) => Promise.resolve({ data: null, error: { message } });

describe("crewLoginMethodCore", () => {
  test("throttled when the bucket denies the call (no verdict call happens)", async () => {
    const rpc = vi.fn().mockResolvedValueOnce(ok(false));
    const result = await crewLoginMethodCore({ email: "budi@ex.test", ipHash: "h" }, rpc);
    expect(result).toEqual({ ok: false, code: "THROTTLED", message: "Gagal memeriksa akun." });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][0]).toBe("reserve_crew_auth_method");
    expect(rpc.mock.calls[0][1]).toEqual({ p_ip_hash: "h" });
  });

  test("verdict password passes through after quota allows", async () => {
    const rpc = vi.fn().mockResolvedValueOnce(ok(true)).mockResolvedValueOnce(ok("password"));
    await expect(crewLoginMethodCore({ email: "budi@ex.test", ipHash: "h" }, rpc)).resolves.toEqual(
      { ok: true, method: "password" },
    );
    expect(rpc.mock.calls[1]).toEqual(["crew_auth_method", { p_email: "budi@ex.test" }]);
  });

  test("verdict rpc error fail-closes to UNAVAILABLE", async () => {
    const rpc = vi.fn().mockResolvedValueOnce(ok(true)).mockResolvedValueOnce(boom("nope"));
    await expect(crewLoginMethodCore({ email: "b@ex.test", ipHash: "h" }, rpc)).resolves.toEqual({
      ok: false,
      code: "UNAVAILABLE",
      message: "Gagal memeriksa akun.",
    });
  });

  test("quota RPC error fail-closes to UNAVAILABLE (never defaults open)", async () => {
    const rpc = vi.fn().mockResolvedValueOnce(boom("db down"));
    await expect(crewLoginMethodCore({ email: "b@ex.test", ipHash: "h" }, rpc)).resolves.toEqual({
      ok: false,
      code: "UNAVAILABLE",
      message: "Gagal memeriksa akun.",
    });
  });

  test("a verdict outside the two values fail-closes to UNAVAILABLE", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce(ok(true))
      .mockResolvedValueOnce(ok("sesuatu-yang-janggal"));
    await expect(crewLoginMethodCore({ email: "b@ex.test", ipHash: "h" }, rpc)).resolves.toEqual({
      ok: false,
      code: "UNAVAILABLE",
      message: "Gagal memeriksa akun.",
    });
  });
});
