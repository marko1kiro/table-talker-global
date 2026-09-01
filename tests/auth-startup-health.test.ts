import { afterEach, describe, expect, it, vi } from "vitest";

const VALID_AUTH_SECRET = "a".repeat(32);

async function importFreshServer() {
  vi.resetModules();
  return import("../src/server");
}

async function runFreshStartupPlugin() {
  vi.resetModules();
  const plugin = (await import("../src/plugins/auth-startup")).default;
  plugin();
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("AUTH_SECRET startup validation", () => {
  it.each([undefined, "too-short"])(
    "fails during production server startup when AUTH_SECRET is %s",
    async (authSecret) => {
      vi.stubEnv("NODE_ENV", "production");
      if (authSecret === undefined) {
        vi.stubEnv("AUTH_SECRET", undefined);
      } else {
        vi.stubEnv("AUTH_SECRET", authSecret);
      }

      await expect(runFreshStartupPlugin()).rejects.toThrow(/AUTH_SECRET/);
    },
  );
});

describe("GET /api/health auth configuration", () => {
  it("returns 503 without exposing configuration details when auth becomes invalid", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SECRET", VALID_AUTH_SECRET);
    const server = (await importFreshServer()).default;

    vi.stubEnv("AUTH_SECRET", "too-short");
    const response = await server.fetch(
      new Request("https://lime.example/api/health"),
      undefined,
      undefined,
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ ok: false, error: "SERVER_MISCONFIGURED" });
  });

  it("returns 200 when auth configuration is valid", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_SECRET", VALID_AUTH_SECRET);
    const server = (await importFreshServer()).default;

    const response = await server.fetch(
      new Request("https://lime.example/api/health"),
      undefined,
      undefined,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ ok: true });
  });
});
