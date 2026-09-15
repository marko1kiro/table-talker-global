// @vitest-environment jsdom
// Poin 6.1 S5: bundle-hash probe (index-*.js on the live document vs the
// running one), the exact owner-mandated copy, Refresh => location.reload,
// Nanti Aja => dismissed per-build for the whole tab session.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  UPDATE_TEXT,
  currentIndexAsset,
  isChunkLoadError,
  parseIndexAsset,
  shouldPrompt,
} from "@/lib/update-prompt";
import { UpdatePrompt } from "@/components/UpdatePrompt";

const LIVE =
  '<html><head><script type="module" src="/assets/index-AbC123.js"></script></head><body></body></html>';

beforeEach(() => {
  sessionStorage.clear();
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});

afterEach(cleanup);

describe("pure helpers", () => {
  it("parseIndexAsset extracts the hashed entry or null (dev/SSR-safe)", () => {
    expect(parseIndexAsset(LIVE)).toBe("/assets/index-AbC123.js");
    expect(parseIndexAsset("<html></html>")).toBeNull();
  });

  it("currentIndexAsset reads the running document's own entry script", () => {
    const s = document.createElement("script");
    s.setAttribute("src", "/assets/index-RUN001.js");
    document.head.appendChild(s);
    expect(currentIndexAsset()).toBe("/assets/index-RUN001.js");
  });

  it("shouldPrompt: only a different, not-yet-dismissed build nags", () => {
    expect(shouldPrompt("/assets/index-RUN.js", "/assets/index-NEW.js", false)).toBe(true);
    expect(shouldPrompt("/assets/index-RUN.js", "/assets/index-RUN.js", false)).toBe(false);
    expect(shouldPrompt("/assets/index-RUN.js", null, false)).toBe(false);
    expect(shouldPrompt(null, "/assets/index-NEW.js", false)).toBe(false);
    expect(shouldPrompt("/assets/index-RUN.js", "/assets/index-NEW.js", true)).toBe(false);
  });

  it("chunk-load error detector covers Chrome and Safari wording", () => {
    expect(isChunkLoadError("Failed to fetch dynamically imported module: https://x/y.js")).toBe(
      true,
    );
    expect(isChunkLoadError("Importing a module script failed.")).toBe(true);
    expect(isChunkLoadError("Cannot read properties of undefined")).toBe(false);
  });
});

function runningBuild() {
  const s = document.createElement("script");
  s.setAttribute("src", "/assets/index-RUN001.js");
  document.head.appendChild(s);
}

function stubReload() {
  const reload = vi.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, reload },
  });
  return reload;
}

describe("UpdatePrompt component", () => {
  it("Nanti Aja closes, records the dismissal, and the interval stays silent for that build", async () => {
    runningBuild();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ text: async () => LIVE }));
    render(<UpdatePrompt intervalMs={50} />);
    await waitFor(() => expect(screen.getByText(UPDATE_TEXT)).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Nanti Aja" }));
    expect(screen.queryByText(UPDATE_TEXT)).toBeNull();
    await waitFor(() =>
      expect(sessionStorage.getItem("lm.update.dismissed./assets/index-AbC123.js")).toBe("1"),
    );
    await new Promise((r) => setTimeout(r, 160)); // >= 2 extra interval ticks
    expect(screen.queryByText(UPDATE_TEXT)).toBeNull();
    vi.unstubAllGlobals();
  });

  it("Refresh reloads the page", async () => {
    runningBuild();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ text: async () => LIVE }));
    const reload = stubReload();
    render(<UpdatePrompt intervalMs={50} />);
    await waitFor(() => expect(screen.getByText(UPDATE_TEXT)).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(reload).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("fetch failure stays silent", async () => {
    runningBuild();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    render(<UpdatePrompt intervalMs={50} />);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText(UPDATE_TEXT)).toBeNull();
    vi.unstubAllGlobals();
  });
});
