import { describe, expect, it, vi } from "vitest";
import { createOwnerRetentionHandler } from "../supabase/functions/owner-retention/handler";

const config = { url: "https://project.supabase.co", serviceRoleKey: "secret" };

function handler(runOwnerRetention = vi.fn().mockResolvedValue({ data: { deleted: 3 } })) {
  return createOwnerRetentionHandler({ config, runOwnerRetention });
}

describe("owner retention handler", () => {
  it("rejects non-POST requests", async () => {
    const runOwnerRetention = vi.fn();
    const response = await handler(runOwnerRetention)(
      new Request("https://example.test", { method: "GET" }),
    );

    expect(response.status).toBe(405);
    expect(runOwnerRetention).not.toHaveBeenCalled();
  });

  it.each([
    [{ url: "", serviceRoleKey: "secret" }, "Bearer secret"],
    [{ url: config.url, serviceRoleKey: "" }, "Bearer secret"],
    [config, null],
    [config, "Bearer wrong"],
  ])(
    "returns generic 401 for unavailable or invalid credentials",
    async (handlerConfig, authorization) => {
      const runOwnerRetention = vi.fn();
      const response = await createOwnerRetentionHandler({
        config: handlerConfig,
        runOwnerRetention,
      })(
        new Request("https://example.test", {
          method: "POST",
          headers: authorization ? { authorization } : undefined,
        }),
      );

      expect(response.status).toBe(401);
      expect(await response.text()).toBe("unauthorized");
      expect(runOwnerRetention).not.toHaveBeenCalled();
    },
  );

  it("maps RPC errors to generic 500", async () => {
    const response = await handler(
      vi.fn().mockResolvedValue({ error: new Error("database detail") }),
    )(
      new Request("https://example.test", {
        method: "POST",
        headers: { authorization: "Bearer secret" },
      }),
    );

    expect(response.status).toBe(500);
    expect(await response.text()).toBe("cleanup failed");
  });

  it("maps an RPC error returned after deadline abort to 504", async () => {
    vi.useFakeTimers();
    try {
      const runOwnerRetention = vi.fn(
        (signal: AbortSignal) =>
          new Promise((resolve) => {
            signal.addEventListener("abort", () =>
              resolve({ error: { message: "AbortError: request aborted" } }),
            );
          }),
      );
      const responsePromise = handler(runOwnerRetention)(
        new Request("https://example.test", {
          method: "POST",
          headers: { authorization: "Bearer secret" },
        }),
      );

      await vi.waitFor(() => expect(runOwnerRetention).toHaveBeenCalledOnce());
      const response = await vi.advanceTimersByTimeAsync(8_000).then(() => responsePromise);

      expect(response.status).toBe(504);
      expect(runOwnerRetention).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("maps thrown RPC failures to generic 500", async () => {
    const response = await handler(vi.fn().mockRejectedValue(new Error("database detail")))(
      new Request("https://example.test", {
        method: "POST",
        headers: { authorization: "Bearer secret" },
      }),
    );

    expect(response.status).toBe(500);
    expect(await response.text()).toBe("cleanup failed");
  });

  it("maps deadline abort to 504", async () => {
    vi.useFakeTimers();
    try {
      const runOwnerRetention = vi.fn(
        (signal: AbortSignal) =>
          new Promise((_, reject) => {
            signal.addEventListener("abort", () =>
              reject(new DOMException("deadline", "AbortError")),
            );
          }),
      );
      const responsePromise = handler(runOwnerRetention)(
        new Request("https://example.test", {
          method: "POST",
          headers: { authorization: "Bearer secret" },
        }),
      );

      await vi.waitFor(() => expect(runOwnerRetention).toHaveBeenCalledOnce());
      const response = await vi.advanceTimersByTimeAsync(8_000).then(() => responsePromise);

      expect(response.status).toBe(504);
      expect(runOwnerRetention).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns no-store JSON after one successful wrapper call", async () => {
    const runOwnerRetention = vi.fn().mockResolvedValue({ data: { deleted: 3 } });
    const response = await handler(runOwnerRetention)(
      new Request("https://example.test", {
        method: "POST",
        headers: { authorization: "Bearer secret" },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ deleted: 3 });
    expect(runOwnerRetention).toHaveBeenCalledOnce();
    expect(runOwnerRetention.mock.calls[0][0]).toBeInstanceOf(AbortSignal);
  });

  it("uses injected digest comparison for valid authorization", async () => {
    const digest = vi.fn(async (value: string) => new TextEncoder().encode(value));
    const runOwnerRetention = vi.fn().mockResolvedValue({ data: { deleted: 3 } });
    const response = await createOwnerRetentionHandler({ config, digest, runOwnerRetention })(
      new Request("https://example.test", {
        method: "POST",
        headers: { authorization: "Bearer secret" },
      }),
    );

    expect(response.status).toBe(200);
    expect(digest).toHaveBeenCalledTimes(2);
  });

  it("uses deterministic fallback when no digest is available", async () => {
    const runOwnerRetention = vi.fn().mockResolvedValue({ data: { deleted: 3 } });
    const response = await createOwnerRetentionHandler({ config, digest: null, runOwnerRetention })(
      new Request("https://example.test", {
        method: "POST",
        headers: { authorization: "Bearer secret" },
      }),
    );

    expect(response.status).toBe(200);
    expect(runOwnerRetention).toHaveBeenCalledOnce();
  });
});
