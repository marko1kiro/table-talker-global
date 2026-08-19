import { describe, expect, it } from "vitest";
import { visibleWakeLockState } from "../src/lib/screen-wake-lock";

describe("visibleWakeLockState", () => {
  it("requests when active and no sentinel while visible", () => {
    expect(visibleWakeLockState({ active: true, sentinelActive: false, visibility: "visible" })).toBe("request");
  });

  it("skips re-request when a sentinel is already active", () => {
    expect(visibleWakeLockState({ active: true, sentinelActive: true, visibility: "visible" })).toBe("none");
  });

  it("never requests while the tab is hidden", () => {
    expect(visibleWakeLockState({ active: true, sentinelActive: false, visibility: "hidden" })).toBe("none");
    expect(visibleWakeLockState({ active: true, sentinelActive: true, visibility: "hidden" })).toBe("none");
  });

  it("releases when deactivated and a sentinel exists", () => {
    expect(visibleWakeLockState({ active: false, sentinelActive: true, visibility: "visible" })).toBe("release");
  });

  it("does nothing when deactivated without a sentinel", () => {
    expect(visibleWakeLockState({ active: false, sentinelActive: false, visibility: "visible" })).toBe("none");
  });
});