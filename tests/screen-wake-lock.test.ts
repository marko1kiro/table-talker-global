import { afterEach, describe, expect, it, vi } from "vitest";
import {
  releaseScreenWakeLock,
  requestScreenWakeLock,
  visibleWakeLockState,
} from "../src/lib/screen-wake-lock";

describe("visibleWakeLockState", () => {
  it("requests when active and no sentinel while visible", () => {
    expect(
      visibleWakeLockState({ active: true, sentinelActive: false, visibility: "visible" }),
    ).toBe("request");
  });

  it("skips re-request when a sentinel is already active", () => {
    expect(
      visibleWakeLockState({ active: true, sentinelActive: true, visibility: "visible" }),
    ).toBe("none");
  });

  it("never requests while the tab is hidden", () => {
    expect(
      visibleWakeLockState({ active: true, sentinelActive: false, visibility: "hidden" }),
    ).toBe("none");
    expect(visibleWakeLockState({ active: true, sentinelActive: true, visibility: "hidden" })).toBe(
      "none",
    );
  });

  it("releases when deactivated and a sentinel exists", () => {
    expect(
      visibleWakeLockState({ active: false, sentinelActive: true, visibility: "visible" }),
    ).toBe("release");
  });

  it("does nothing when deactivated without a sentinel", () => {
    expect(
      visibleWakeLockState({ active: false, sentinelActive: false, visibility: "visible" }),
    ).toBe("none");
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("requestScreenWakeLock", () => {
  it("requests the screen wake lock when supported", async () => {
    const sentinel = { release: vi.fn() };
    const request = vi.fn().mockResolvedValue(sentinel);
    vi.stubGlobal("navigator", { wakeLock: { request } });

    const result = await requestScreenWakeLock();

    expect(request).toHaveBeenCalledWith("screen");
    expect(result).toBe(sentinel);
  });

  it("returns null when the API is unsupported", async () => {
    vi.stubGlobal("navigator", {});

    const result = await requestScreenWakeLock();

    expect(result).toBeNull();
  });

  it("returns null silently when the request is rejected", async () => {
    const request = vi.fn().mockRejectedValue(new Error("denied"));
    vi.stubGlobal("navigator", { wakeLock: { request } });

    const result = await requestScreenWakeLock();

    expect(result).toBeNull();
  });
});

describe("releaseScreenWakeLock", () => {
  it("releases the sentinel", () => {
    const sentinel = { release: vi.fn() };

    releaseScreenWakeLock(sentinel);

    expect(sentinel.release).toHaveBeenCalledOnce();
  });

  it("does nothing for a null sentinel", () => {
    expect(() => releaseScreenWakeLock(null)).not.toThrow();
  });
});

import { readFileSync } from "node:fs";

const indexSource = readFileSync(new URL("../src/routes/index.tsx", import.meta.url), "utf8");

it("activates wake lock in the crew soundboard page", () => {
  expect(indexSource).toContain("useScreenWakeLock(identityHydrated)");
});

const hookSource = readFileSync(
  new URL("../src/hooks/use-screen-wake-lock.ts", import.meta.url),
  "utf8",
);

it("re-requests after the browser auto-releases the wake lock on a hidden tab", () => {
  expect(hookSource).toContain('sentinel?.addEventListener?.("release"');
  expect(hookSource).toContain('document.visibilityState !== "visible"');
});
