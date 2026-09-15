import { describe, expect, it, vi } from "vitest";
import { amEnsureCarrierCore } from "../src/lib/area-manager.server";

describe("amEnsureCarrierCore", () => {
  it("null bearer -> INVALID_SESSION tanpa panggil mint", async () => {
    const mint = vi.fn();
    const result = await amEnsureCarrierCore({ bearer: null }, { mint });
    expect(result).toMatchObject({ ok: false, code: "INVALID_SESSION" });
    expect(mint).not.toHaveBeenCalled();
  });

  it("mint ok -> teruskan carrierEmail+carrierPassword", async () => {
    const ok = { ok: true as const, carrierEmail: "a@b.c", carrierPassword: "p" };
    const mint = vi.fn(async () => ok);
    const result = await amEnsureCarrierCore({ bearer: "t".repeat(64) }, { mint });
    expect(result).toEqual(ok);
    expect(mint).toHaveBeenCalledOnce();
  });

  it("mint gagal -> teruskan code-nya", async () => {
    const fail = { ok: false as const, code: "UNAVAILABLE" as const, message: "x" };
    const mint = vi.fn(async () => fail);
    const result = await amEnsureCarrierCore({ bearer: "t".repeat(64) }, { mint });
    expect(result).toEqual(fail);
  });
});
