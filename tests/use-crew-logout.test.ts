import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

// H-06: HeaderProps.onLogout used to be required, but the 6 public info
// pages (about, contact, faq, help, privacy-policy, terms-of-use) rendered
// <Header readyCount={0} totalCount={0} /> without it -- a TypeScript
// contract violation at every one of those call sites, and a logout button
// that called `onClick={undefined}` at runtime. No jsdom/testing-library
// harness is configured in this repo (see event-flush.test.ts /
// event-queue.test.ts for the same style), so these are source-inspection
// assertions matching the existing test style for this codebase, plus real
// unit execution of the one piece of pure logic here doesn't apply --
// useCrewLogout is a hook (needs a router context), so it's verified by
// inspecting the hook source directly instead of mounting it.

describe("Header.tsx: onLogout is optional and only rendered when supplied", () => {
  it("declares onLogout as an optional prop", () => {
    const header = source("../src/components/Header.tsx");
    expect(header).toContain("onLogout?: () => void;");
    expect(header).not.toMatch(/onLogout:\s*\(\)\s*=>\s*void;\n/);
  });

  it("guards both the desktop and mobile logout buttons behind onLogout", () => {
    const header = source("../src/components/Header.tsx");
    const logoutButtonBlocks = header.split('aria-label="Keluar"').slice(1);
    expect(logoutButtonBlocks.length).toBe(2);
    // Each occurrence of the Keluar button must be wrapped in an
    // `{onLogout && ( ... )}` guard rather than always rendering with a
    // possibly-undefined onClick.
    const guardedCount = (header.match(/\{onLogout && \(/g) ?? []).length;
    expect(guardedCount).toBe(2);
  });
});

describe("useCrewLogout hook (src/hooks/use-crew-logout.ts)", () => {
  it("clears both possible session identity keys and the telemetry queue, then returns to /", () => {
    const hook = source("../src/hooks/use-crew-logout.ts");
    expect(hook).toContain('import { useNavigate } from "@tanstack/react-router"');
    expect(hook).toContain("removeCrewSessionIdentity(storage)");
    expect(hook).toContain("removeRoleSessionIdentity(storage)");
    expect(hook).toContain('navigate({ to: "/" })');
  });

  // M-04/M-05 (Fase 3, 2026-09-02): clearQueuedEvents() used to take no
  // arguments and wipe the entire shared-origin IndexedDB store, deleting
  // any other open tab/session's still-queued telemetry too. It's now
  // partitioned per crew session (tenantToken + crewSessionId), so this
  // hook must read the crew identity *before* removing it from storage in
  // order to scope the clear correctly, and must actually await the
  // clear (a bare `void clearQueuedEvents()` reintroduces the M-05 race
  // between an in-flight enqueue and this clear).
  it("reads the crew identity before removing it, to scope the telemetry clear to this session only", () => {
    const hook = source("../src/hooks/use-crew-logout.ts");
    expect(hook).toContain("readCrewSessionIdentity(storage)");
    const readIndex = hook.indexOf("readCrewSessionIdentity(storage)");
    const removeIndex = hook.indexOf("removeCrewSessionIdentity(storage)");
    expect(readIndex).toBeGreaterThan(-1);
    expect(removeIndex).toBeGreaterThan(-1);
    expect(readIndex).toBeLessThan(removeIndex);
  });

  it("awaits a session-scoped clearQueuedEvents call instead of firing it unawaited", () => {
    const hook = source("../src/hooks/use-crew-logout.ts");
    expect(hook).not.toContain("void clearQueuedEvents()");
    expect(hook).not.toContain("clearQueuedEvents()");
    expect(hook).toMatch(
      /await clearQueuedEvents\(\s*[\w.?]+\.tenantToken,\s*[\w.?]+\.crewSessionId\s*\)/,
    );
  });

  it("is exported as a reusable hook returning an async handler", () => {
    const hook = source("../src/hooks/use-crew-logout.ts");
    expect(hook).toContain("export function useCrewLogout(): () => Promise<void>");
    expect(hook).toMatch(/useCallback\(async \(\)/);
  });
});

describe("The 6 public info routes wire a working onLogout instead of omitting it", () => {
  const routes = ["about", "contact", "faq", "help", "privacy-policy", "terms-of-use"];

  it.each(routes)("%s.tsx imports useCrewLogout and passes it to Header", (routeName) => {
    const page = source(`../src/routes/${routeName}.tsx`);
    expect(page).toContain('import { useCrewLogout } from "@/hooks/use-crew-logout"');
    expect(page).toContain("const logout = useCrewLogout();");
    expect(page).toContain("<Header readyCount={0} totalCount={0} onLogout={logout} />");
    // Guard against the original bug regressing: no bare, handler-less
    // Header call should remain in any of these 6 files.
    expect(page).not.toMatch(/<Header readyCount=\{0\} totalCount=\{0\} \/>/);
  });
});
