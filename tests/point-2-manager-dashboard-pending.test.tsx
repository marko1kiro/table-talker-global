// @vitest-environment jsdom
// P1-4: a lingering recovery record means the last handoff never reached a
// definitive verdict. The live /manager dashboard must therefore refuse to
// trust the co-existing (never-confirmed) identity: on mount it drops the stale
// identity and bounces to /manager/login, while the recovery record REMAINS so
// the next login submit resumes that exact token+reservation pair.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const navigations: string[] = [];

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => options,
  useNavigate:
    () =>
    async (opts: { to: string }): Promise<void> => {
      navigations.push(opts.to);
    },
  Link: () => null,
}));
vi.mock("@/lib/supabase-browser", () => ({
  getSupabaseBrowserClient: () => ({}),
  getLiveAccessToken: async () => "anon-tok",
  ensureAnonAccessToken: async () => "anon-tok",
}));
// Realtime + notification wiring is not the subject of this mount test; stub
// the two hooks so mounting the dashboard exercises only the identity effect.
vi.mock("@/hooks/use-table-occupancy-realtime", () => ({
  useTableOccupancyRealtime: () => "SUBSCRIBED",
}));
vi.mock("@/hooks/use-notification-center", () => ({
  useNotificationCenter: () => ({
    items: [],
    unread: 0,
    push: () => undefined,
    markRead: () => undefined,
  }),
}));
// The dashboard's server functions must never attempt a real round-trip when a
// clean identity hydrates the shell in the no-pending regression case.
vi.mock("@/lib/manager-dashboard.server", () => ({
  getManagerSnapshot: async () => ({ ok: false }),
  getManagerCrewHistory: async () => ({ ok: false, crew: [] }),
}));
vi.mock("@/lib/manager-stats.server", () => ({
  getManagerDailyStats: async () => ({ ok: false }),
}));
vi.mock("@/lib/manager-instructions.server", () => ({
  sendManagerInstruction: async () => ({ ok: false }),
  getInstructionThread: async () => ({ ok: false, threads: [] }),
  getActiveCrewForMessaging: async () => ({ ok: false, crew: [] }),
}));
vi.mock("@/lib/manager-auth.server", () => ({
  changeManagerPassword: async () => ({ ok: false }),
  logoutManagerSession: async () => ({ ok: true }),
}));
vi.mock("@/lib/auth", () => ({ logout: async () => undefined }));

import * as managerRoute from "../src/routes/manager/index";
import type { ComponentType } from "react";
const ManagerDashboard = (managerRoute.Route as unknown as { component: ComponentType }).component;

// jsdom lacks these browser-only APIs used deep inside the hydrated dashboard
// shell; stub them so the no-pending regression case can mount without the
// test failing on environment gaps rather than on the behaviour under check.
class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
globalThis.IntersectionObserver = ObserverStub as unknown as typeof IntersectionObserver;
globalThis.ResizeObserver = ObserverStub as unknown as typeof ResizeObserver;
window.matchMedia =
  window.matchMedia ??
  ((query: string) =>
    ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }) as unknown as MediaQueryList);

const IDENTITY_KEY = "table-talker.manager-identity";
const PENDING_KEY = "table-talker.manager-pending-handoff";

const identity = {
  idManager: "kasir.satgas01",
  fullName: "Kasir Satgas",
  restaurantId: "r1",
  restaurantDisplayName: "Resto Satu",
  restaurantCode: "R1",
  managerToken: "minted-tok",
  accessToken: "anon-tok",
};
const pending = { ...identity, rateLimitReservationId: "res-1" };

function mountDashboard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(createElement(QueryClientProvider, { client }, createElement(ManagerDashboard)));
}

describe("P1-4: /manager refuses a lingering handoff identity", () => {
  beforeEach(() => {
    sessionStorage.clear();
    navigations.length = 0;
  });
  afterEach(() => cleanup());

  it("identity + pending on mount: bounce to login, drop identity, keep the record", async () => {
    sessionStorage.setItem(IDENTITY_KEY, JSON.stringify(identity));
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));

    mountDashboard();
    // The mount effect is synchronous; flush the async navigate() microtask.
    await Promise.resolve();

    expect(navigations).toEqual(["/manager/login"]);
    expect(sessionStorage.getItem(IDENTITY_KEY)).toBeNull();
    // Recovery record survives untouched so the next submit resumes this pair.
    expect(JSON.parse(sessionStorage.getItem(PENDING_KEY) as string)).toEqual(pending);
  });

  it("pending only (no identity): still bounces to login", async () => {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));

    mountDashboard();
    await Promise.resolve();

    expect(navigations).toEqual(["/manager/login"]);
    expect(sessionStorage.getItem(PENDING_KEY)).not.toBeNull();
  });
});
